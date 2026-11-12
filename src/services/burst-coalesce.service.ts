import { ConversationState, Direction } from '@prisma/client';
import { QueuePayload } from './queue.service';
import { messageService } from './message.service';
import { queueService } from './queue.service';
import { commandService } from './command.service';
import { trackTimeout, clearTimeoutTracked } from '../lifecycle/interval-registry';
import { distributedKv, DistributedKv, KV_LOCK_TTL_MS } from '../utils/distributed-kv';

/**
 * Burst Coalescing Service — gabungkan pesan text beruntun dari customer menjadi
 * SATU job/balasan (bukan balas per-pesan).
 *
 * Pola debounce window (mirip self-learning.service.ts):
 * - Pesan text pertama di state open-ended memulai buffer + timer.
 * - Pesan text berikutnya dalam window di-append & timer di-reset.
 * - Saat timer habis → buffer digabung jadi satu incomingMessage lalu di-enqueue (1 LLM call → 1 balasan).
 *
 * Batasan (sesuai keputusan desain):
 * - Hanya pesan TEXT, dan hanya saat conversation ada di state coalesceable
 *   (INITIAL / AWAITING_LOCATION / LOCATION_CONFIRMED / AWAITING_INTEREST / COMPLETED).
 *   AWAITING_LOCATION & LOCATION_CONFIRMED DICOALESCE agar burst pengetikan alamat
 *   bertahap ("Taman wisata Regency" lalu "Gadung") menjadi satu turn (insiden
 *   double-ongkir Velicia). State yang menunggu input spesifik lain
 *   (RESERVATION_SENT, HUMAN_HANDLING) TIDAK di-merge.
 * - Pesan non-text (location/media) TIDAK di-merge: flush buffer tertunda dulu, lalu pesan tsb
 *   diproses normal (handled=false).
 * - Nonaktif secara default: env BURST_COALESCE_MS = 0 → semua pesan passthrough (behavior lama).
 *
 * W-006 (lintas proses):
 * - Bila Redis aktif (`distributedKv.isShared()`), buffer disimpan di KV bersama:
 *   set pesan + payload per pesan + metadata + deadline. Hanya pemegang lock
 *   `SET NX PX` yang boleh melakukan flush, sehingga app & worker tidak
 *   mengirim dua balasan untuk burst yang sama.
 * - Saat Redis mati, otomatis kembali ke buffer memori proses (perilaku lama).
 *
 * Idempotency & audit: setiap pesan asli langsung di-log ke messageService (audit trail + live chat
 * realtime + idempotency lock), lalu job hasil merge membawa flag `_preLogged` sehingga machine.ts
 * TIDAK mencatat ulang inbound.
 */

export interface BurstCoalesceOptions {
  tenantId: string;
  customerId: string;
  phone: string;
  conversation: { id: string; current_state: ConversationState };
  incomingMessage: any;
}

export interface BurstCoalesceResult {
  handled: boolean;
}

interface PendingBuffer {
  tenantId: string;
  customerId: string;
  phone: string;
  conversationId: string;
  chatId: string;
  messages: any[];
  timer: NodeJS.Timeout;
}

interface DistributedMeta {
  tenantId: string;
  customerId: string;
  phone: string;
  conversationId: string;
  chatId: string;
}

const COALESCEABLE_STATES = new Set<ConversationState>([
  ConversationState.INITIAL,
  ConversationState.AWAITING_LOCATION,
  ConversationState.LOCATION_CONFIRMED,
  ConversationState.AWAITING_INTEREST,
  ConversationState.COMPLETED,
]);

export class BurstCoalesceService {
  private buffers: Map<string, PendingBuffer> = new Map();
  /** Timer wakeup lokal untuk buffer bersama (Redis). */
  private distributedTimers: Map<string, NodeJS.Timeout> = new Map();
  private probedShared = false;
  private readonly namespace = process.env.BURST_COALESCE_NAMESPACE || 'v1';

  constructor(
    private readonly kv: DistributedKv = distributedKv,
    private readonly forceDistributed = false
  ) {}

  private getKey(tenantId: string, phone: string): string {
    return `${tenantId}:${phone}`;
  }

  private key(key: string, suffix: string): string {
    return `burst:${this.namespace}:${key}:${suffix}`;
  }

  private getWindowMs(): number {
    const parsed = parseInt(process.env.BURST_COALESCE_MS || '7500', 10);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }

  private getMaxMessages(): number {
    const parsed = parseInt(process.env.BURST_COALESCE_MAX_MESSAGES || '10', 10);
    return Number.isNaN(parsed) || parsed < 1 ? 10 : parsed;
  }

  private isCoalesceableMessage(msg: any): boolean {
    if (msg?.location) return false;
    return msg?.type === 'text' || msg?.type === 'image' || !!msg?.text?.body || !!msg?.media;
  }

  private isCommandText(text: string): boolean {
    return commandService.isCommandText(text);
  }

  /**
   * W-006: tentukan jalur. Percobaan pertama menyentuh KV untuk memicu koneksi
   * Redis (lazy), lalu hasilnya di-cache per proses.
   */
  private async useDistributed(): Promise<boolean> {
    if (this.forceDistributed) return true;
    if (!this.probedShared) {
      this.probedShared = true;
      try {
        await this.kv.exists(`burst:${this.namespace}:probe`);
      } catch {
        /* tetap lokal */
      }
    }
    return this.kv.isShared();
  }

  /**
   * Titik masuk dari webhook layer. Return handled=true jika pesan di-buffer (belum di-enqueue),
   * handled=false jika harus diproses normal oleh caller.
   */
  public async maybeCoalesce(opts: BurstCoalesceOptions): Promise<BurstCoalesceResult> {
    if (await this.useDistributed()) {
      return this.maybeCoalesceDistributed(opts);
    }
    return this.maybeCoalesceLocal(opts);
  }

  // ------------------------------------------------------------------
  // Jalur lokal (Redis mati / single-process) — perilaku lama dipertahankan.
  // ------------------------------------------------------------------
  private async maybeCoalesceLocal(opts: BurstCoalesceOptions): Promise<BurstCoalesceResult> {
    const { tenantId, phone, conversation, incomingMessage } = opts;

    const key = this.getKey(tenantId, phone);
    const existing = this.buffers.get(key);

    // 1. Coalescing nonaktif (env 0) → passthrough total, jangan sentuh buffer.
    if (this.getWindowMs() <= 0) {
      return { handled: false };
    }

    // 2. Pesan GPS location / non-coalesceable → flush buffer tertunda (jika ada) lalu passthrough.
    if (!this.isCoalesceableMessage(incomingMessage)) {
      if (existing) {
        await this.flushLocal(key);
      }
      return { handled: false };
    }

    // 2b. Pesan perintah slash (contoh /reset, /state, /mulai) → jangan di-merge supaya
    // exact-match perintah tidak hilang saat digabung dengan pesan lain. Flush lalu
    // passthrough ke machine command gate.
    if (this.isCommandText(incomingMessage.text?.body || '')) {
      if (existing) {
        await this.flushLocal(key);
      }
      return { handled: false };
    }

    // 3. State bukan coalesceable → flush buffer lalu passthrough (jangan tunda balasan state menunggu input).
    if (!COALESCEABLE_STATES.has(conversation.current_state)) {
      if (existing) {
        await this.flushLocal(key);
      }
      return { handled: false };
    }

    // 4. Log pesan asli SEKARANG (audit trail + live chat realtime + idempotency lock).
    await this.logInbound(opts);

    // 5. Buffer sudah penuh → flush dulu, mulai batch baru dengan pesan ini.
    if (existing && existing.messages.length >= this.getMaxMessages()) {
      await this.flushLocal(key);
    }

    const current = this.buffers.get(key);
    if (current) {
      // Reset timer: setiap pesan baru memperpanjang window.
      clearTimeoutTracked(current.timer);
      current.messages.push(incomingMessage);
      current.timer = trackTimeout(() => { this.flushLocal(key).catch(e => console.error('[BURST COALESCE TIMER ERROR]', e)); }, this.getWindowMs());
      return { handled: true };
    }

    const timer = trackTimeout(() => { this.flushLocal(key).catch(e => console.error('[BURST COALESCE TIMER ERROR]', e)); }, this.getWindowMs());
    this.buffers.set(key, {
      tenantId,
      customerId: opts.customerId,
      phone,
      conversationId: conversation.id,
      chatId: incomingMessage.chatId || `${phone}@c.us`,
      messages: [incomingMessage],
      timer,
    });
    return { handled: true };
  }

  // ------------------------------------------------------------------
  // Jalur bersama (Redis) — W-006.
  // ------------------------------------------------------------------
  private async maybeCoalesceDistributed(opts: BurstCoalesceOptions): Promise<BurstCoalesceResult> {
    const { tenantId, phone, conversation, incomingMessage } = opts;
    const key = this.getKey(tenantId, phone);
    const windowMs = this.getWindowMs();

    if (windowMs <= 0) return { handled: false };

    const buffered = await this.kv.smembers(this.key(key, 'msgs'));

    if (!this.isCoalesceableMessage(incomingMessage)) {
      if (buffered.length > 0) await this.flushDistributed(key, true);
      return { handled: false };
    }

    if (this.isCommandText(incomingMessage.text?.body || '')) {
      if (buffered.length > 0) await this.flushDistributed(key, true);
      return { handled: false };
    }

    if (!COALESCEABLE_STATES.has(conversation.current_state)) {
      if (buffered.length > 0) await this.flushDistributed(key, true);
      return { handled: false };
    }

    await this.logInbound(opts);

    const msgId = String(incomingMessage.id || `m_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const ttlMs = Math.max(windowMs * 4, 60_000);
    // Urutan lintas proses memakai counter monoton (INCR), bukan jam dinding:
    // dua node bisa punya selisih waktu/urutan eksekusi.
    const seq = await this.kv.incr(this.key(key, 'seq'), ttlMs);
    const meta: DistributedMeta = {
      tenantId,
      customerId: opts.customerId,
      phone,
      conversationId: conversation.id,
      chatId: incomingMessage.chatId || `${phone}@c.us`,
    };

    await this.kv.set(this.key(key, `msg:${msgId}`), JSON.stringify({ seq, msg: incomingMessage }), ttlMs);
    await this.kv.sadd(this.key(key, 'msgs'), msgId, ttlMs);
    await this.kv.set(this.key(key, 'meta'), JSON.stringify(meta), ttlMs);
    await this.kv.set(this.key(key, 'deadline'), String(Date.now() + windowMs), ttlMs);

    const ids = await this.kv.smembers(this.key(key, 'msgs'));
    if (ids.length >= this.getMaxMessages()) {
      await this.flushDistributed(key, true);
    } else {
      this.scheduleDistributedFlush(key, windowMs);
    }
    return { handled: true };
  }

  private scheduleDistributedFlush(key: string, delayMs: number): void {
    const prev = this.distributedTimers.get(key);
    if (prev) clearTimeoutTracked(prev);
    const timer = trackTimeout(() => {
      this.distributedTimers.delete(key);
      this.flushDistributed(key).catch(e => console.error('[BURST COALESCE TIMER ERROR]', e));
    }, Math.max(0, delayMs));
    this.distributedTimers.set(key, timer);
  }

  /**
   * Flush buffer bersama. Hanya pemegang lock yang meng-enqueue; proses lain
   * menjadwalkan ulang (recovery) sehingga tidak ada balasan ganda.
   */
  private async flushDistributed(key: string, force = false): Promise<void> {
    const deadlineRaw = await this.kv.get(this.key(key, 'deadline'));
    const deadline = Number(deadlineRaw || 0);
    if (!force && deadline > Date.now()) {
      this.scheduleDistributedFlush(key, deadline - Date.now());
      return;
    }

    const outcome = await this.kv.withLock(this.key(key, 'lock'), KV_LOCK_TTL_MS, async () => {
      // Baca ulang di dalam lock: pesan baru bisa memperpanjang window.
      const currentDeadline = Number((await this.kv.get(this.key(key, 'deadline'))) || 0);
      if (!force && currentDeadline > Date.now()) return 'postponed' as const;

      const claimedKey = this.key(key, 'claimed');
      const hasBatch = await this.kv.rename(this.key(key, 'msgs'), claimedKey);
      if (!hasBatch) return 'empty' as const;

      const ids = await this.kv.smembers(claimedKey);
      const metaRaw = await this.kv.get(this.key(key, 'meta'));
      await this.kv.del(this.key(key, 'deadline'));

      const rawMessages = await this.kv.mget(ids.map((id) => this.key(key, `msg:${id}`)));
      const entries = rawMessages
        .map((raw) => {
          if (!raw) return null;
          try {
            return JSON.parse(raw) as { seq: number; msg: any };
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { seq: number; msg: any } => !!entry)
        .sort((a, b) => a.seq - b.seq);

      await this.kv.del(claimedKey, ...ids.map((id) => this.key(key, `msg:${id}`)));

      const stillBuffered = await this.kv.smembers(this.key(key, 'msgs'));
      if (stillBuffered.length === 0) await this.kv.del(this.key(key, 'meta'));

      if (!metaRaw || entries.length === 0) return 'empty' as const;

      let meta: DistributedMeta;
      try {
        meta = JSON.parse(metaRaw) as DistributedMeta;
      } catch {
        return 'empty' as const;
      }

      await this.enqueueMerged(meta, entries.map((entry) => entry.msg));
      return 'flushed' as const;
    }, { waitMs: 0 });

    if (outcome === null) {
      // Lock dipegang proses lain (sedang flush) atau basi; coba lagi sebentar
      // lagi agar batch tidak menggantung bila pemegang lock mati.
      this.scheduleDistributedFlush(key, 2_000);
    } else if (outcome === 'postponed') {
      const d = Number((await this.kv.get(this.key(key, 'deadline'))) || 0);
      this.scheduleDistributedFlush(key, Math.max(0, d - Date.now()));
    }
  }

  // ------------------------------------------------------------------
  // Bagian bersama: log inbound & enqueue hasil merge.
  // ------------------------------------------------------------------
  private async logInbound(opts: BurstCoalesceOptions): Promise<void> {
    const { tenantId, phone, conversation, incomingMessage } = opts;
    const hasMedia = !!(incomingMessage.media || incomingMessage.type === 'image');
    const logContent = (incomingMessage as any).originalText || incomingMessage.text?.body || (hasMedia ? (incomingMessage.media?.caption ? `[IMAGE: ${incomingMessage.media.caption}]` : '[IMAGE]') : '[TEXT]');
    await messageService.logMessage({
      tenantId,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: logContent,
      waMessageId: incomingMessage.id,
      payloadRaw: incomingMessage,
    });

    // Task 5.1.2 / W-005: persist turn inbound secara durable saat masuk buffer
    try {
      const { turnRepository } = await import('../repositories/turn.repository');
      const provider = (incomingMessage as any)._provider || 'WAHA';
      await turnRepository.persistInbound({
        tenantId,
        provider,
        inboundMessageId: String(incomingMessage.id || `coalesce_${Date.now()}`),
        customerId: opts.customerId,
        conversationId: conversation.id,
        payload: { tenantId, customerId: opts.customerId, phone, incomingMessage },
      });
    } catch (persistErr: any) {
      console.warn('[BURST COALESCE] persistInbound error:', persistErr?.message || persistErr);
    }
  }

  /**
   * Gabungkan pesan jadi satu incomingMessage lalu enqueue 1 job.
   * text.body = join '\n'; id/timestamp = pesan terakhir; `_preLogged` = true.
   */
  private async enqueueMerged(
    meta: { tenantId: string; customerId: string; phone: string; conversationId: string; chatId: string },
    messages: any[]
  ): Promise<void> {
    if (messages.length === 0) return;

    const { tenantId, customerId, phone, chatId, conversationId } = meta;
    const last = messages[messages.length - 1];
    const imageMessage = messages.find((m) => m.type === 'image' || m.media);
    const mergedBody = messages.map((m) => (m.text?.body || '').trim()).filter(Boolean).join('\n');
    if (!mergedBody && !imageMessage) return;

    const mergedMessage: any = {
      id: last.id,
      from: phone,
      chatId,
      timestamp: last.timestamp || String(Math.floor(Date.now() / 1000)),
      type: imageMessage ? 'image' : 'text',
      text: mergedBody ? { body: mergedBody } : undefined,
      media: imageMessage?.media,
      _preLogged: true,
      _mergedCount: messages.length,
      _data: last._data,
      _provider: last._provider,
    };

    const inboundMessageId = String(last.id || `merged_${Date.now()}`);
    const provider = (last as any)._provider || 'WAHA';
    try {
      const { turnRepository } = await import('../repositories/turn.repository');
      await turnRepository.persistInbound({
        tenantId,
        provider,
        inboundMessageId,
        customerId,
        conversationId,
        payload: { tenantId, customerId, phone, incomingMessage: mergedMessage },
      });
    } catch {}
    const payload: QueuePayload = {
      tenantId,
      customerId,
      phone,
      incomingMessage: mergedMessage,
      turnId: `${tenantId}:${provider}:${inboundMessageId}`,
      provider,
      inboundMessageId,
    } as any;
    try {
      await queueService.enqueueMessage(payload);
    } catch (err: any) {
      console.error('[BURST COALESCE] Failed to enqueue merged message:', err.message);
    }
  }

  /** Flush buffer lokal (jalur memori). */
  private async flushLocal(key: string): Promise<void> {
    const buf = this.buffers.get(key);
    if (!buf || buf.messages.length === 0) {
      this.buffers.delete(key);
      return;
    }

    clearTimeout(buf.timer);
    const { tenantId, customerId, phone, chatId, conversationId, messages } = buf;
    this.buffers.delete(key);

    await this.enqueueMerged({ tenantId, customerId, phone, chatId, conversationId }, messages);
  }

  /** Flush semua buffer (dipakai saat shutdown & test). */
  public async flushAll(): Promise<void> {
    const localKeys = Array.from(this.buffers.keys());
    for (const key of localKeys) {
      await this.flushLocal(key);
    }
    if (this.forceDistributed || this.kv.isShared()) {
      for (const key of Array.from(this.distributedTimers.keys())) {
        const timer = this.distributedTimers.get(key);
        if (timer) clearTimeoutTracked(timer);
        this.distributedTimers.delete(key);
        try {
          await this.flushDistributed(key, true);
        } catch (err: any) {
          console.warn('[BURST COALESCE] flushAll distributed error:', err?.message || err);
        }
      }
    }
  }

  /** Jumlah buffer aktif (untuk test/observability). */
  public pendingCount(): number {
    return this.buffers.size + this.distributedTimers.size;
  }
}

export const burstCoalesceService = new BurstCoalesceService();

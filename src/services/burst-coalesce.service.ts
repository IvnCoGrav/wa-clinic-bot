import { ConversationState, Direction } from '@prisma/client';
import { QueuePayload } from './queue.service';
import { messageService } from './message.service';
import { queueService } from './queue.service';

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
 * - Hanya pesan TEXT, dan hanya saat conversation ada di state open-ended
 *   (INITIAL / AWAITING_INTEREST / COMPLETED). State yang menunggu input spesifik
 *   (AWAITING_LOCATION, LOCATION_CONFIRMED, RESERVATION_SENT, HUMAN_HANDLING) TIDAK di-merge.
 * - Pesan non-text (location/media) TIDAK di-merge: flush buffer tertunda dulu, lalu pesan tsb
 *   diproses normal (handled=false).
 * - Nonaktif secara default: env BURST_COALESCE_MS = 0 → semua pesan passthrough (behavior lama).
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

const OPEN_ENDED_STATES = new Set<ConversationState>([
  ConversationState.INITIAL,
  ConversationState.AWAITING_INTEREST,
  ConversationState.COMPLETED,
  ConversationState.AWAITING_LOCATION,
]);

export class BurstCoalesceService {
  private buffers: Map<string, PendingBuffer> = new Map();

  private getKey(tenantId: string, phone: string): string {
    return `${tenantId}:${phone}`;
  }

  private getWindowMs(): number {
    const parsed = parseInt(process.env.BURST_COALESCE_MS || '2500', 10);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }

  private getMaxMessages(): number {
    const parsed = parseInt(process.env.BURST_COALESCE_MAX_MESSAGES || '10', 10);
    return Number.isNaN(parsed) || parsed < 1 ? 10 : parsed;
  }

  private isTextMessage(msg: any): boolean {
    return msg?.type === 'text' || (!!msg?.text?.body && typeof msg.text.body === 'string');
  }

  private isCommandText(text: string): boolean {
    return /^\/[a-z]/.test(text.trim().toLowerCase());
  }

  /**
   * Titik masuk dari webhook layer. Return handled=true jika pesan di-buffer (belum di-enqueue),
   * handled=false jika harus diproses normal oleh caller.
   */
  public async maybeCoalesce(opts: BurstCoalesceOptions): Promise<BurstCoalesceResult> {
    const { tenantId, phone, conversation, incomingMessage } = opts;

    const key = this.getKey(tenantId, phone);
    const existing = this.buffers.get(key);

    // 1. Coalescing nonaktif (env 0) → passthrough total, jangan sentuh buffer.
    if (this.getWindowMs() <= 0) {
      return { handled: false };
    }

    // 2. Pesan non-text (location/media) → flush buffer tertunda (jika ada) lalu passthrough.
    if (!this.isTextMessage(incomingMessage)) {
      if (existing) {
        await this.flush(key);
      }
      return { handled: false };
    }

    // 2b. Pesan perintah slash (contoh /reset, /state, /mulai) → jangan di-merge supaya
    // exact-match perintah tidak hilang saat digabung dengan pesan lain. Flush lalu
    // passthrough ke machine command gate.
    if (this.isCommandText(incomingMessage.text?.body || '')) {
      if (existing) {
        await this.flush(key);
      }
      return { handled: false };
    }

    // 3. State bukan open-ended → flush buffer lalu passthrough (jangan tunda balasan state menunggu input).
    if (!OPEN_ENDED_STATES.has(conversation.current_state)) {
      if (existing) {
        await this.flush(key);
      }
      return { handled: false };
    }

    // 4. Log pesan asli SEKARANG (audit trail + live chat realtime + idempotency lock).
    await messageService.logMessage({
      tenantId,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: incomingMessage.text?.body || '[TEXT]',
      waMessageId: incomingMessage.id,
      payloadRaw: incomingMessage,
    });

    // 5. Buffer sudah penuh → flush dulu, mulai batch baru dengan pesan ini.
    if (existing && existing.messages.length >= this.getMaxMessages()) {
      await this.flush(key);
    }

    const current = this.buffers.get(key);
    if (current) {
      // Reset timer: setiap pesan baru memperpanjang window.
      clearTimeout(current.timer);
      current.messages.push(incomingMessage);
      current.timer = setTimeout(() => { this.flush(key).catch(e => console.error('[BURST COALESCE TIMER ERROR]', e)); }, this.getWindowMs());
      return { handled: true };
    }

    const timer = setTimeout(() => { this.flush(key).catch(e => console.error('[BURST COALESCE TIMER ERROR]', e)); }, this.getWindowMs());
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

  /**
   * Gabungkan semua pesan buffer jadi satu incomingMessage lalu enqueue 1 job.
   * text.body = join '\n' (LLM/NLU membaca konteks utuh); id/timestamp = pesan terakhir;
   * flag `_preLogged` memberitahu machine.ts untuk tidak log inbound lagi.
   */
  private async flush(key: string): Promise<void> {
    const buf = this.buffers.get(key);
    if (!buf || buf.messages.length === 0) {
      this.buffers.delete(key);
      return;
    }

    clearTimeout(buf.timer);
    const { tenantId, customerId, phone, chatId, messages } = buf;
    this.buffers.delete(key);

    const last = messages[messages.length - 1];
    const mergedBody = messages.map((m) => (m.text?.body || '').trim()).filter(Boolean).join('\n');
    if (!mergedBody) return;

    const mergedMessage: any = {
      id: last.id,
      from: phone,
      chatId,
      timestamp: last.timestamp || String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: mergedBody },
      _preLogged: true,
      _mergedCount: messages.length,
      _data: last._data,
      _provider: last._provider,
    };

    const payload: QueuePayload = { tenantId, customerId, phone, incomingMessage: mergedMessage };
    try {
      await queueService.enqueueMessage(payload);
    } catch (err: any) {
      console.error('[BURST COALESCE] Failed to enqueue merged message:', err.message);
    }
  }

  /** Flush semua buffer (dipakai saat shutdown & test). */
  public async flushAll(): Promise<void> {
    for (const key of Array.from(this.buffers.keys())) {
      await this.flush(key);
    }
  }

  /** Jumlah buffer aktif (untuk test/observability). */
  public pendingCount(): number {
    return this.buffers.size;
  }
}

export const burstCoalesceService = new BurstCoalesceService();

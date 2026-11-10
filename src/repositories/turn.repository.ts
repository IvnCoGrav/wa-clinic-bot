import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Stage 5 (RC-04) — Durable turn repository.
 *
 * Persist satu turn inbound SEBELUM ack webhook (RECEIVED), lalu claim atomik
 * di worker (RECEIVED→PROCESSING) agar dua worker tidak memproses turn sama.
 * Best-effort: bila DB offline, operasi tidak boleh menggagalkan alur utama
 * (webhook/queue tetap berjalan seperti semula).
 */
export type InboundTurnStatus =
  | 'RECEIVED' | 'QUEUED' | 'PROCESSING' | 'RESPONSE_READY' | 'DELIVERED' | 'FAILED' | 'HANDOFF';

export interface PersistInboundParams {
  tenantId: string;
  provider: 'WAHA' | 'WABA' | string;
  inboundMessageId: string;
  customerId?: string;
  conversationId?: string;
  /** Payload minimal untuk replay (Stage 5 Fase 5). */
  payload?: any;
}

export interface ITurnRepository {
  persistInbound(params: PersistInboundParams): Promise<void>;
  listReplayable(opts?: { olderThanMs?: number; limit?: number; maxAttempts?: number; resetProcessingOnBoot?: boolean }): Promise<Array<{ tenant_id: string; provider: string; inbound_message_id: string; payload_json: any; status: string; attempts: number }>>;
  markQueued(params: { tenantId: string; provider: string; inboundMessageId: string }): Promise<void>;
  cleanupOlderThan(days: number): Promise<number>;
  claimForProcessing(params: { tenantId: string; provider: string; inboundMessageId: string }): Promise<boolean>;
  markStatus(params: { tenantId: string; provider: string; inboundMessageId: string; status: InboundTurnStatus; error?: string }): Promise<void>;
}

export class TurnRepository implements ITurnRepository {
  /** Persist turn inbound (idempoten via unique tenant+provider+message id). */
  public async persistInbound(params: PersistInboundParams): Promise<void> {
    const { tenantId, provider, inboundMessageId, customerId, conversationId, payload } = params;
    if (!inboundMessageId) return;
    try {
      // D-16: Bila sebelumnya pernah FAILED, reset status ke RECEIVED agar bisa di-retry.
      await (prisma as any).inboundTurn.updateMany({
        where: {
          tenant_id: tenantId,
          provider,
          inbound_message_id: inboundMessageId,
          status: 'FAILED',
        },
        data: { status: 'RECEIVED', attempts: 0, last_error: null },
      });

      await (prisma as any).inboundTurn.upsert({
        where: { tenant_id_provider_inbound_message_id: { tenant_id: tenantId, provider, inbound_message_id: inboundMessageId } },
        create: {
          tenant_id: tenantId,
          provider,
          inbound_message_id: inboundMessageId,
          customer_id: customerId ?? null,
          conversation_id: conversationId ?? null,
          status: 'RECEIVED',
          ...(payload ? { payload_json: payload } : {}),
        },
        update: {}, // sudah ada dan bukan FAILED → jangan timpa status
      });
    } catch (err: any) {
      console.warn('[TURN] persistInbound gagal (best-effort):', err?.message);
    }
  }

  /**
   * Stage 5 Fase 5 — daftar turn yang perlu di-replay: RECEIVED/QUEUED yang
   * belum diproses, ATAU PROCESSING yang macet (worker crash) melewati ambang.
   * Mengembalikan payload untuk di-enqueue ulang.
   */
  public async listReplayable(opts: { olderThanMs?: number; limit?: number; maxAttempts?: number; resetProcessingOnBoot?: boolean } = {}): Promise<Array<{ tenant_id: string; provider: string; inbound_message_id: string; payload_json: any; status: string; attempts: number }>> {
    const olderThanMs = opts.olderThanMs ?? 2 * 60 * 1000;
    const limit = opts.limit ?? 50;
    const maxAttempts = opts.maxAttempts ?? 5;
    const cutoff = new Date(Date.now() - olderThanMs);
    try {
      return await (prisma as any).inboundTurn.findMany({
        where: {
          attempts: { lt: maxAttempts },
          OR: [
            { status: { in: ['RECEIVED', 'QUEUED'] }, updated_at: { lt: cutoff } },
            opts.resetProcessingOnBoot ? { status: 'PROCESSING' } : { status: 'PROCESSING', updated_at: { lt: cutoff } },
          ],
        },
        orderBy: { created_at: 'asc' },
        take: limit,
        select: { tenant_id: true, provider: true, inbound_message_id: true, payload_json: true, status: true, attempts: true },
      }) || [];
    } catch (err: any) {
      console.warn('[TURN] listReplayable gagal:', err?.message);
      return [];
    }
  }

  /** Tandai turn menjadi QUEUED (untuk replay) / naikkan attempts. */
  public async markQueued(params: { tenantId: string; provider: string; inboundMessageId: string }): Promise<void> {
    const { tenantId, provider, inboundMessageId } = params;
    if (!inboundMessageId) return;
    try {
      await (prisma as any).inboundTurn.updateMany({
        where: { tenant_id: tenantId, provider, inbound_message_id: inboundMessageId },
        data: { status: 'QUEUED', attempts: { increment: 1 } },
      });
    } catch (err: any) {
      console.warn('[TURN] markQueued gagal (best-effort):', err?.message);
    }
  }

  /** Hapus turn lama (retention). Mengembalikan jumlah terhapus. */
  public async cleanupOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let total = 0;
    try {
      const res = await (prisma as any).inboundTurn.deleteMany({ where: { created_at: { lt: cutoff } } });
      total += res?.count ?? 0;
    } catch (err: any) {
      console.warn('[TURN] cleanupOlderThan inboundTurn gagal:', err?.message);
    }
    try {
      const res2 = await (prisma as any).outboundAttempt.deleteMany({ where: { created_at: { lt: cutoff } } });
      total += res2?.count ?? 0;
    } catch (err: any) {
      console.warn('[TURN] cleanupOlderThan outboundAttempt gagal:', err?.message);
    }
    return total;
  }

  /**
   * Claim atomik untuk diproses: RECEIVED|QUEUED → PROCESSING.
   * Mengembalikan true bila claim berhasil (atau bila tracking tak tersedia
   * karena DB offline — fail-open agar alur utama tetap jalan).
   */
  public async claimForProcessing(params: { tenantId: string; provider: string; inboundMessageId: string }): Promise<boolean> {
    const { tenantId, provider, inboundMessageId } = params;
    if (!inboundMessageId) return true;
    try {
      const res = await (prisma as any).inboundTurn.updateMany({
        where: {
          tenant_id: tenantId,
          provider,
          inbound_message_id: inboundMessageId,
          status: { in: ['RECEIVED', 'QUEUED'] },
        },
        data: { status: 'PROCESSING' },
      });
      if ((res?.count ?? 0) > 0) return true;
      // count 0: bisa karena sudah PROCESSING/RESPONSE_READY (sudah diproses)
      // ATAU belum ter-persist. Cek keberadaan: bila ada & bukan RECEIVED/QUEUED → jangan proses.
      const existing = await (prisma as any).inboundTurn.findFirst({
        where: { tenant_id: tenantId, provider, inbound_message_id: inboundMessageId },
        select: { status: true },
      });
      if (!existing) return true; // belum ter-track → izinkan (fail-open)
      // D-06: Jika statusnya bukan RECEIVED/QUEUED (misal sedang PROCESSING atau DELIVERED),
      // tolak claim (kembalikan false) agar worker paralel tidak memproses turn yang sama.
      return false;
    } catch (err: any) {
      console.warn('[TURN] claimForProcessing gagal (fail-open):', err?.message);
      return true;
    }
  }

  /** Tandai status turn (best-effort). */
  public async markStatus(params: { tenantId: string; provider: string; inboundMessageId: string; status: InboundTurnStatus; error?: string }): Promise<void> {
    const { tenantId, provider, inboundMessageId, status, error } = params;
    if (!inboundMessageId) return;
    try {
      await (prisma as any).inboundTurn.updateMany({
        where: { tenant_id: tenantId, provider, inbound_message_id: inboundMessageId },
        data: { status, ...(error ? { last_error: error } : {}) },
      });
    } catch (err: any) {
      console.warn('[TURN] markStatus gagal (best-effort):', err?.message);
    }
  }
}

export const turnRepository = new TurnRepository();

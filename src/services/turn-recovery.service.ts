import { turnRepository } from '../repositories/turn.repository';
import { queueService } from './queue.service';

/**
 * Stage 5 Fase 5 (RC-04) — Recovery & retention turn durable.
 *
 * - `replayPendingTurns()`: enqueue ulang turn RECEIVED/QUEUED/PROCESSING-macet
 *   yang punya payload (Redis down / worker crash) agar pesan tidak hilang.
 * - `cleanupOldTurns()`: retention (hapus ledger lama).
 *
 * Semua best-effort: DB offline / queue error tidak boleh menggagalkan boot.
 */
export class TurnRecoveryService {
  /** Replay turn yang belum selesai diproses (idempoten via markQueued). */
  public async replayPendingTurns(limit = 50): Promise<number> {
    let replayed = 0;
    try {
      const pending = await turnRepository.listReplayable({ limit });
      for (const t of pending) {
        const payload = t.payload_json;
        if (!payload || typeof payload !== 'object') {
          // Tanpa payload → tidak bisa replay; tandai FAILED agar tidak macet.
          await turnRepository.markStatus({
            tenantId: t.tenant_id, provider: t.provider, inboundMessageId: t.inbound_message_id,
            status: 'FAILED', error: 'REPLAY_NO_PAYLOAD',
          });
          continue;
        }
        try {
          await turnRepository.markQueued({ tenantId: t.tenant_id, provider: t.provider, inboundMessageId: t.inbound_message_id });
          await queueService.enqueueMessage({
            tenantId: t.tenant_id,
            customerId: payload.customerId,
            phone: payload.phone,
            incomingMessage: payload.incomingMessage,
            provider: t.provider as any,
            inboundMessageId: t.inbound_message_id,
            turnId: `${t.tenant_id}:${t.provider}:${t.inbound_message_id}`,
          });
          replayed++;
        } catch (e: any) {
          console.warn(`[TURN RECOVERY] gagal replay ${t.inbound_message_id}:`, e?.message);
        }
      }
    } catch (err: any) {
      console.warn('[TURN RECOVERY] replayPendingTurns gagal:', err?.message);
    }
    if (replayed > 0) console.log(`[TURN RECOVERY] ${replayed} turn di-replay ke queue.`);
    return replayed;
  }

  /** Retention: hapus turn/ledger lebih lama dari N hari. */
  public async cleanupOldTurns(days = 60): Promise<number> {
    const deleted = await turnRepository.cleanupOlderThan(days);
    if (deleted > 0) console.log(`[TURN RECOVERY] retention: ${deleted} baris turn/ledger lama dihapus (>${days} hari).`);
    return deleted;
  }
}

export const turnRecoveryService = new TurnRecoveryService();

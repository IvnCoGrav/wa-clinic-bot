import { describe, it, expect, vi, beforeEach } from 'vitest';
import { turnRepository } from '../../src/repositories/turn.repository';
import { turnRecoveryService } from '../../src/services/turn-recovery.service';
import { queueService } from '../../src/services/queue.service';

/**
 * Stage 5 Fase 5 (RC-04) — recovery turn durable.
 * - Turn RECEIVED/QUEUED berpayload → di-enqueue ulang.
 * - Turn tanpa payload → ditandai FAILED (tidak macet).
 */
describe('TurnRecoveryService (Stage 5 / RC-04)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  it('turn berpayload di-replay → enqueue dipanggil', async () => {
    vi.spyOn(turnRepository, 'listReplayable').mockResolvedValueOnce([
      { tenant_id: 'default-tenant', provider: 'WAHA', inbound_message_id: 'm1', status: 'RECEIVED', payload_json: { customerId: 'c1', phone: '628111', incomingMessage: { id: 'm1' } } },
    ] as any);
    const markQueued = vi.spyOn(turnRepository, 'markQueued').mockResolvedValue(undefined as any);
    const enqueue = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);

    const n = await turnRecoveryService.replayPendingTurns();

    expect(n).toBe(1);
    expect(markQueued).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'default-tenant', inboundMessageId: 'm1' }));
  });

  it('turn tanpa payload → ditandai FAILED, tidak di-enqueue', async () => {
    vi.spyOn(turnRepository, 'listReplayable').mockResolvedValueOnce([
      { tenant_id: 'default-tenant', provider: 'WAHA', inbound_message_id: 'm2', status: 'RECEIVED', payload_json: null },
    ] as any);
    const markStatus = vi.spyOn(turnRepository, 'markStatus').mockResolvedValue(undefined as any);
    const enqueue = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);

    const n = await turnRecoveryService.replayPendingTurns();

    expect(n).toBe(0);
    expect(markStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', inboundMessageId: 'm2' }));
    expect(enqueue).not.toHaveBeenCalled();
  });
});

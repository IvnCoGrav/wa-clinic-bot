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

  it('W-001: boot replay meneruskan resetProcessingOnBoot agar turn PROCESSING macet ikut dipulihkan', async () => {
    const list = vi.spyOn(turnRepository, 'listReplayable').mockResolvedValueOnce([]);

    await turnRecoveryService.replayPendingTurns(50, { resetProcessingOnBoot: true });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, resetProcessingOnBoot: true })
    );
  });

  it('W-001: turn PROCESSING macet dengan payload di-replay, bukan dibiarkan menggantung', async () => {
    vi.spyOn(turnRepository, 'listReplayable').mockResolvedValueOnce([
      {
        tenant_id: 'tenant-a',
        provider: 'WAHA',
        inbound_message_id: 'm-processing',
        status: 'PROCESSING',
        attempts: 1,
        payload_json: { customerId: 'c9', phone: '628999', incomingMessage: { id: 'm-processing' } },
      },
    ] as any);
    vi.spyOn(turnRepository, 'markQueued').mockResolvedValue(undefined as any);
    const enqueue = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue(undefined as any);

    const n = await turnRecoveryService.replayPendingTurns(50, { resetProcessingOnBoot: true });

    expect(n).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', inboundMessageId: 'm-processing' })
    );
  });
});

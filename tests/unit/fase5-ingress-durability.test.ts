import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsappProviderService } from '../../src/services/whatsapp-provider.service';
import { prisma } from '../../src/db/client';
import { messageService } from '../../src/services/message.service';

describe('FASE 5.1: Ingress Durability & Kill-Switch Cache', () => {
  describe('5.1.1: W-005 Idempotency Check & Claim Separation', () => {
    it('isDuplicateMessage should be read-only and NOT mutate memory when message is new', async () => {
      const msgId = 'test-msg-readonly-' + Date.now();
      const tenantId = 'tenant-test-w005';

      // First call: not duplicate
      const isDup1 = await messageService.isDuplicateMessage(msgId, tenantId);
      expect(isDup1).toBe(false);

      // Second call: should STILL be false because isDuplicateMessage is read-only (no memory claim)
      const isDup2 = await messageService.isDuplicateMessage(msgId, tenantId);
      expect(isDup2).toBe(false);
    });

    it('claimMessageId and releaseMessageClaim should explicitly manage memory claims', async () => {
      const msgId = 'test-msg-claim-' + Date.now();
      const tenantId = 'tenant-test-w005';

      // Before claim: not duplicate
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(false);

      // Claim ID
      messageService.claimMessageId(msgId, tenantId);

      // Now it should be detected as duplicate
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(true);

      // Release claim
      messageService.releaseMessageClaim(msgId, tenantId);

      // After release: not duplicate again
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(false);
    });

    it('W-005: unparseable phone should not claim messageId, allowing retry to be processed', async () => {
      const msgId = 'test-unparseable-phone-' + Date.now();
      const tenantId = 'tenant-test-phone';
      // Ensure not claimed initially
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(false);

      // Simulate webhook processing: phone is missing/invalid, so claimMessageId is not invoked
      // Subsequent retry arrives:
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(false);
    });

    it('W-005: queue enqueue failure should not claim messageId, allowing retry to be processed', async () => {
      const msgId = 'test-enqueue-fail-' + Date.now();
      const tenantId = 'tenant-test-queue';

      // Step 1: Pre-enqueue check is false
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(false);

      // Step 2: Enqueue throws error, so claimMessageId is skipped
      // Step 3: Webhook retry arrives, should NOT be marked duplicate
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(false);

      // Step 4: Successful retry executes claimMessageId
      messageService.claimMessageId(msgId, tenantId);
      expect(await messageService.isDuplicateMessage(msgId, tenantId)).toBe(true);
    });

    it('W-003: getWahaClientForTenant should isolate clients and sessions per tenant', async () => {
      const { getWahaClientForTenant } = await import('../../src/integrations/whatsapp/factory');
      vi.spyOn(prisma.tenant, 'findUnique').mockImplementation(async ({ where }: any) => {
        if (where.id === 'tenant-alpha') {
          return { id: 'tenant-alpha', waha_session_id: 'session-alpha' } as any;
        }
        if (where.id === 'tenant-beta') {
          return { id: 'tenant-beta', waha_session_id: 'session-beta' } as any;
        }
        return null;
      });

      const clientAlpha = await getWahaClientForTenant('tenant-alpha');
      const clientBeta = await getWahaClientForTenant('tenant-beta');

      expect(clientAlpha.getSessionName()).toBe('session-alpha');
      expect(clientBeta.getSessionName()).toBe('session-beta');
      expect(clientAlpha.getSessionName()).not.toBe(clientBeta.getSessionName());
    });
  });

  describe('5.1.3: Outbound Kill-Switch TTL Cache', () => {
    let service: WhatsappProviderService;

    beforeEach(() => {
      vi.clearAllMocks();
      service = new WhatsappProviderService();
    });

    it('should respect 5-second TTL and re-query DB when cache expires', async () => {
      let dbValue = false;
      const findUniqueSpy = vi.spyOn(prisma.tenant, 'findUnique').mockImplementation(async () => {
        return { id: 'tenant-test', waha_outbound_cutoff: dbValue } as any;
      });

      // Call 1: reads from DB (dbValue = false)
      const val1 = await service.isOutboundCutOff('tenant-test');
      expect(val1).toBe(false);
      expect(findUniqueSpy).toHaveBeenCalledTimes(1);

      // Mutate DB state externally (e.g. from another container/admin)
      dbValue = true;

      // Call 2: within TTL, should use cache (not query DB again)
      const val2 = await service.isOutboundCutOff('tenant-test');
      expect(val2).toBe(false);
      expect(findUniqueSpy).toHaveBeenCalledTimes(1);

      // Advance time by 5001 ms (exceeding 5-second TTL)
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 6000);

      // Call 3: after TTL, should re-query DB and see the new state (dbValue = true)
      const val3 = await service.isOutboundCutOff('tenant-test');
      expect(val3).toBe(true);
      expect(findUniqueSpy).toHaveBeenCalledTimes(2);
    });

    it('setOutboundCutOff should update DB and invalidate/update cache immediately', async () => {
      const updateSpy = vi.spyOn(prisma.tenant, 'update').mockResolvedValue({ id: 'tenant-test' } as any);
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-test', waha_outbound_cutoff: true } as any);

      await service.setOutboundCutOff('tenant-test', true);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'tenant-test' },
        data: { waha_outbound_cutoff: true },
      });

      // Instant check should reflect true without waiting for DB
      expect(service.isOutboundCutOffSync('tenant-test')).toBe(true);
      const val = await service.isOutboundCutOff('tenant-test');
      expect(val).toBe(true);
    });
  });

  describe('5.1.2: Burst Coalesce Durable Turn Persistence', () => {
    it('should persist turn to turnRepository when buffering in maybeCoalesce', async () => {
      const origEnv = process.env.BURST_COALESCE_MS;
      process.env.BURST_COALESCE_MS = '7500';

      try {
        const { burstCoalesceService } = await import('../../src/services/burst-coalesce.service');
        const { turnRepository } = await import('../../src/repositories/turn.repository');
        const { ConversationState } = await import('@prisma/client');
        const persistSpy = vi.spyOn(turnRepository, 'persistInbound').mockResolvedValue(undefined as any);

        // Call maybeCoalesce with a sample message
        const result = await burstCoalesceService.maybeCoalesce({
          tenantId: 'tenant-test',
          customerId: 'cust-123',
          phone: '628123456789',
          conversation: { id: 'conv-123', current_state: ConversationState.INITIAL } as any,
          incomingMessage: { id: 'msg-abc-1', text: { body: 'halo bu' }, type: 'text' } as any,
        });

        expect(result.handled).toBe(true);
        expect(persistSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: 'tenant-test',
            inboundMessageId: 'msg-abc-1',
            customerId: 'cust-123',
            conversationId: 'conv-123',
          })
        );

        // Clean up timer
        await burstCoalesceService.flushAll();
      } finally {
        process.env.BURST_COALESCE_MS = origEnv;
      }
    });
  });

  describe('5.2: Replay Turn Macet & Alarm', () => {
    it('should replay stuck turns and mark max-attempt turns as FAILED', async () => {
      const { turnRecoveryService } = await import('../../src/services/turn-recovery.service');
      const { turnRepository } = await import('../../src/repositories/turn.repository');
      const { queueService } = await import('../../src/services/queue.service');

      const mockPendingTurns: any[] = [
        {
          tenant_id: 'default-tenant',
          provider: 'WAHA',
          inbound_message_id: 'msg-stuck-1',
          payload_json: { customerId: 'c1', phone: '081', incomingMessage: { id: 'msg-stuck-1' } },
          status: 'PROCESSING',
          attempts: 1,
        },
        {
          tenant_id: 'default-tenant',
          provider: 'WAHA',
          inbound_message_id: 'msg-exceeded-2',
          payload_json: { customerId: 'c2', phone: '082', incomingMessage: { id: 'msg-exceeded-2' } },
          status: 'PROCESSING',
          attempts: 5, // Exceeded max attempts
        },
      ];

      vi.spyOn(turnRepository, 'listReplayable').mockResolvedValue(mockPendingTurns);
      const markQueuedSpy = vi.spyOn(turnRepository, 'markQueued').mockResolvedValue(undefined as any);
      const markStatusSpy = vi.spyOn(turnRepository, 'markStatus').mockResolvedValue(undefined as any);
      const enqueueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue({ jobId: 'j1' } as any);

      const count = await turnRecoveryService.replayPendingTurns();

      // Only msg-stuck-1 should be replayed (msg-exceeded-2 is marked FAILED)
      expect(count).toBe(1);
      expect(markQueuedSpy).toHaveBeenCalledWith({
        tenantId: 'default-tenant',
        provider: 'WAHA',
        inboundMessageId: 'msg-stuck-1',
      });
      expect(enqueueSpy).toHaveBeenCalledTimes(1);

      expect(markStatusSpy).toHaveBeenCalledWith({
        tenantId: 'default-tenant',
        provider: 'WAHA',
        inboundMessageId: 'msg-exceeded-2',
        status: 'FAILED',
        error: 'MAX_REPLAY_ATTEMPTS_EXCEEDED',
      });
    });

    it('should emit alert when stuck turn count >= 10', async () => {
      const { turnRecoveryService } = await import('../../src/services/turn-recovery.service');
      const { turnRepository } = await import('../../src/repositories/turn.repository');
      const { alertService } = await import('../../src/services/alert.service');

      const tenStuckTurns: any[] = Array.from({ length: 12 }, (_, i) => ({
        tenant_id: 'default-tenant',
        provider: 'WAHA',
        inbound_message_id: `msg-stuck-${i}`,
        payload_json: { customerId: `c${i}`, phone: '081', incomingMessage: { id: `msg-stuck-${i}` } },
        status: 'RECEIVED',
        attempts: 1,
      }));

      vi.spyOn(turnRepository, 'listReplayable').mockResolvedValue(tenStuckTurns);
      vi.spyOn(turnRepository, 'markQueued').mockResolvedValue(undefined as any);
      const alertSpy = vi.spyOn(alertService, 'notifyAlert').mockResolvedValue({ sent: true } as any);

      await turnRecoveryService.replayPendingTurns();

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('TURN RECOVERY ALARM'),
        })
      );
    });
  });
});

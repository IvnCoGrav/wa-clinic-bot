import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryConversationRepository } from '../../src/repositories/conversation.repository';
import { InMemoryCustomerRepository } from '../../src/repositories/customer.repository';
import { InMemoryMessageRepository } from '../../src/repositories/message.repository';
import { TurnRepository } from '../../src/repositories/turn.repository';
import { prisma } from '../../src/db/client';

describe('D-18: Repository Concurrency & Multi-Tenant Isolation Tests', () => {
  describe('InMemoryConversationRepository concurrency', () => {
    it('parallel getOrCreate for same customer returns the exact same active conversation instance', async () => {
      const repo = new InMemoryConversationRepository();
      const customerId = 'cust_concurrent_1';
      const tenantId = 'tenant_alpha';

      // Jalankan 10 panggilan getOrCreate secara paralel
      const results = await Promise.all(
        Array.from({ length: 10 }, () => repo.getOrCreate(customerId, tenantId))
      );

      const firstId = results[0].id;
      for (const res of results) {
        expect(res.id).toBe(firstId);
        expect(res.tenant_id).toBe(tenantId);
      }
    });

    it('conversations for different tenants are completely isolated', async () => {
      const repo = new InMemoryConversationRepository();
      const customerId = 'cust_shared_id';

      const convA = await repo.getOrCreate(customerId, 'tenant_a');
      const convB = await repo.getOrCreate(customerId, 'tenant_b');

      expect(convA.id).not.toBe(convB.id);
      expect(convA.tenant_id).toBe('tenant_a');
      expect(convB.tenant_id).toBe('tenant_b');

      // Update state tenant A tidak mempengaruhi tenant B
      await repo.updateState(convA.id, { locationAttempts: 3 }, 'tenant_a');
      const fetchedB = await repo.findById(convB.id, 'tenant_b');
      expect(fetchedB.location_attempts ?? 0).toBe(0);
    });
  });

  describe('InMemoryCustomerRepository phone normalization & concurrency', () => {
    it('retrieves customer regardless of format variant (08xx vs 62xx)', async () => {
      const repo = new InMemoryCustomerRepository();
      await repo.create({
        tenant_id: 'tenant_1',
        phone: '628123456789',
        name: 'Bunda Rina',
      });

      // Cari dengan format 08xx
      const by08 = await repo.findByPhone('08123456789', 'tenant_1');
      expect(by08).not.toBeNull();
      expect(by08?.name).toBe('Bunda Rina');

      // Cari dengan format 62xx
      const by62 = await repo.findByPhone('628123456789', 'tenant_1');
      expect(by62).not.toBeNull();
      expect(by62?.name).toBe('Bunda Rina');
    });

    it('rejects cross-tenant customer updates', async () => {
      const repo = new InMemoryCustomerRepository();
      const created = await repo.create({
        tenant_id: 'tenant_alpha',
        phone: '628999888777',
        name: 'Target Cust',
      });

      // Update dengan tenant_beta harus melempar error
      await expect(
        repo.update(created.id, { name: 'Hacked Name' }, 'tenant_beta')
      ).rejects.toThrow(/bukan milik tenant tenant_beta/);
    });
  });

  describe('InMemoryMessageRepository deduplication parity (D-15)', () => {
    it('detects shortId suffix match correctly', async () => {
      const repo = new InMemoryMessageRepository();
      const tenantId = 'tenant_1';
      const fullWaId = 'false_628123456789@c.us_ABC123XYZ';
      const shortId = 'ABC123XYZ';

      await repo.create({
        tenant_id: tenantId,
        conversation_id: 'conv_1',
        direction: 'INBOUND',
        content: 'Halo bidan',
        wa_message_id: fullWaId,
      });

      // Cek dengan exact match
      expect(await repo.existsByWaId(fullWaId, shortId, tenantId)).toBe(true);
      // Cek dengan shortId yang cocok dengan suffix
      expect(await repo.existsByWaId('OTHER_FULL_ID', shortId, tenantId)).toBe(true);
      // Tenant lain tidak menemukan
      expect(await repo.existsByWaId(fullWaId, shortId, 'tenant_2')).toBe(false);
    });
  });

  describe('TurnRepository claimForProcessing edge cases (D-06)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns false when turn is already PROCESSING (prevents duplicate worker processing)', async () => {
      const turnRepo = new TurnRepository();
      // Mock updateMany returns count: 0 (already in PROCESSING)
      vi.mocked((prisma as any).inboundTurn.updateMany).mockResolvedValue({ count: 0 });
      // Mock findFirst returns record with status PROCESSING
      vi.mocked((prisma as any).inboundTurn.findFirst).mockResolvedValue({ status: 'PROCESSING' });

      const canClaim = await turnRepo.claimForProcessing({
        tenantId: 'tenant_1',
        provider: 'WAHA',
        inboundMessageId: 'msg_concurrent_turn',
      });

      // Harus FALSE agar worker kedua tidak memproses pesan ganda
      expect(canClaim).toBe(false);
    });
  });
});

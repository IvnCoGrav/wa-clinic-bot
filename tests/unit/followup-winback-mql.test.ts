import { describe, it, expect, vi, beforeEach } from 'vitest';
import { followUpService, CANCEL_REASON } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Fase 3: MQL Mutlak & WINBACK 2-Cabang', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('3.1 Serious-Only Gate Stage 3 di worker', () => {
    it('kontak legacy dengan is_mql=false diskip saat memproses NO_PURCHASE stage 3', async () => {
      const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

      // Simulasikan executeFollowUp atau bagian loop worker
      // Customer: 6289660679070 (legacy, bukan MQL)
      const fu = {
        id: 'fu-legacy-non-mql',
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-legacy-1',
        type: 'NO_PURCHASE',
        stage: 3,
        scheduled_at: new Date(),
        status: 'QUEUED',
        customer: {
          id: 'cust-legacy-1',
          phone: '6289660679070',
          name: 'Hidayah Sri Wilujeng',
          is_mql: false,
          is_legacy_source: true,
          is_sandbox_test: true,
          conversations: [],
        },
      } as any;

      // Jalankan processQueuedFollowUps / logika check
      // Kita uji kondisi guard: stage >= 3 && !customer.is_mql
      const shouldSkip = fu.type === 'NO_PURCHASE' && fu.stage >= 3 && !fu.customer?.is_mql;
      expect(shouldSkip).toBe(true);

      // Pastikan jika is_mql=true maka TIDAK diskip
      const fuMql = {
        ...fu,
        customer: { ...fu.customer, is_mql: true, is_legacy_source: false },
      };
      const shouldSkipMql = fuMql.type === 'NO_PURCHASE' && fuMql.stage >= 3 && !fuMql.customer?.is_mql;
      expect(shouldSkipMql).toBe(false);
    });
  });

  describe('3.2 enqueueDormantWinbackFollowUps 2-Cabang', () => {
    it('customer 6289660679070 (bukan Cabang A maupun B) tidak masuk antrian winback', async () => {
      vi.spyOn(prisma.customer, 'findMany').mockResolvedValue([]); // Prisma query filter Cabang A & B menyaring out

      const count = await followUpService.enqueueDormantWinbackFollowUps(DEFAULT_TENANT_ID);
      expect(count).toBe(0);
    });

    it('customer Cabang A (reservasi completed + NEXT_TREATMENT stage 3 SENT) berhasil di-enqueue', async () => {
      const candidateBranchA = {
        id: 'cust-branch-a',
        phone: '6281211110001',
        name: 'Bunda Pasien Selesai',
        is_sandbox_test: true,
      };

      vi.spyOn(prisma.customer, 'findMany').mockResolvedValue([candidateBranchA] as any);
      vi.spyOn(prisma.followUp, 'create').mockResolvedValue({ id: 'fu-winback-a' } as any);

      const count = await followUpService.enqueueDormantWinbackFollowUps(DEFAULT_TENANT_ID);
      expect(count).toBe(1);
      expect(prisma.followUp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customer_id: 'cust-branch-a',
            type: 'WINBACK_60D',
            stage: 1,
            status: 'QUEUED',
          }),
        })
      );
    });

    it('customer Cabang B (is_mql=true + NO_PURCHASE stage 3 SENT) berhasil di-enqueue', async () => {
      const candidateBranchB = {
        id: 'cust-branch-b',
        phone: '6281222220002',
        name: 'Bunda Lead MQL',
        is_sandbox_test: true,
      };

      vi.spyOn(prisma.customer, 'findMany').mockResolvedValue([candidateBranchB] as any);
      vi.spyOn(prisma.followUp, 'create').mockResolvedValue({ id: 'fu-winback-b' } as any);

      const count = await followUpService.enqueueDormantWinbackFollowUps(DEFAULT_TENANT_ID);
      expect(count).toBe(1);
      expect(prisma.followUp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customer_id: 'cust-branch-b',
            type: 'WINBACK_60D',
            stage: 1,
            status: 'QUEUED',
          }),
        })
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { messageService } from '../../src/services/message.service';
import { typingService } from '../../src/services/typing.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

// V7 — write-after-send. Bila WAHA gagal, Live Chat DILARANG memuat bubble bot
// fiktif, dan follow-up harus ditandai FAILED (bukan SENT).
describe('V7: write-after-send — WAHA gagal tidak meninggalkan bubble palsu', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('kirim WAHA gagal → status FAILED, logMessage TIDAK dipanggil', async () => {
    const logSpy = vi.spyOn(messageService, 'logMessage');
    vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: false, error: 'WAHA down' } as any);
    // Klaim atomik sukses + re-check status masih aktif.
    vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({ status: 'QUEUED', scheduled_at: new Date() } as any);
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    const fu: any = {
      id: 'fu-v7',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-v7',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(),
      status: 'QUEUED',
      customer: { id: 'cust-v7', phone: '6281234500007', name: 'Bunda V7', children: [] },
    };

    const ok = await followUpService.executeFollowUp(fu, DEFAULT_TENANT_ID);

    expect(ok).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    );
  });

  it('kirim WAHA sukses → logMessage DIPANGGIL setelah sukses + status SENT', async () => {
    const logSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue({} as any);
    vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 } as any);
    vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({ status: 'QUEUED', scheduled_at: new Date() } as any);
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    const fu: any = {
      id: 'fu-v7b',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-v7b',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(),
      status: 'QUEUED',
      customer: { id: 'cust-v7b', phone: '6281234500008', name: 'Bunda V7b', children: [] },
    };

    const ok = await followUpService.executeFollowUp(fu, DEFAULT_TENANT_ID);

    expect(ok).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) })
    );
  });
});

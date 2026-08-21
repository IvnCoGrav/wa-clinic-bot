import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { broadcastQueueService } from '../../src/services/broadcast-queue.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { TEMPLATES } from '../../src/config/persona';

describe('Broadcast Throttling & Queue Constraint Tests', () => {
  beforeAll(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.ENABLE_FOLLOWUP_WORKER = 'true';
  });

  let setTimeoutSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    const originalSetTimeout = global.setTimeout;
    setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any, ms?: number) => {
      if (ms !== undefined && ms >= 20000) {
        if (typeof cb === 'function') {
          process.nextTick(cb);
        }
        return 12345 as any;
      }
      return originalSetTimeout(cb, ms);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Job processed outside business hours (09:00-18:00) -> rescheduled to tomorrow 09:00', async () => {
    // Mock jam 20:00 (di luar jam kerja) menggunakan fake timer local time
    vi.setSystemTime(new Date(2026, 6, 24, 20, 0, 0));

    const followUpUpdateSpy = vi.mocked(prisma.followUp.update).mockResolvedValue({} as any);

    await broadcastQueueService.processBroadcastJob({
      followUpId: 'f-night',
      customerId: 'cust-1',
      tenantId: DEFAULT_TENANT_ID
    });

    // Harus me-reschedule ke PENDING dengan scheduled_at besok jam 09:00
    expect(followUpUpdateSpy).toHaveBeenCalledTimes(1);
    expect(followUpUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'f-night' },
        data: expect.objectContaining({
          status: 'PENDING',
          scheduled_at: expect.any(Date)
        })
      })
    );

    // Cek target tanggal besok jam 09:00
    const scheduledDate = followUpUpdateSpy.mock.calls[0][0].data.scheduled_at;
    expect(scheduledDate.getHours()).toBe(9);
  });

  it('Job processed inside business hours -> triggers human typing simulation and delay throttling', async () => {
    // Mock jam 10:00 pagi (dalam jam kerja)
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));

    const mockFollowUp = {
      id: 'f-day',
      customer_id: 'cust-1',
      type: 'NO_PURCHASE',
      stage: 1,
      status: 'QUEUED',
      tenant_id: DEFAULT_TENANT_ID,
      customer: {
        id: 'cust-1',
        name: 'Bunda Ceria',
        phone: '628999888',
        status: 'active'
      }
    };

    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(mockFollowUp as any);
    const followUpUpdateSpy = vi.mocked(prisma.followUp.update).mockResolvedValue({} as any);
    
    // Mock typing simulation
    const { typingService } = await import('../../src/services/typing.service');
    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 });

    await broadcastQueueService.processBroadcastJob({
      followUpId: 'f-day',
      customerId: 'cust-1',
      tenantId: DEFAULT_TENANT_ID
    });

    // Pastikan mengetik & kirim pesan terpanggil
    expect(simulateSpy).toHaveBeenCalledTimes(1);
    
    // Pastikan status diset SENT
    expect(followUpUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'f-day' },
        data: expect.objectContaining({
          status: 'SENT',
          sent_at: expect.any(Date)
        })
      })
    );

    // Pastikan throttling setTimeout dipanggil dengan jeda antara 20s - 45s
    expect(setTimeoutSpy).toHaveBeenCalled();
    const delayArg = setTimeoutSpy.mock.calls[0][1];
    expect(delayArg).toBeGreaterThanOrEqual(20000);
    expect(delayArg).toBeLessThanOrEqual(45000);
  });

  it('Template selection -> chooses a random variant from array', async () => {
    // Mock jam 10:00 pagi (dalam jam kerja)
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));

    const mockFollowUp = {
      id: 'f-variant',
      customer_id: 'cust-1',
      type: 'NO_PURCHASE',
      stage: 1,
      status: 'QUEUED',
      tenant_id: DEFAULT_TENANT_ID,
      customer: {
        id: 'cust-1',
        name: 'Bunda Ceria',
        phone: '628999888',
        status: 'active'
      }
    };

    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(mockFollowUp as any);
    vi.mocked(prisma.followUp.update).mockResolvedValue({} as any);
    
    const { typingService } = await import('../../src/services/typing.service');
    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 });

    await broadcastQueueService.processBroadcastJob({
      followUpId: 'f-variant',
      customerId: 'cust-1',
      tenantId: DEFAULT_TENANT_ID
    });

    // Ambil teks pesan terkirim
    const sentText = simulateSpy.mock.calls[0][0].replyText;
    
    // Harus merupakan salah satu dari varian template Day 3
    const possibleTemplates = TEMPLATES.followUpNoPurchaseDay3.map(fn => fn({ name: 'Bunda Ceria' }));
    expect(possibleTemplates).toContain(sentText);
  });

  it('Anti-Double-Enqueue constraint -> cron selects pending only, sets queued state immediately', async () => {
    const mockPendingFollowUps = [
      { id: 'f-p1', customer_id: 'c-1', tenant_id: DEFAULT_TENANT_ID, status: 'PENDING', stage: 1, scheduled_at: new Date() }
    ];

    // Mock query database: kembalikan list pending
    vi.mocked(prisma.followUp.findMany).mockResolvedValue(mockPendingFollowUps as any);
    const updateManySpy = vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as any);

    // Jalankan cron enqueue
    await broadcastQueueService.enqueuePendingFollowUps();

    // Verifikasi bahwa status langsung di-update menjadi QUEUED untuk mencegah run berikutnya menyeleksi pesan ini
    expect(updateManySpy).toHaveBeenCalledTimes(1);
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['f-p1'] } },
        data: { status: 'QUEUED' }
      })
    );

    // Jalankan cron sekali lagi. Jika query mengembalikan kosong (karena status sudah QUEUED di run 1):
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([]); // Tidak ada pending tersisa
    updateManySpy.mockClear();

    await broadcastQueueService.enqueuePendingFollowUps();

    // Tidak boleh ada enqueuing baru
    expect(updateManySpy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService, CANCEL_REASON } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Adversarial & edge-case suite untuk:
 * 1) Event-Driven Last-Chat Sliding Window (rescheduleNoPurchaseOnInboundChat)
 * 2) Cancel Reason di setiap titik lifecycle pembatalan/penundaan.
 */
describe('Follow-Up Inbound Sliding Window & Cancel Reason', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    vi.restoreAllMocks();
  });

  // ── 1. Sliding window ───────────────────────────────────────────────────────
  it('1. menggeser stage 1/2/3 ke chatAt + 3/7/14 hari tepat pukul 09:40 WIB', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([
      { id: 'fu-1', stage: 1, scheduled_at: new Date() },
      { id: 'fu-2', stage: 2, scheduled_at: new Date() },
      { id: 'fu-3', stage: 3, scheduled_at: new Date() },
    ] as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    // 2026-09-16 15:00 UTC = 22:00 WIB (chat malam)
    const chatAt = new Date('2026-09-16T15:00:00.000Z');
    const result = await followUpService.rescheduleNoPurchaseOnInboundChat('cust-1', DEFAULT_TENANT_ID, chatAt);

    expect(result).toEqual({ rescheduled: 3, cancelled: 0 });
    const dates = updateSpy.mock.calls.map((c: any) => c[0].data.scheduled_at as Date);
    expect(dates[0].toISOString()).toBe('2026-09-19T02:40:00.000Z'); // +3 hari 09:40 WIB
    expect(dates[1].toISOString()).toBe('2026-09-23T02:40:00.000Z'); // +7 hari
    expect(dates[2].toISOString()).toBe('2026-09-30T02:40:00.000Z'); // +14 hari
  });

  it('2. edge-case tengah malam WIB (00:30) dihitung dari tanggal WIB, bukan UTC', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([
      { id: 'fu-mid', stage: 1, scheduled_at: new Date() },
    ] as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    // 2026-09-16 17:30 UTC = 2026-09-17 00:30 WIB
    const chatAt = new Date('2026-09-16T17:30:00.000Z');
    await followUpService.rescheduleNoPurchaseOnInboundChat('cust-mid', DEFAULT_TENANT_ID, chatAt);

    const when = updateSpy.mock.calls[0][0].data.scheduled_at as Date;
    expect(when.toISOString()).toBe('2026-09-20T02:40:00.000Z'); // 17 Sep + 3 hari = 20 Sep
  });

  it('3. customer sudah punya reservasi aktif → CANCELLED dengan alasan, tanpa reschedule', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue({ id: 'res-1', status: 'confirmed' } as any);
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 3 } as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update');

    const result = await followUpService.rescheduleNoPurchaseOnInboundChat(
      'cust-has-res',
      DEFAULT_TENANT_ID,
      new Date()
    );

    expect(result).toEqual({ rescheduled: 0, cancelled: 3 });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED', cancel_reason: 'Customer sudah memiliki reservasi' },
      })
    );
  });

  it('4. tidak ada antrian aktif → no-op (tanpa query update)', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([] as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update');

    const result = await followUpService.rescheduleNoPurchaseOnInboundChat('cust-none', DEFAULT_TENANT_ID);
    expect(result).toEqual({ rescheduled: 0, cancelled: 0 });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('5. DB offline → best-effort, tidak melempar error', async () => {
    // default mock: reservation.findFirst & followUp.findMany menolak "Database offline"
    const result = await followUpService.rescheduleNoPurchaseOnInboundChat('cust-offline', DEFAULT_TENANT_ID);
    expect(result).toEqual({ rescheduled: 0, cancelled: 0 });
  });

  it('6. stage di luar rentang (0/99) di-clamp aman, tidak crash', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([
      { id: 'fu-low', stage: 0, scheduled_at: new Date() },
      { id: 'fu-high', stage: 99, scheduled_at: new Date() },
    ] as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    const result = await followUpService.rescheduleNoPurchaseOnInboundChat('cust-clamp', DEFAULT_TENANT_ID);
    expect(result.rescheduled).toBe(2);
    // stage 0 → clamp ke 1 (+3 hari); stage 99 → clamp ke 3 (+14 hari)
    expect(updateSpy.mock.calls[0][0].data.scheduled_at).toBeInstanceOf(Date);
    expect(updateSpy.mock.calls[1][0].data.scheduled_at).toBeInstanceOf(Date);
  });

  // ── 2. Cancel Reason ────────────────────────────────────────────────────────
  it('7. cancelFollowUp menyimpan reason manual; default bila dikosongkan', async () => {
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);

    await followUpService.cancelFollowUp('fu-a', DEFAULT_TENANT_ID, { reason: 'Customer minta tunda' });
    expect(updateManySpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { status: 'CANCELLED', cancel_reason: 'Customer minta tunda' },
      })
    );

    await followUpService.cancelFollowUp('fu-b', DEFAULT_TENANT_ID);
    expect(updateManySpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.MANUAL_ADMIN },
      })
    );

    // reason berisi spasi saja → dianggap kosong → default
    await followUpService.cancelFollowUp('fu-c', DEFAULT_TENANT_ID, { reason: '   ' });
    expect(updateManySpy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.MANUAL_ADMIN },
      })
    );
  });

  it('8. bulkCancelFollowUps menyimpan reason massal; default bila kosong', async () => {
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 5 } as any);

    await followUpService.bulkCancelFollowUps(DEFAULT_TENANT_ID, 'PENDING', { reason: 'Bersih-bersih antrian' });
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' },
        data: { status: 'CANCELLED', cancel_reason: 'Bersih-bersih antrian' },
      })
    );

    await followUpService.bulkCancelFollowUps(DEFAULT_TENANT_ID, 'QUEUED');
    expect(updateManySpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.BULK_ADMIN },
      })
    );
  });

  it('9. onReservationCreated menulis cancel_reason "Customer membuat reservasi baru"', async () => {
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([{ id: 'f-1' }, { id: 'f-2' }] as any);
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 2 } as any);
    vi.spyOn(prisma.reservation, 'update').mockResolvedValue({} as any);

    await followUpService.onReservationCreated('cust-r', 'res-new', DEFAULT_TENANT_ID);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CREATED },
      })
    );
  });

  it('10. onReservationCancelled menulis cancel_reason "Reservasi terkait dibatalkan"', async () => {
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 2 } as any);
    await followUpService.onReservationCancelled('res-x', DEFAULT_TENANT_ID);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CANCELLED },
      })
    );
  });

  it('11. worker menandai overdue >48 jam sebagai SKIPPED + alasan kadaluarsa', async () => {
    const overdue = {
      id: 'fu-overdue',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-overdue',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 hari lalu
      status: 'QUEUED',
      customer: {
        id: 'cust-overdue',
        phone: '628111000111',
        status: 'active',
        is_sandbox_test: false,
        is_admin_labeled: false,
        labels: [],
        conversations: [],
      },
    };
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([overdue] as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    const processed = await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);

    expect(processed).toBe(0);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.OVERDUE_48H },
      })
    );
  });

  it('12. worker menandai kontak berlabel bypass sebagai SKIPPED + alasan label', async () => {
    const bypass = {
      id: 'fu-bypass',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-bypass',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(Date.now() - 60 * 1000),
      status: 'QUEUED',
      customer: {
        id: 'cust-bypass',
        phone: '628111000222',
        status: 'active',
        is_sandbox_test: false,
        is_admin_labeled: true,
        labels: [],
        conversations: [],
      },
    };
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([bypass] as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
      })
    );
  });
});

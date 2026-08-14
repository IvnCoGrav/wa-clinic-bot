import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { cronService } from '../../src/services/cron.service';
import { broadcastQueueService } from '../../src/services/broadcast-queue.service';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildApp } from '../../src/app';

describe('Follow-Up Schedule & State Transition Tests', () => {
  beforeAll(() => {
    process.env.ADMIN_API_KEY = 'my_admin_api_key_secret';
    process.env.HUMANIZER_ENABLED = 'false';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const originalSetTimeout = global.setTimeout;
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: any, ms?: number) => {
      if (ms !== undefined && ms >= 20000) {
        if (typeof cb === 'function') {
          process.nextTick(cb);
        }
        return 12345 as any;
      }
      return originalSetTimeout(cb, ms);
    });
  });

  it('Customer creation -> automatically schedules 3 NO_PURCHASE follow-ups', async () => {
    const followUpCreateSpy = vi.mocked(prisma.followUp.create).mockResolvedValue({} as any);

    // Mock Prisma customer findFirst to return null (triggering creation) and create to succeed
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.customer.create).mockResolvedValue({
      id: 'cust-abc',
      phone: '628111222333',
      tenant_id: DEFAULT_TENANT_ID,
    } as any);

    // Trigger customer creation
    const customer = await customerService.getOrCreateCustomer('628111222333', 'Bunda Amel', DEFAULT_TENANT_ID);

    expect(customer.id).toBe('cust-abc');
    
    // Verifikasi bahwa prisma.followUp.create dipanggil 3 kali (stage 1, 2, 3)
    expect(followUpCreateSpy).toHaveBeenCalledTimes(3);

    // Pastikan type-nya adalah NO_PURCHASE
    expect(followUpCreateSpy.mock.calls[0][0].data.type).toBe('NO_PURCHASE');
    expect(followUpCreateSpy.mock.calls[0][0].data.stage).toBe(1);
    expect(followUpCreateSpy.mock.calls[1][0].data.stage).toBe(2);
    expect(followUpCreateSpy.mock.calls[2][0].data.stage).toBe(3);

    // Pastikan scheduled_at ditambahkan hari (+3, +7, +14)
    const now = new Date();
    const scheduled1 = new Date(followUpCreateSpy.mock.calls[0][0].data.scheduled_at);
    const scheduled2 = new Date(followUpCreateSpy.mock.calls[1][0].data.scheduled_at);
    const scheduled3 = new Date(followUpCreateSpy.mock.calls[2][0].data.scheduled_at);
    
    expect(Math.round((scheduled1.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))).toBe(3);
    expect(Math.round((scheduled2.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))).toBe(7);
    expect(Math.round((scheduled3.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))).toBe(14);
  });

  it('Reservation creation -> cancels all active PENDING/QUEUED follow-ups', async () => {
    const activeFollowUps = [
      { id: 'f-1', status: 'PENDING' },
      { id: 'f-2', status: 'QUEUED' }
    ];

    vi.mocked(prisma.followUp.findMany).mockResolvedValue(activeFollowUps as any);
    const updateManySpy = vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 2 } as any);
    const reservationUpdateSpy = vi.mocked(prisma.reservation.update).mockResolvedValue({} as any);

    // Pemicu event reservasi dibuat
    await followUpService.onReservationCreated('cust-abc', 'res-111', DEFAULT_TENANT_ID);

    // Harus mencari dan membatalkan follow-up yang aktif
    expect(updateManySpy).toHaveBeenCalledTimes(1);
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['f-1', 'f-2'] } },
        data: { status: 'CANCELLED' }
      })
    );

    // Harus menandai reservasi baru sebagai repeat order
    expect(reservationUpdateSpy).toHaveBeenCalledTimes(1);
    expect(reservationUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-111' },
        data: { is_repeat_order: true }
      })
    );
  });

  it('Reservation completion (H+1 cron) -> schedules 3 NEXT_TREATMENT follow-ups', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayReservations = [
      {
        id: 'res-yesterday',
        customer_id: 'cust-abc',
        treatment_category: 'BABY',
        booking_date: yesterday,
        raw_text: 'Nama Bayi: Adek Ganteng',
        customer: {
          id: 'cust-abc',
          phone: '628111222333',
          name: 'Bunda Amel'
        }
      }
    ];

    // Mock DB queries inside cronService
    vi.mocked(prisma.reservation.findMany)
      .mockResolvedValueOnce([]) // Reminders hari H (kosong)
      .mockResolvedValueOnce(yesterdayReservations as any); // H+1 Reviews

    vi.mocked(prisma.followUp.findFirst).mockResolvedValue(null);
    const followUpCreateSpy = vi.mocked(prisma.followUp.create).mockResolvedValue({} as any);

    // Jalankan cron
    await cronService.runMorningJobs();

    // Pastikan follow-up NEXT_TREATMENT terbuat 3 kali
    expect(followUpCreateSpy).toHaveBeenCalledTimes(3);
    expect(followUpCreateSpy.mock.calls[0][0].data.type).toBe('NEXT_TREATMENT');
    expect(followUpCreateSpy.mock.calls[0].map(c => c.data.stage)).toContain(1);
  });

  it('Stage 3 next_treatment sent -> marks customer status as lost after 3 days grace period', async () => {
    const sentAt = new Date();
    sentAt.setDate(sentAt.getDate() - 3); // 3 hari yang lalu

    const mockFollowUp = {
      id: 'f-stage3',
      customer_id: 'cust-lost-id',
      type: 'NEXT_TREATMENT',
      stage: 3,
      status: 'SENT',
      sent_at: sentAt,
      tenant_id: DEFAULT_TENANT_ID,
      customer: {
        id: 'cust-lost-id',
        name: 'Bunda Sad',
        phone: '628111222333',
        status: 'active'
      }
    };

    // Mock findMany untuk mendeteksi followUp sent stage 3 ini
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([mockFollowUp] as any);
    // Mock reservation.findMany (batch) to return [] (no new reservation since min(sent_at))
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);

    const customerUpdateSpy = vi.mocked(prisma.customer.update).mockResolvedValue({} as any);

    // Jalankan pengecekan lost customer
    await followUpService.checkAndSetLostCustomers(DEFAULT_TENANT_ID);

    // Harus meng-update status customer ke 'lost'
    expect(customerUpdateSpy).toHaveBeenCalledTimes(1);
    expect(customerUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-lost-id' },
        data: { status: 'lost' }
      })
    );
  });

  it('Stage 3 sent -> customer dengan reservasi SETELAH sent_at-nya TIDAK di-mark lost (semantik per sent_at)', async () => {
    const sentAt = new Date();
    sentAt.setDate(sentAt.getDate() - 3); // 3 hari yang lalu

    const mockFollowUp = {
      id: 'f-stage3-has-res',
      customer_id: 'cust-still-active',
      type: 'NEXT_TREATMENT',
      stage: 3,
      status: 'SENT',
      sent_at: sentAt,
      tenant_id: DEFAULT_TENANT_ID,
      customer: {
        id: 'cust-still-active',
        name: 'Bunda Booking Baru',
        phone: '628111222334',
        status: 'active'
      }
    };

    vi.mocked(prisma.followUp.findMany).mockResolvedValue([mockFollowUp] as any);
    // Batch query mengembalikan 1 reservasi yang dibuat SETELAH sent_at → tidak boleh lost
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        customer_id: 'cust-still-active',
        created_at: new Date(sentAt.getTime() + 60 * 60 * 1000), // 1 jam setelah sent_at
      },
    ] as any);

    const customerUpdateSpy = vi.mocked(prisma.customer.update).mockResolvedValue({} as any);

    await followUpService.checkAndSetLostCustomers(DEFAULT_TENANT_ID);

    // Customer dengan booking baru tetap aktif (status TIDAK diganti)
    expect(customerUpdateSpy).not.toHaveBeenCalled();
  });

  it('Reservation cancellation (DELETE route) -> recreates NO_PURCHASE follow-ups if none exist', async () => {
    const mockReservation = {
      id: 'res-cancelled',
      customer_id: 'cust-cancelled',
      booking_date: new Date(),
      treatment_detail: 'Facial',
      status: 'confirmed',
      customer: {
        id: 'cust-cancelled',
        name: 'Bunda Rini',
        phone: '62811223344'
      }
    };

    // 1. Simulasikan tidak ada follow-up aktif
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockReservation as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({ ...mockReservation, status: 'cancelled' } as any);
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue(null); // Tidak ada yang aktif

    const followUpCreateSpy = vi.mocked(prisma.followUp.create).mockResolvedValue({} as any);

    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-cancelled',
      headers: {
        'x-api-key': 'my_admin_api_key_secret',
      }
    });

    expect(res.statusCode).toBe(200);
    
    // Harus membuat kembali 3 follow-up NO_PURCHASE
    expect(followUpCreateSpy).toHaveBeenCalledTimes(3);
    expect(followUpCreateSpy.mock.calls[0][0].data.type).toBe('NO_PURCHASE');
    
    await app.close();
  });
});

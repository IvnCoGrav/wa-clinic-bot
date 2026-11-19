import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { followUpAdminRoutes } from '../../src/routes/admin/follow-up.subroute';
import { followUpService } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';

describe('Follow-Up Admin Subroute Integration Tests', () => {
  let app: any;

  beforeEach(async () => {
    app = Fastify();
    await app.register(followUpAdminRoutes);
    vi.restoreAllMocks();
  });

  it('1. GET /api/admin/follow-ups returns list and pagination', async () => {
    const listSpy = vi.spyOn(followUpService, 'listFollowUps').mockResolvedValueOnce({
      data: [
        {
          id: 'fu-1',
          type: 'NO_PURCHASE',
          stage: 1,
          status: 'PENDING',
          scheduled_at: new Date().toISOString(),
          customer: { name: 'Bunda Test', phone: '628123456789' },
        },
      ],
      pagination: {
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/follow-ups?status=PENDING&page=1',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.pagination.total).toBe(1);
    expect(listSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'PENDING', page: 1 }));
  });

  it('2. POST /api/admin/follow-ups/:id/send-now triggers manual send', async () => {
    const sendSpy = vi.spyOn(followUpService, 'sendNow').mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/fu-1/send-now',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.message).toContain('berhasil dikirim');
    expect(sendSpy).toHaveBeenCalledWith('fu-1', expect.any(String));
  });

  it('2b. POST /api/admin/follow-ups/:id/queue queues follow-up to QUEUED status', async () => {
    const queueSpy = vi.spyOn(followUpService, 'queueFollowUp').mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/fu-1/queue',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.message).toContain('berhasil dijadwalkan');
    expect(queueSpy).toHaveBeenCalledWith('fu-1', expect.any(String));
  });

  it('2c. POST /api/admin/follow-ups/bulk-queue queues all pending follow-ups', async () => {
    const bulkQueueSpy = vi.spyOn(followUpService, 'bulkQueueFollowUps').mockResolvedValueOnce(3);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/bulk-queue',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.count).toBe(3);
    expect(bulkQueueSpy).toHaveBeenCalledWith(expect.any(String));
  });

  it('3. PATCH /api/admin/follow-ups/:id/cancel cancels follow-up', async () => {
    const cancelSpy = vi.spyOn(followUpService, 'cancelFollowUp').mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/follow-ups/fu-1/cancel',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(cancelSpy).toHaveBeenCalledWith('fu-1', expect.any(String));
  });

  it('3b. PATCH /api/admin/follow-ups/:id/cancel meneruskan reason ke service', async () => {
    const cancelSpy = vi.spyOn(followUpService, 'cancelFollowUp').mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/follow-ups/fu-1/cancel',
      payload: { reason: 'Customer minta ditunda' },
    });

    expect(res.statusCode).toBe(200);
    expect(cancelSpy).toHaveBeenCalledWith('fu-1', expect.any(String), { reason: 'Customer minta ditunda' });
  });

  it('3c. PATCH cancel tanpa reason tetap memanggil service tanpa opsi reason', async () => {
    const cancelSpy = vi.spyOn(followUpService, 'cancelFollowUp').mockResolvedValueOnce(true);

    await app.inject({
      method: 'PATCH',
      url: '/api/admin/follow-ups/fu-1/cancel',
      payload: { reason: '   ' },
    });

    expect(cancelSpy).toHaveBeenCalledWith('fu-1', expect.any(String));
  });

  it('4. POST /api/admin/follow-ups/bulk-cancel cancels all pending follow-ups', async () => {
    const bulkSpy = vi.spyOn(followUpService, 'bulkCancelFollowUps').mockResolvedValueOnce(5);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/bulk-cancel',
      payload: { status: 'PENDING' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.count).toBe(5);
    expect(bulkSpy).toHaveBeenCalledWith(expect.any(String), 'PENDING');
  });

  it('4b. POST bulk-cancel meneruskan reason ke service', async () => {
    const bulkSpy = vi.spyOn(followUpService, 'bulkCancelFollowUps').mockResolvedValueOnce(2);

    await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/bulk-cancel',
      payload: { status: 'QUEUED', reason: 'Bersih-bersih antrian' },
    });

    expect(bulkSpy).toHaveBeenCalledWith(expect.any(String), 'QUEUED', { reason: 'Bersih-bersih antrian' });
  });

  it('5. PATCH /api/admin/follow-ups/:id/reschedule updates scheduled date', async () => {
    const rescheduleSpy = vi.spyOn(followUpService, 'rescheduleFollowUp').mockResolvedValueOnce({
      id: 'fu-1',
      scheduled_at: new Date('2026-08-30T10:00:00.000Z'),
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/follow-ups/fu-1/reschedule',
      payload: { scheduledAt: '2026-08-30T10:00:00.000Z' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(rescheduleSpy).toHaveBeenCalledWith('fu-1', expect.any(Date), expect.any(String));
  });

  it('6. GET /api/admin/follow-ups supports sortBy and sortOrder', async () => {
    const listSpy = vi.spyOn(followUpService, 'listFollowUps').mockResolvedValueOnce({
      data: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/follow-ups?sortBy=customer_name&sortOrder=asc',
    });

    expect(res.statusCode).toBe(200);
    expect(listSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sortBy: 'customer_name', sortOrder: 'asc' })
    );
  });

  it('7. POST /api/admin/follow-ups/reschedule-overdue triggers batch rescheduling', async () => {
    const rescheduleOverdueSpy = vi.spyOn(followUpService, 'rescheduleOverdueFollowUps').mockResolvedValueOnce({
      rescheduledCount: 20,
      daysCount: 2,
      distribution: { '2026-08-25': 10, '2026-08-26': 10 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/reschedule-overdue',
      payload: { maxPerDay: 10 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.rescheduledCount).toBe(20);
    expect(rescheduleOverdueSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxPerDay: 10 })
    );
  });

  it('8. PATCH /api/admin/follow-ups/:id updates scheduledAt, stage, and customText', async () => {
    const updateSpy = vi.spyOn(followUpService, 'updateFollowUp').mockResolvedValueOnce({
      id: 'fu-1',
      scheduled_at: new Date('2026-12-01T02:00:00.000Z'),
      stage: 2,
      custom_text: 'Halo Bunda {name}! Teks kustom.',
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/follow-ups/fu-1',
      payload: {
        scheduledAt: '2026-12-01T02:00:00.000Z',
        stage: 2,
        customText: 'Halo Bunda {name}! Teks kustom.',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      'fu-1',
      expect.objectContaining({
        stage: 2,
        customText: 'Halo Bunda {name}! Teks kustom.',
      }),
      expect.any(String)
    );
  });

  it('9. GET /api/admin/follow-ups supports dateFilter query parameter', async () => {
    const listSpy = vi.spyOn(followUpService, 'listFollowUps').mockResolvedValueOnce({
      data: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/follow-ups?dateFilter=upcoming',
    });

    expect(res.statusCode).toBe(200);
    expect(listSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ dateFilter: 'upcoming' })
    );
  });

  it('10. POST /api/admin/follow-ups/reschedule-overdue ditolak 409 saat mode libur active', async () => {
    const { followUpHolidayService } = await import('../../src/services/followup-holiday.service');
    vi.spyOn(followUpHolidayService, 'getStatus').mockResolvedValueOnce({
      config: { enabled: true } as any,
      state: { status: 'active', mode: 'manual' },
      backlogCount: 15,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/reschedule-overdue',
      payload: { maxPerDay: 40 },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Mode Libur sedang aktif');
  });

  it('11. GET /api/admin/follow-ups/holiday-mode mengembalikan config, state, dan backlogCount', async () => {
    const { followUpHolidayService } = await import('../../src/services/followup-holiday.service');
    vi.spyOn(followUpHolidayService, 'getStatus').mockResolvedValueOnce({
      config: { enabled: false, startDate: null, endDate: null } as any,
      state: { status: 'inactive' },
      backlogCount: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/follow-ups/holiday-mode',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.config.enabled).toBe(false);
    expect(body.data.state.status).toBe('inactive');
  });

  it('12. POST /api/admin/follow-ups/holiday-mode validasi input & perbarui config', async () => {
    const { followUpHolidayService } = await import('../../src/services/followup-holiday.service');
    vi.spyOn(followUpHolidayService, 'getConfig').mockResolvedValueOnce({
      enabled: false,
      startDate: null,
      endDate: null,
    } as any);

    const updateSpy = vi.spyOn(followUpHolidayService, 'updateConfig').mockResolvedValueOnce({
      enabled: true,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      reason: 'Libur Cuti Bersama',
      autoRescheduleOnExit: true,
      staleCapDays: 14,
      windowStartMinWib: 540,
      windowEndMinWib: 990,
      manualActivatedAt: null,
      lastRescheduledAt: null,
      lastRescheduleSummary: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/holiday-mode',
      payload: {
        enabled: true,
        startDate: '2026-12-24',
        endDate: '2026-12-26',
        reason: 'Libur Cuti Bersama',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.config.enabled).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        enabled: true,
        startDate: '2026-12-24',
        endDate: '2026-12-26',
      })
    );
  });

  it('13. POST disable memakai endDate sebagai kunci keluar (anti double reschedule)', async () => {
    const { followUpHolidayService } = await import('../../src/services/followup-holiday.service');
    vi.spyOn(followUpHolidayService, 'getConfig').mockResolvedValueOnce({
      enabled: true,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      autoRescheduleOnExit: true,
    } as any);
    vi.spyOn(followUpHolidayService, 'updateConfig').mockResolvedValueOnce({
      enabled: false,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      autoRescheduleOnExit: true,
    } as any);
    const exitSpy = vi.spyOn(followUpHolidayService, 'runExitReschedule').mockResolvedValueOnce({
      rescheduledCount: 1,
      daysCount: 1,
      distribution: {},
      executedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/holiday-mode',
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(exitSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'exit_pending', exitEndDate: '2026-12-26' }),
      expect.any(Date),
      expect.any(Function)
    );
  });

  it('14. POST holiday-mode menyimpan kuota harian tenant (maxPerDay)', async () => {
    const { followUpHolidayService } = await import('../../src/services/followup-holiday.service');
    vi.spyOn(followUpHolidayService, 'getConfig').mockResolvedValueOnce({
      enabled: false,
      startDate: null,
      endDate: null,
    } as any);
    vi.spyOn(followUpHolidayService, 'updateConfig').mockResolvedValueOnce({
      enabled: false,
      startDate: null,
      endDate: null,
      autoRescheduleOnExit: true,
    } as any);
    const quotaSpy = vi.spyOn(followUpHolidayService, 'updateQuota').mockResolvedValueOnce(25);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/follow-ups/holiday-mode',
      payload: { enabled: false, maxPerDay: 25 },
    });

    expect(res.statusCode).toBe(200);
    expect(quotaSpy).toHaveBeenCalledWith(expect.any(String), 25);
    const body = JSON.parse(res.body);
    expect(body.data.maxPerDay).toBe(25);
  });
});

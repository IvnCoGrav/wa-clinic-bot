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
});

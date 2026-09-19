import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { FastifyInstance } from 'fastify';
import { queueService } from '../../src/services/queue.service';

const ADMIN_KEY = 'test_admin_key_active_res';
const ADMIN_HEADERS = { 'x-api-key': ADMIN_KEY };

/**
 * GET /api/admin/customers/:id/active-reservations
 *
 * Seam: HTTP response endpoint (public interface).
 * Tujuan: modal Create Reservation & Live Chat mendapat daftar jadwal aktif
 * (confirmed/hold, hari ini atau ke depan) untuk mencegah booking duplikat.
 */
describe('Active Reservations endpoint (anti split-brain booking)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('mengembalikan jadwal confirmed/hold hari ini atau ke depan, urut booking_date asc', async () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'res-1', status: 'confirmed', treatment_detail: 'Pijat Bayi', treatment_category: 'BABY', booking_date: future, duration_minutes: 60, assigned_staff_id: null, is_repeat_order: false },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-aktif/active-reservations',
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.data[0].id).toBe('res-1');
    expect(body.data[0].status).toBe('confirmed');
  });

  it('meneruskan filter status confirmed|hold dan batas booking_date >= awal hari ini (WIB)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-query/active-reservations',
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const call = vi.mocked(prisma.reservation.findMany).mock.calls.at(-1)![0] as any;
    expect(call.where.customer_id).toBe('cust-query');
    expect(call.where.tenant_id).toBe('default-tenant');
    expect(call.where.status).toEqual({ in: ['confirmed', 'hold'] });
    expect(call.where.booking_date.gte).toBeInstanceOf(Date);
    // Awal hari WIB harus tengah malam WIB (= 17:00 UTC hari sebelumnya).
    expect(call.where.booking_date.gte.getUTCHours()).toBe(17);
    expect(call.orderBy).toEqual({ booking_date: 'asc' });
  });

  it('DB offline → 500 dengan pesan error (fail-explicit, bukan diam-diam kosong)', async () => {
    vi.mocked(prisma.reservation.findMany).mockRejectedValueOnce(new Error('Database offline'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/cust-offline/active-reservations',
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { FastifyInstance } from 'fastify';
import { queueService } from '../../src/services/queue.service';

const ADMIN_KEY = 'test_admin_key_capi_attribution';
const TENANT = 'default-tenant';
const HEADERS = { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT };
const NOW = new Date('2026-10-01T04:00:00.000Z');

function mainRow(over: Record<string, any> = {}) {
  return {
    id: 'res-x',
    status: 'confirmed',
    treatment_category: 'BABY',
    treatment_detail: 'Pijat Bayi',
    purchase_occurred_at: NOW,
    created_at: NOW,
    purchase_value: 160000,
    purchase_review_status: 'pending',
    is_repeat_order: false,
    raw_text: '',
    customer_id: 'cust-x',
    customer: {
      id: 'cust-x',
      name: 'Bunda X',
      phone: '628123456799',
      distance_km: null,
      adClick: null,
      children: [],
    },
    ...over,
  };
}

/**
 * Seam: HTTP `GET /api/admin/capi-queue`.
 *
 * Mengunci perbaikan fondasional:
 * 1. Otoritas new-vs-repeat = ordinal riwayat transaksi (confirmed/en_route/completed),
 *    BUKAN flag `is_repeat_order` yang bisa terkontaminasi (bug follow-up lama).
 *    Order #1 SELALU 'new' walau flag DB `true`.
 * 2. Moderasi Lead: log audit TERBARU menang (newest-wins) — reject/outlier
 *    tidak lagi tertimpa log SENT lama.
 * 3. Anti-duplikasi Lead vs Purchase: query Lead wajib mengecualikan customer
 *    yang sudah punya reservasi aktif (state-gate `reservations.none`).
 */
describe('GET /api/admin/capi-queue — otoritas ordinal & moderasi Lead', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_llm_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    (prisma as any).auditLog = { findMany: vi.fn().mockResolvedValue([]) };
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('Order #1 dengan flag DB `is_repeat_order=true` (kontaminasi) TETAP new/order 1', async () => {
    vi.mocked(prisma.reservation.findMany).mockImplementation(async (args: any) => {
      if (args?.select?.customer_id) {
        return [{ id: 'res-first', customer_id: 'cust-baru', created_at: NOW }] as any;
      }
      return [
        mainRow({
          id: 'res-first',
          customer_id: 'cust-baru',
          is_repeat_order: true, // bug lama: transaksi pertama berlabel repeat
          customer: { id: 'cust-baru', name: 'Bunda Baru', phone: '628123456701', distance_km: null, adClick: null, children: [] },
        }),
      ] as any;
    });
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([] as any);
    (prisma as any).auditLog.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/capi-queue', headers: HEADERS });
    expect(res.statusCode).toBe(200);
    const item = JSON.parse(res.body).data.find((d: any) => d.id === 'res-first');

    expect(item.order_number).toBe(1);
    expect(item.customer_type).toBe('new');
    expect(item.is_repeat_order).toBe(false);
  });

  it('Order #2 (flag DB bersih `false`) → repeat/order 2 (ordinal riwayat menang)', async () => {
    vi.mocked(prisma.reservation.findMany).mockImplementation(async (args: any) => {
      if (args?.select?.customer_id) {
        return [
          { id: 'res-old', customer_id: 'cust-rep', created_at: new Date(NOW.getTime() - 100000) },
          { id: 'res-second', customer_id: 'cust-rep', created_at: NOW },
        ] as any;
      }
      return [
        mainRow({
          id: 'res-second',
          customer_id: 'cust-rep',
          is_repeat_order: false, // flag lama salah; ordinal tetap benar
          customer: { id: 'cust-rep', name: 'Bunda Repeat', phone: '628123456702', distance_km: null, adClick: null, children: [] },
        }),
      ] as any;
    });
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([] as any);
    (prisma as any).auditLog.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/capi-queue', headers: HEADERS });
    const item = JSON.parse(res.body).data.find((d: any) => d.id === 'res-second');

    expect(item.order_number).toBe(2);
    expect(item.customer_type).toBe('repeat');
    expect(item.is_repeat_order).toBe(true);
  });

  it('Moderasi Lead: log TERBARU (REJECTED) menang atas SENT lama → ignored_outlier', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.customer.findMany).mockImplementation(async (args: any) => {
      if (args?.where?.id?.notIn) return [] as any; // tidak ada unsent baru
      if (args?.where?.id?.in) {
        return [
          { id: 'cust-lady', name: 'Bunda Lady', phone: '628123456703', created_at: NOW, mql_bubble_count: 6, adClick: null, is_sandbox_test: false },
        ] as any;
      }
      return [] as any;
    });
    // Sudah diurut DESC oleh DB → elemen pertama = log terbaru (REJECTED).
    (prisma as any).auditLog.findMany.mockResolvedValue([
      { target_id: 'cust-lady', action: 'MQL_LEAD_EVENT_REJECTED', created_at: NOW },
      { target_id: 'cust-lady', action: 'MQL_LEAD_EVENT_SENT', created_at: new Date(NOW.getTime() - 60000) },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/capi-queue', headers: HEADERS });
    const item = JSON.parse(res.body).data.find((d: any) => d.id === 'lead_cust-lady');

    expect(item).toBeTruthy();
    expect(item.purchase_review_status).toBe('ignored_outlier');
  });

  it('Kontrak de-duplikasi: query Lead (unsent & riwayat) mengecualikan customer yang sudah closing', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([] as any);
    (prisma as any).auditLog.findMany.mockResolvedValue([
      { target_id: 'cust-lady', action: 'MQL_LEAD_EVENT_REJECTED', created_at: NOW },
    ]);

    await app.inject({ method: 'GET', url: '/api/admin/capi-queue', headers: HEADERS });

    const calls = vi.mocked(prisma.customer.findMany).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      const where = (call[0] as any)?.where ?? {};
      expect(where.reservations).toEqual({
        none: {
          tenant_id: TENANT,
          status: { in: ['confirmed', 'en_route', 'completed'] },
        },
      });
    }
  });
});

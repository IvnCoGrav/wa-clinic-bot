import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryAdClicks, memoryPageViews } from '../../src/routes/tracking.route';

/**
 * Regresi bug live "CAPI Events Delivered 104 > Klik CTA 92".
 *
 * Akar: meta-attribution.subroute.ts menghitung mql/pending/approved TANPA
 * dateRange (all-time), sementara views/clicks/matched pakai dateRange →
 * capiEventsDelivered = matched(4) + approvedAllTime(100) bocor melebihi klik.
 *
 * Skenario: DB ONLINE (count resolve), sehingga jalur DB diuji, bukan fallback
 * in-memory. Mock membedakan count in-range vs all-time lewat keberadaan
 * filter tanggal pada `where` (mql_triggered_at / purchase_event_sent_at).
 */
describe('Meta Summary Date-Range — Purchase & CAPI tidak bocor all-time', () => {
  const app = buildApp();

  const VIEWS = 6;
  const CLICKS = 92;
  const MATCHED = 4;
  const MQL_IN_RANGE = 2;
  const MQL_ALL_TIME = 9;
  const APPROVED_IN_RANGE = 3;
  const APPROVED_ALL_TIME = 100;
  const PENDING_QUEUE = 5;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    vi.restoreAllMocks();
    memoryAdClicks.clear();
    memoryPageViews.clear();

    // Jalur DB sukses: seluruh model count di Promise.all harus resolve.
    // (mock global tests/setup.ts tidak punya adClick.count & landingPageView)
    (prisma as any).landingPageView = { count: vi.fn().mockResolvedValue(VIEWS) };
    (prisma.adClick as any).count = vi.fn().mockImplementation(async (args: any) => {
      if (args?.where?.matchedAt) return MATCHED;
      return CLICKS;
    });
    (prisma.customer as any).count = vi.fn().mockImplementation(async (args: any) => {
      const inRange = Boolean(args?.where?.mql_triggered_at);
      return inRange ? MQL_IN_RANGE : MQL_ALL_TIME;
    });
    (prisma.reservation as any).count = vi.fn().mockImplementation(async (args: any) => {
      const status = args?.where?.purchase_review_status;
      if (status === 'approved') {
        const inRange = Boolean(args?.where?.purchase_event_sent_at);
        return inRange ? APPROVED_IN_RANGE : APPROVED_ALL_TIME;
      }
      if (status === 'pending') return PENDING_QUEUE;
      return 0;
    });
  });

  it('1. Purchase (purchaseEvents) & CAPI Events memakai rentang tanggal, bukan all-time', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary?startDate=2026-09-01&endDate=2026-09-30',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Jalur DB sukses — bukan fallback in-memory (dbNote tidak boleh terisi)
    expect(body.data.dbNote).toBeUndefined();

    // Purchase in-range, bukan all-time (bug lama: 100 all-time → CAPI 104 > klik 92)
    expect(body.data.purchaseEvents).toBe(APPROVED_IN_RANGE);
    expect(body.data.approvedPurchases).toBe(APPROVED_IN_RANGE);
    expect(body.data.purchaseEventsAllTime).toBe(APPROVED_ALL_TIME);

    // CAPI Events = matched rentang + purchase rentang, MUST NOT bocor all-time
    expect(body.data.capiEventsDelivered).toBe(MATCHED + APPROVED_IN_RANGE);
    expect(body.data.capiEventsDelivered).toBeLessThan(CLICKS);
  });

  it('2. MQL (step3 funnel) memakai rentang mql_triggered_at, all-time tersedia terpisah', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary?startDate=2026-09-01&endDate=2026-09-30',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    const body = JSON.parse(res.body);
    expect(body.data.mqlLeads).toBe(MQL_IN_RANGE);
    expect(body.data.mqlLeadsAllTime).toBe(MQL_ALL_TIME);
    expect(body.data.funnel.step3_mqlLeads).toBe(MQL_IN_RANGE);
  });

  it('3. Default 30 hari (tanpa startDate/endDate) tetap menghitung in-range, bukan jatuh all-time', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    const body = JSON.parse(res.body);
    expect(body.data.purchaseEvents).toBe(APPROVED_IN_RANGE);
    expect(body.data.capiEventsDelivered).toBe(MATCHED + APPROVED_IN_RANGE);
  });

  it('4. Field lama tetap ada (backward-compat FE) + views/klik tidak berubah', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary?startDate=2026-09-01&endDate=2026-09-30',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    const body = JSON.parse(res.body);
    expect(body.data.totalPageViews).toBe(VIEWS);
    expect(body.data.totalClicks).toBe(CLICKS);
    expect(body.data.matchedChats).toBe(MATCHED);
    // pending & ignored_outlier = antrian point-in-time (bukan event rentang)
    expect(body.data.pendingPurchases).toBe(PENDING_QUEUE);
    expect(typeof body.data.ignoredOutliers).toBe('number');
    expect(typeof body.data.mqlLeads).toBe('number');
    expect(typeof body.data.purchaseEvents).toBe('number');
  });

  it('5. capiNote menjelaskan definisi in-range & menyebut angka all-time bila berbeda', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary?startDate=2026-09-01&endDate=2026-09-30',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    const body = JSON.parse(res.body);
    expect(body.data.capiNote).toMatch(/rentang/i);
    expect(body.data.capiNote).toContain(String(APPROVED_ALL_TIME));
  });
});

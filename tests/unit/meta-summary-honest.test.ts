import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { memoryAdClicks, memoryPageViews } from '../../src/routes/tracking.route';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase 2+3 — Uji kejujuran summary: views murni (tanpa fallback clicks),
 * flag trackingCode, ctrNote, dan coverage.
 * DB offline → hitung dari memoryPageViews/memoryAdClicks.
 */
describe('Meta Summary Kejujuran — PageView vs Klik', () => {
  const app = buildApp();

  beforeEach(() => {
    memoryAdClicks.clear();
    memoryPageViews.clear();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    vi.restoreAllMocks();
  });

  it('1. Tanpa PageView tapi ada klik → totalPageViews=0, coverageNote terisi (tidak di-mask jadi klik)', async () => {
    // 2 klik tanpa pageview
    memoryAdClicks.set('aa', { trackingCode: 'aa', tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), matchedAt: null, userAgent: 'Mozilla/5.0', utmCampaign: null });
    memoryAdClicks.set('bb', { trackingCode: 'bb', tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), matchedAt: null, userAgent: 'Mozilla/5.0', utmCampaign: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // DB offline → prisma count gagal → fallback 0 untuk views, tapi memori klik 2; masking lama akan jadi 2, sekarang harus 0
    // Karena prisma mock reject, kita jatuh ke catch → memori
    // totalPageViews dari memoryPageViews = 0, totalClicks = 2
    expect(body.data.totalPageViews).toBe(0);
    expect(body.data.totalClicks).toBe(2);
    expect(body.data.coverageNote).toBeDefined();
    expect(body.data.coverage.note).toBeDefined();
  });

  it('2. Filter trackingCode aktif → isTrackingCodeFiltered=true, ctrNote jelaskan pre-click', async () => {
    memoryAdClicks.set('xy', { trackingCode: 'xy', tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), matchedAt: null, userAgent: 'Mozilla/5.0' });
    memoryPageViews.set('pv1', { tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), userAgent: 'Mozilla/5.0', utmCampaign: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary?search=xy',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    const body = JSON.parse(res.body);
    expect(body.data.isTrackingCodeFiltered).toBe(true);
    expect(body.data.ctrNote).toMatch(/tracking/i);
  });

  it('3. Klik > view → ctrNote parsial', async () => {
    // 1 view, 3 klik
    memoryPageViews.set('pv1', { tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), userAgent: 'Mozilla/5.0', utmCampaign: null });
    memoryAdClicks.set('a1', { trackingCode: 'a1', tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), matchedAt: null, userAgent: 'Mozilla/5.0' });
    memoryAdClicks.set('b2', { trackingCode: 'b2', tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), matchedAt: null, userAgent: 'Mozilla/5.0' });
    memoryAdClicks.set('c3', { trackingCode: 'c3', tenant_id: DEFAULT_TENANT_ID, createdAt: new Date(), matchedAt: null, userAgent: 'Mozilla/5.0' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-summary',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    const body = JSON.parse(res.body);
    expect(body.data.totalPageViews).toBe(1);
    expect(body.data.totalClicks).toBe(3);
    expect(body.data.ctrNote).toMatch(/parsial/i);
  });
});

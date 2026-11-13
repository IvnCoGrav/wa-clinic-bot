import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { TreatmentHeatmapService } from '../../src/services/treatment-heatmap.service';

const ADMIN_KEY = 'test-admin-key';

function stubResponse() {
  return {
    year: 2026,
    month: 11,
    monthName: 'November',
    scope: 'weekly',
    generatedAt: '2026-11-13T05:00:00.000Z',
    metric: 'count',
    hours: { startHourWib: 8, endHourWib: 17 },
    hourSlots: [8, 9, 10],
    maxCount: 0,
    maxRevenue: 0,
    totals: { count: 0, revenue: 0, itemCount: 0 },
    hourly: [],
    quality: {
      totalCompleted: 0,
      missingBookingDate: 0,
      outsideHoursCount: 0,
      defaultedHourCount: 0,
      excludedNonCompleted: 0,
    },
  } as any;
}

describe('GET /api/admin/financial-analytics/heatmap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('meneruskan tenant header dan scope ke service', async () => {
    const spy = vi.spyOn(TreatmentHeatmapService, 'getHeatmap').mockResolvedValueOnce(stubResponse());

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics/heatmap?year=2026&month=11&scope=monthly',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-klinik-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-klinik-a', 2026, 11, 'monthly', undefined);
    expect(JSON.parse(res.payload).success).toBe(true);
  });

  it('default scope = weekly bila tidak diisi', async () => {
    const spy = vi.spyOn(TreatmentHeatmapService, 'getHeatmap').mockResolvedValueOnce(stubResponse());

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics/heatmap?year=2026&month=11',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-klinik-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-klinik-a', 2026, 11, 'weekly', undefined);
  });

  it.each([
    ['scope=yearly', 'scope tidak valid'],
    ['month=13', 'month di luar 1-12'],
    ['month=0', 'month 0'],
    ['year=abc', 'year bukan angka'],
    ['year=1900', 'year terlalu kecil'],
    ['months=13', 'months di luar 1-12'],
  ])('menolak query tidak valid: %s', async (query) => {
    const spy = vi.spyOn(TreatmentHeatmapService, 'getHeatmap');

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/financial-analytics/heatmap?${query}`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-klinik-a' },
    });

    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.parse(res.payload).success).toBe(false);
  });

  it('menolak permintaan tanpa kredensial admin', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics/heatmap?year=2026&month=11',
    });
    expect(res.statusCode).toBe(401);
  });

  it('meneruskan monthCount untuk scope multi', async () => {
    const spy = vi.spyOn(TreatmentHeatmapService, 'getHeatmap').mockResolvedValueOnce(stubResponse());

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics/heatmap?year=2026&month=11&scope=multi&months=6',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-klinik-c' },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-klinik-c', 2026, 11, 'multi', 6);
  });
});

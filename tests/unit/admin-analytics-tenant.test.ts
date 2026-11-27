import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { FinancialAnalyticsService } from '../../src/services/financial-analytics.service';
import { tenantOf } from '../../src/routes/admin/route-helpers';

const ADMIN_KEY = 'test-admin-key';

describe('Admin Financial Analytics — Tenant Isolation (SEC-AUDIT)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('passes tenantId from request header to getMonthlyAnalytics', async () => {
    const spy = vi.spyOn(FinancialAnalyticsService, 'getMonthlyAnalytics').mockResolvedValueOnce({
      monthName: 'Oktober',
      year: 2026,
      kpi: { totalRevenue: 5000000, aov: 250000, totalBookings: 20 },
      dailyTrend: [],
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics?year=2026&month=10',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': 'tenant-klinik-a',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-klinik-a', 2026, 10, { baselineMonths: undefined });
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.monthName).toBe('Oktober');
  });

  it('includes revenueBasis metadata in endpoint response', async () => {
    vi.spyOn(FinancialAnalyticsService, 'getMonthlyAnalytics').mockResolvedValueOnce({
      monthName: 'November',
      year: 2026,
      kpi: { totalRevenue: 1000000, activeBookings: 5, totalBookings: 6 },
      revenueBasis: {
        basis: 'booking_date',
        statusFilter: 'all_non_cancelled',
        includeDeliveryFee: true,
        includePending: true,
        includeUpcoming: true,
        discountApplied: true,
        label: 'Basis tanggal treatment; semua non-cancelled',
      },
      dailyTrend: [],
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics?year=2026&month=11',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': 'tenant-basis',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.revenueBasis).toBeDefined();
    expect(body.data.revenueBasis.basis).toBe('booking_date');
    expect(body.data.revenueBasis.label).toContain('Basis tanggal treatment');
  });

  it('rejects invalid baselineMonths with 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics?year=2026&month=10&baselineMonths=5',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': 'tenant-klinik-a',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toContain('3, 6, atau 12');
  });

  it('passes valid baselineMonths to service', async () => {
    const spy = vi.spyOn(FinancialAnalyticsService, 'getMonthlyAnalytics').mockResolvedValueOnce({
      monthName: 'Oktober',
      year: 2026,
      kpi: {},
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics?year=2026&month=10&baselineMonths=3',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': 'tenant-klinik-a',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-klinik-a', 2026, 10, { baselineMonths: 3 });
  });

  it('rejects with 401 when credentials/session is missing', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics?year=2026&month=10',
    });

    expect(res.statusCode).toBe(401);
  });

  it('tenantOf throws 401 TENANT_REQUIRED when tenantId is missing', () => {
    const mockReq: any = { headers: {} };
    expect(() => tenantOf(mockReq)).toThrowError(/tenantId wajib/);
  });

  it('passes tenantId to export endpoint', async () => {
    const spy = vi.spyOn(FinancialAnalyticsService, 'generateMonthlyTransactionsCsv').mockResolvedValueOnce('id,date,revenue\n');

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/financial-analytics/export?year=2026&month=10',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': 'tenant-klinik-b',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-klinik-b', 2026, 10);
  });
});

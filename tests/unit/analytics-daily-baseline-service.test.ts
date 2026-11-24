import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancialAnalyticsService } from '../../src/services/financial-analytics.service';
import { prisma } from '../../src/db/client';
import { responseCacheService } from '../../src/services/response-cache.service';
import { clearAnalyticsBaselineSettingsCache } from '../../src/config/analytics-baseline';

describe('Analytics Daily Baseline Service Wiring (Fase 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAnalyticsBaselineSettingsCache();
    // Bersihkan cache in-memory
    (responseCacheService as any).cache?.clear?.();
  });

  it('1 & 2. findMany dipanggil tepat 2x per request (bulan berjalan + baseline) dengan tenant isolation dan batas WIB', async () => {
    const findManySpy = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([]);

    const res = await FinancialAnalyticsService.getMonthlyAnalytics('tenant-a', 2026, 11);

    expect(findManySpy).toHaveBeenCalledTimes(2);

    // Call Baseline historical query (memiliki filter status notIn)
    const baselineCall = findManySpy.mock.calls.find((c) => c[0]?.where?.status?.notIn);
    const baselineCallWhere = baselineCall?.[0]?.where;
    expect(baselineCallWhere?.tenant_id).toBe('tenant-a');
    expect(baselineCallWhere?.status).toEqual({ notIn: ['cancelled', 'CANCELLED'] });

    // Target Nov 2026 -> 6 bulan sebelumnya: Mei 2026 (1 Mei 00:00 WIB = 30 Apr 17:00 UTC) s/d Okt 2026 (31 Okt 23:59:59.999 WIB)
    const gteDate = new Date(baselineCallWhere?.booking_date?.gte);
    expect(gteDate.toISOString()).toBe('2026-04-30T17:00:00.000Z');

    // Call Current month query
    const currentMonthCall = findManySpy.mock.calls.find((c) => !c[0]?.where?.status);
    const currentMonthWhere = currentMonthCall?.[0]?.where;
    expect(currentMonthWhere?.tenant_id).toBe('tenant-a');

    expect(res.baseline).toBeDefined();
    expect(res.baseline.monthsRequested).toBe(6);
    expect(res.baseline.windowStart).toEqual({ year: 2026, month: 5 });
    expect(res.baseline.windowEnd).toEqual({ year: 2026, month: 10 });
  });

  it('3. Error DB pada baseline -> baseline.available === false, reason === QUERY_FAILED, dan hasil gagal tidak di-cache', async () => {
    const findManySpy = vi.spyOn(prisma.reservation, 'findMany').mockImplementation(async (args?: any) => {
      // Baseline historical query ditandai oleh filter status notIn
      if (args?.where?.status?.notIn) {
        throw new Error('Database connection timeout on baseline');
      }
      return [];
    });

    const res1 = await FinancialAnalyticsService.getMonthlyAnalytics('tenant-b', 2026, 11);
    expect(res1.baseline.available).toBe(false);
    expect(res1.baseline.reason).toBe('QUERY_FAILED');
    expect(res1.dailyTrend[0].avg6mRevenue).toBeNull();

    // Hapus cache bulanan agar memicu pemanggilan getMonthlyAnalytics lagi
    const monthlyKey = `analytics:monthly:tenant-b:2026:11`;
    (responseCacheService as any).cache?.delete?.(monthlyKey);

    // Panggil kedua kalinya: karena hasil gagal tidak di-cache di baseline, findMany baseline harus tetap dipanggil ulang
    const res2 = await FinancialAnalyticsService.getMonthlyAnalytics('tenant-b', 2026, 11);
    expect(res2.baseline.available).toBe(false);
    // Total call: 2 call di request pertama + 2 call di request kedua = 4 call
    expect(findManySpy).toHaveBeenCalledTimes(4);
  });

  it('4. Sukses -> panggil 2x dengan instance baru -> query baseline hanya 1x (cache hit 600s)', async () => {
    const findManySpy = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([]);

    // Request 1
    await FinancialAnalyticsService.getMonthlyAnalytics('tenant-c', 2026, 10);
    expect(findManySpy).toHaveBeenCalledTimes(2); // 1 baseline + 1 current month

    // Hapus cache bulanan agar memicu getMonthlyAnalytics lagi, namun cache baseline tetap hidup
    const monthlyKey = `analytics:monthly:tenant-c:2026:10`;
    (responseCacheService as any).cache?.delete?.(monthlyKey);

    // Request 2
    await FinancialAnalyticsService.getMonthlyAnalytics('tenant-c', 2026, 10);
    // Baseline di-cache (TTL 600s), sehingga hanya current month yang di-query lagi
    expect(findManySpy).toHaveBeenCalledTimes(3); // 2 dari req 1 + 1 dari req 2
  });

  it('5. responseCacheService key berbeda antar tenant', async () => {
    const findManySpy = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([]);

    await FinancialAnalyticsService.getMonthlyAnalytics('tenant-x', 2026, 11);
    await FinancialAnalyticsService.getMonthlyAnalytics('tenant-y', 2026, 11);

    // Masing-masing tenant memicu 2 query (total 4 query) karena cache key terisolasi per tenant
    expect(findManySpy).toHaveBeenCalledTimes(4);
  });

  it('6. R-02: Ketika available === false, semua titik avg6mRevenue & avg6mBookings wajib bernilai null', async () => {
    // Simulasi data historis hanya 1 bulan (kurang dari minMonths=3)
    vi.spyOn(prisma.reservation, 'findMany').mockImplementation(async (args?: any) => {
      if (args?.where?.status?.notIn) {
        // Baseline query: kembalikan 1 reservasi di bulan Oktober 2026
        return [
          {
            booking_date: new Date('2026-10-10T05:00:00Z'),
            status: 'completed',
            purchase_value: 300000,
            discount_amount: 0,
            delivery_fee: 0,
            treatment_detail: 'Baby Spa',
            customer: { ongkir: 0 },
            items: [{ price: 300000 }],
          },
        ] as any[];
      }
      return [];
    });

    const res = await FinancialAnalyticsService.getMonthlyAnalytics('tenant-r02', 2026, 11);
    expect(res.baseline.available).toBe(false);
    expect(res.baseline.reason).toBe('INSUFFICIENT_HISTORY');

    // Seluruh hari dalam bulan target tidak boleh menampilkan kurva baseline semu
    expect(res.dailyTrend.length).toBeGreaterThan(0);
    for (const point of res.dailyTrend) {
      expect(point.avg6mRevenue).toBeNull();
      expect(point.avg6mBookings).toBeNull();
      expect(point.baselineSamples).toBe(0);
    }
  });
});

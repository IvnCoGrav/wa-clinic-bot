import { describe, it, expect, vi } from 'vitest';
import {
  computeFunnelMetrics,
  computeBaselineWindow,
  FunnelWindow,
  MetricsProvider,
} from '../../src/services/ad-funnel-metrics.service';

describe('ad-funnel-metrics.service', () => {
  const window: FunnelWindow = {
    start: new Date('2026-11-06T01:00:00.000Z'), // 08:00 WIB
    end: new Date('2026-11-06T11:00:00.000Z'),   // 18:00 WIB
  };

  it('menghitung CTR = 0 tanpa divide-by-zero saat paidViews = 0', async () => {
    const provider: MetricsProvider = {
      countViews: vi.fn().mockResolvedValue(0),
      listPaidClicks: vi.fn().mockResolvedValue([]),
      countInboundChats: vi.fn().mockResolvedValue(0),
      countMql: vi.fn().mockResolvedValue(0),
    };

    const res = await computeFunnelMetrics('test-tenant', window, { provider });
    expect(res).not.toBeNull();
    expect(res!.paidViews).toBe(0);
    expect(res!.uniquePaidClicks).toBe(0);
    expect(res!.ctr).toBe(0);
  });

  it('melakukan deduplikasi klik ber-fbclid sama menjadi 1 unik', async () => {
    const provider: MetricsProvider = {
      countViews: vi.fn().mockResolvedValue(50),
      listPaidClicks: vi.fn().mockResolvedValue([
        { id: 'c1', fbclid: 'fb_dup_1', createdAt: new Date('2026-11-06T02:00:00Z'), matchedAt: null },
        { id: 'c2', fbclid: 'fb_dup_1', createdAt: new Date('2026-11-06T02:01:00Z'), matchedAt: null }, // Duplikat
        { id: 'c3', fbclid: 'fb_unique_2', createdAt: new Date('2026-11-06T03:00:00Z'), matchedAt: new Date('2026-11-06T03:01:00Z'), customerId: 'cust_1' },
        { id: 'c4', fbclid: null, createdAt: new Date('2026-11-06T04:00:00Z'), matchedAt: null }, // Tanpa fbclid, id beda
        { id: 'c5', fbclid: null, createdAt: new Date('2026-11-06T04:05:00Z'), matchedAt: null }, // Tanpa fbclid, id beda
      ]),
      countInboundChats: vi.fn().mockResolvedValue(1),
      countMql: vi.fn().mockResolvedValue(0),
    };

    const res = await computeFunnelMetrics('test-tenant', window, { provider });
    expect(res).not.toBeNull();
    expect(res!.uniquePaidClicks).toBe(4); // c1(c2 dup), c3, c4, c5
    expect(res!.paidMatchedLeads).toBe(1);
    expect(res!.ctr).toBe(0.08); // 4 / 50 = 0.08
  });

  it('menghitung aged clicks hanya bila berusia >= graceMinutes dan matchedAt IS NULL', async () => {
    const now = new Date('2026-11-06T11:00:00.000Z');
    const provider: MetricsProvider = {
      countViews: vi.fn().mockResolvedValue(30),
      listPaidClicks: vi.fn().mockResolvedValue([
        // Usia 5 menit (10:55) -> Belum aged (< 20 menit)
        { id: 'recent_unmatched', fbclid: 'f1', createdAt: new Date('2026-11-06T10:55:00Z'), matchedAt: null },
        // Usia 25 menit (10:35) -> Aged (> 20 menit)
        { id: 'aged_unmatched', fbclid: 'f2', createdAt: new Date('2026-11-06T10:35:00Z'), matchedAt: null },
        // Usia 40 menit tapi sudah matched -> Bukan unmatched aged
        { id: 'aged_matched', fbclid: 'f3', createdAt: new Date('2026-11-06T10:20:00Z'), matchedAt: new Date('2026-11-06T10:21:00Z'), customerId: 'cust_9' },
      ]),
      countInboundChats: vi.fn().mockResolvedValue(1),
      countMql: vi.fn().mockResolvedValue(0),
    };

    const res = await computeFunnelMetrics('test-tenant', window, {
      now,
      graceMinutes: 20,
      provider,
    });

    expect(res).not.toBeNull();
    expect(res!.uniquePaidClicks).toBe(3);
    expect(res!.paidAgedClicks).toBe(1); // Hanya aged_unmatched
    expect(res!.paidMatchedLeads).toBe(1);
  });

  it('mengembalikan null secara aman tanpa melempar throw jika provider error', async () => {
    const failingProvider: MetricsProvider = {
      countViews: vi.fn().mockRejectedValue(new Error('Database offline')),
    };

    const res = await computeFunnelMetrics('test-tenant', window, { provider: failingProvider });
    expect(res).toBeNull();
  });

  it('computeBaselineWindow menghitung median dengan benar dari array ganjil & genap', async () => {
    const fixedNow = new Date('2026-11-06T11:00:00.000Z'); // 18:00 WIB
    const viewsHistory = [10, 45, 20, 50, 30, 25, 40]; // Sorted: 10, 20, 25, [30], 40, 45, 50 -> Median 30

    let callCount = 0;
    const provider: MetricsProvider = {
      countViews: vi.fn().mockImplementation(async () => {
        const v = viewsHistory[callCount % viewsHistory.length];
        callCount++;
        return v;
      }),
      listPaidClicks: vi.fn().mockResolvedValue([]),
    };

    const median = await computeBaselineWindow('test-tenant', 8, fixedNow, 7, provider);
    expect(median).toBe(30);
  });
});

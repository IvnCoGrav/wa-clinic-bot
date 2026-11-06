import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMetaPerformanceReport } from '../../src/services/meta-performance-analytics.service';
import { computeFunnelMetrics } from '../../src/services/ad-funnel-metrics.service';
import { prisma } from '../../src/db/client';

describe('ad-funnel-parity: Paritas Metrik Kanonik', () => {
  const TENANT = 'parity-tenant';
  const start = new Date('2026-08-01T00:00:00.000Z');
  const end = new Date('2026-08-31T23:59:59.999Z');

  const rangeClicks = [
    { tenant_id: TENANT, customerId: 'c1', matchedAt: '2026-08-02T02:00:00.000Z', fbclid: 'fb_1', utmCampaign: 'camp1', utmSource: 'meta', utmMedium: 'paid', createdAt: '2026-08-02T02:00:00.000Z' },
    { tenant_id: TENANT, customerId: 'c2', matchedAt: '2026-08-03T02:00:00.000Z', fbclid: 'fb_2', utmCampaign: 'camp2', utmSource: 'meta', utmMedium: 'paid', createdAt: '2026-08-03T02:00:00.000Z' },
    { tenant_id: TENANT, customerId: null, matchedAt: null, fbclid: 'fb_3', utmCampaign: 'camp1', utmSource: 'meta', utmMedium: 'paid', createdAt: '2026-08-04T02:00:00.000Z' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.adClick.findMany as any).mockResolvedValue(rangeClicks);
    (prisma.reservation.findMany as any).mockResolvedValue([]);
    (prisma.customer.findMany as any).mockResolvedValue([]);
    (prisma as any).landingPageView = { count: vi.fn().mockResolvedValue(75) };
    (prisma as any).tenant = { findUnique: vi.fn().mockResolvedValue({ id: TENANT, settings: {} }) };
  });

  it('memastikan report Meta Performance dan computeFunnelMetrics menghasilkan angka funnel yang identik', async () => {
    const report = await getMetaPerformanceReport({
      tenantId: TENANT,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });

    const seamMetrics = await computeFunnelMetrics(
      TENANT,
      { start, end },
      {
        provider: {
          countViews: async () => 75,
          listPaidClicks: async () => rangeClicks as any,
        },
      }
    );

    expect(seamMetrics).not.toBeNull();
    // Paritas pageViews
    expect(report.funnel.pageViews).toBe(seamMetrics!.paidViews);
    expect(report.funnel.pageViews).toBe(75);

    // Paritas totalClicks
    expect(report.funnel.totalClicks).toBe(seamMetrics!.uniquePaidClicks);
    expect(report.funnel.totalClicks).toBe(3);

    // Paritas matchedChats
    expect(report.funnel.matchedChats).toBe(seamMetrics!.matchedChats);
    expect(report.funnel.matchedChats).toBe(2);
  });
});

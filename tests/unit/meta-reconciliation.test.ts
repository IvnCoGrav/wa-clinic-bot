import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { reconcileMetaPageViews } from '../../src/services/meta-ads-insights.service';

/**
 * Fase 4 (issue #136): Rekonsiliasi Meta Ads Insights → landing_page_views.
 * Kontrak: ambil data PageView dari Meta Ads Insights (atau CSV), bandingkan
 * dengan tabel lokal, sisipkan yang hilang dengan source='meta-reconciliation'.
 * Deterministik: match key = tenant_id + date + utm_campaign (campaign name/id).
 */
describe('Meta PageView Reconciliation (Fase 4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (prisma as any).landingPageView = {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    (prisma.tenant.findMany as any) = vi.fn().mockResolvedValue([]);
    (prisma.tenant.findFirst as any) = vi.fn().mockResolvedValue(null);
  });

  const mockLocalViews = (views: any[]) => {
    vi.mocked((prisma as any).landingPageView.findMany).mockResolvedValueOnce(views);
  };
  const mockTenants = (tenants: any[]) => {
    vi.mocked(prisma.tenant.findMany).mockResolvedValueOnce(tenants);
  };
  const mockCreateMany = (count: number) => {
    vi.mocked((prisma as any).landingPageView.createMany).mockResolvedValueOnce({ count });
  };

  it('1. Meta data dengan campaign cocok tenant → insert view yang hilang', async () => {
    const metaData = [
      { date: '2026-09-20', campaign_name: 'promo-a', landing_page_views: 100 },
    ];

    mockTenants([{ id: 'tenant-x', slug: 'promo-a', landing_domain: 'https://lp.example.com' }]);
    mockLocalViews([{ createdAt: new Date('2026-09-20T10:00:00Z'), utmCampaign: 'promo-a' }]);
    mockCreateMany(40);

    const result = await reconcileMetaPageViews(metaData, { tenantId: 'tenant-x', dryRun: false });

    expect(result.inserted).toBe(40);
    expect((prisma as any).landingPageView.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          source: 'meta-reconciliation',
          tenant_id: 'tenant-x',
          utmCampaign: 'promo-a',
          eventId: null,
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('2. Local views sudah >= Meta → tidak insert (idempoten)', async () => {
    const metaData = [{ date: '2026-09-20', campaign_name: 'promo-a', landing_page_views: 50 }];
    mockTenants([{ id: 'tenant-x', slug: 'promo-a' }]);
    // 60 local views (lebih dari meta 50)
    mockLocalViews(Array.from({ length: 60 }, (_, i) => ({ createdAt: new Date('2026-09-20T10:00:00Z'), utmCampaign: 'promo-a' })));

    const result = await reconcileMetaPageViews(metaData, { tenantId: 'tenant-x', dryRun: false });

    expect(result.inserted).toBe(0);
    expect((prisma as any).landingPageView.createMany).not.toHaveBeenCalled();
  });

  it('3. Dry-run → tidak createMany, hanya hitung', async () => {
    const metaData = [{ date: '2026-09-20', campaign_name: 'promo-a', landing_page_views: 100 }];
    mockTenants([{ id: 'tenant-x', slug: 'promo-a' }]);
    mockLocalViews([]);

    const result = await reconcileMetaPageViews(metaData, { tenantId: 'tenant-x', dryRun: true });

    expect(result.inserted).toBe(0);
    expect(result.wouldInsert).toBe(100);
    expect((prisma as any).landingPageView.createMany).not.toHaveBeenCalled();
  });

  it('4. Campaign Meta tidak punya tenant lokal → skip dengan warning', async () => {
    const metaData = [{ date: '2026-09-20', campaign_name: 'unknown-campaign', landing_page_views: 50 }];
    mockTenants([]);

    const result = await reconcileMetaPageViews(metaData, { dryRun: false });

    expect(result.skippedCampaigns).toContain('unknown-campaign');
    expect(result.inserted).toBe(0);
  });

  it('5. CSV input → parse & rekonsiliasi sama seperti API', async () => {
    const csvText = 'date,campaign_name,landing_page_views\n2026-09-20,promo-a,100\n2026-09-21,promo-b,50';
    mockTenants([
      { id: 'tenant-x', slug: 'promo-a', landing_domain: 'https://lp.example.com' },
      { id: 'tenant-y', slug: 'promo-b', landing_domain: 'https://lp2.example.com' },
    ]);
    mockLocalViews([]);
    mockCreateMany(150);

    const result = await reconcileMetaPageViews({ csv: csvText }, { dryRun: false });

    expect(result.inserted).toBe(150);
  });
});
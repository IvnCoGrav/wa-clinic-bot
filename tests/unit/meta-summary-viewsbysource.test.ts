import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryAdClicks, memoryPageViews } from '../../src/routes/tracking.route';

/**
 * Fase 5a (issue #136): rincian sumber PageView server di meta-summary.
 * Kontrak: GET /api/admin/debug/meta-summary mengembalikan `pageViewsBySource`
 * = { <source>: count } dengan where yang SAMA dengan totalPageViews
 * (tenant + rentang + bot-exclude + utmCampaign), sehingga jumlahnya = total.
 * Baris pra-Fase 2 (source NULL) dilabeli '(tanpa label)' — jujur, bukan ditebak.
 * groupBy gagal (mis. migrasi `source` belum di-deploy di live) → field absen,
 * total tetap jalan (UI menyembunyikan rincian).
 */
describe('Meta Summary pageViewsBySource (Fase 5a)', () => {
  const app = buildApp();

  const VIEWS = 6;
  const CLICKS = 92;
  const MATCHED = 4;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    vi.restoreAllMocks();
    memoryAdClicks.clear();
    memoryPageViews.clear();

    (prisma as any).landingPageView = {
      count: vi.fn().mockResolvedValue(VIEWS),
      groupBy: vi.fn().mockResolvedValue([
        { source: 'beacon', _count: { _all: 3 } },
        { source: 'cta-fallback', _count: { _all: 2 } },
        { source: null, _count: { _all: 1 } },
      ]),
    };
    (prisma.adClick as any).count = vi.fn().mockImplementation(async (args: any) => {
      if (args?.where?.matchedAt) return MATCHED;
      return CLICKS;
    });
    (prisma.customer as any).count = vi.fn().mockResolvedValue(0);
    (prisma.reservation as any).count = vi.fn().mockResolvedValue(0);
  });

  const getSummary = async (qs = 'startDate=2026-09-01&endDate=2026-09-30') => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/debug/meta-summary?${qs}`,
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body).data;
  };

  it('1. respons memuat pageViewsBySource per source (NULL → "(tanpa label)")', async () => {
    const data = await getSummary();
    expect(data.dbNote).toBeUndefined();
    expect(data.pageViewsBySource).toEqual({
      beacon: 3,
      'cta-fallback': 2,
      '(tanpa label)': 1,
    });
  });

  it('2. jumlah rincian = totalPageViews (where identik, tidak ada kebocoran)', async () => {
    const data = await getSummary();
    const sum = Object.values(data.pageViewsBySource as Record<string, number>)
      .reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(data.totalPageViews);
    expect(data.totalPageViews).toBe(VIEWS);
  });

  it('3. groupBy memakai where yang sama dengan count (tenant + rentang + bot-exclude)', async () => {
    await getSummary();
    const groupBy = (prisma as any).landingPageView.groupBy;
    const count = (prisma as any).landingPageView.count;
    expect(groupBy).toHaveBeenCalledTimes(1);
    const groupByWhere = groupBy.mock.calls[0][0].where;
    const countWhere = count.mock.calls[0][0].where;
    expect(groupByWhere).toEqual(countWhere);
    expect(groupBy.mock.calls[0][0].by).toEqual(['source']);
  });

  it('4. filter utmCampaign diteruskan ke groupBy', async () => {
    await getSummary('startDate=2026-09-01&endDate=2026-09-30&utmCampaign=promo-a');
    const groupByWhere = (prisma as any).landingPageView.groupBy.mock.calls[0][0].where;
    expect(groupByWhere.utmCampaign).toEqual({ contains: 'promo-a', mode: 'insensitive' });
  });

  it('5. groupBy gagal (kolom source belum ada di DB live) → field absen, total tetap jalan', async () => {
    vi.mocked((prisma as any).landingPageView.groupBy).mockRejectedValueOnce(
      new Error('column "source" does not exist'),
    );
    const data = await getSummary();
    expect(data.dbNote).toBeUndefined(); // total dari DB, bukan fallback
    expect(data.totalPageViews).toBe(VIEWS);
    expect(data.pageViewsBySource).toBeUndefined();
  });
});

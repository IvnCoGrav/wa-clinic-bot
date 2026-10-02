import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { getMetaPerformanceReport } from '../../src/services/meta-performance-analytics.service';
import { responseCacheService } from '../../src/services/response-cache.service';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

const T = 'tenant-1';
const RANGE = { startDate: '2026-08-01', endDate: '2026-08-31' };

function cust(id: string, tenant = T, extra: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: tenant,
    created_at: '2026-08-01T01:00:00.000Z',
    is_mql: false,
    mql_triggered_at: null,
    kecamatan: null,
    kota: null,
    is_out_of_coverage: false,
    is_sandbox_test: false,
    is_internal_staff: false,
    ongkir: 0,
    ...extra,
  };
}

/** Pasang scoped-double Prisma per-test (menggantikan mock global tests/setup). */
function install(fx: {
  rangeClicks?: any[];
  matchedAds?: any[];
  rangeReservations?: any[];
  historyReservations?: any[];
  customers?: any[];
  conversations?: any[];
  followUps?: any[];
  pageViews?: number;
}) {
  const byTenant = (arr: any[], where: any) =>
    (arr || []).filter((r) => !where?.tenant_id || r.tenant_id === where.tenant_id);
  (prisma.adClick.findMany as any).mockImplementation((args: any) => {
    const src = args?.where?.matchedAt ? fx.matchedAds || [] : fx.rangeClicks || [];
    return Promise.resolve(byTenant(src, args?.where));
  });
  (prisma.reservation.findMany as any).mockImplementation((args: any) => {
    const src = args?.where?.created_at ? fx.rangeReservations || [] : fx.historyReservations || [];
    return Promise.resolve(byTenant(src, args?.where));
  });
  (prisma.customer.findMany as any).mockImplementation((args: any) =>
    Promise.resolve(byTenant(fx.customers || [], args?.where)),
  );
  (prisma as any).conversation = { findMany: vi.fn(() => Promise.resolve(fx.conversations || [])) };
  (prisma as any).followUp = { findMany: vi.fn(() => Promise.resolve(fx.followUps || [])) };
  (prisma as any).landingPageView = { count: vi.fn(() => Promise.resolve(fx.pageViews ?? 0)) };
}

beforeEach(() => {
  responseCacheService.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('meta-performance-analytics: CAC/LTV kanonis', () => {
  const ads = [
    { tenant_id: T, customerId: 'a', matchedAt: '2026-08-02T02:00:00.000Z', ctwa_clid: 'ctwa_a', utmCampaign: 'campA', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T02:00:00.000Z' },
    { tenant_id: T, customerId: 'b', matchedAt: '2026-08-03T02:00:00.000Z', ctwa_clid: null, utmCampaign: 'campB', utmSource: 'whatsapp_direct', utmMedium: 'ctwa', createdAt: '2026-08-03T02:00:00.000Z' },
    { tenant_id: T, customerId: 'c', matchedAt: '2026-08-06T02:00:00.000Z', ctwa_clid: 'ctwa_c', utmCampaign: 'campC', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-06T02:00:00.000Z' },
  ];
  const rangeClicks = [
    ...ads,
    { tenant_id: T, customerId: null, matchedAt: null, ctwa_clid: null, utmCampaign: 'campA', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-04T02:00:00.000Z' },
  ];
  const res = (id: string, customerId: string, createdAt: string, status: string, value: number, bookingDate: string | null, customer: any) => ({
    id, tenant_id: T, customer_id: customerId, created_at: createdAt, booking_date: bookingDate, status,
    purchase_value: value, treatment_detail: 'Pijat Bayi', treatment_category: 'BABY', delivery_fee: 0, customer,
  });

  const cA = cust('a', T, { is_mql: true });
  const cB = cust('b');
  const cC = cust('c');

  const rangeReservations = [
    res('rA1', 'a', '2026-08-05T03:00:00.000Z', 'confirmed', 200000, '2026-08-05T05:00:00.000Z', cA),
    res('rB2', 'b', '2026-08-10T03:00:00.000Z', 'confirmed', 150000, null, cB),
    res('rC2', 'c', '2026-08-12T03:00:00.000Z', 'confirmed', 120000, '2026-08-14T05:00:00.000Z', cC),
    res('rC1', 'c', '2026-08-03T03:00:00.000Z', 'cancelled', 99000, null, cC),
  ];
  const historyReservations = [
    res('rB1', 'b', '2026-07-01T03:00:00.000Z', 'confirmed', 130000, null, cB),
    ...rangeReservations,
  ];

  beforeEach(() => {
    install({
      rangeClicks,
      matchedAds: ads.map((a) => ({ ...a, customer: cust(a.customerId!) })),
      rangeReservations,
      historyReservations,
      customers: [cA, cB, cC],
      pageViews: 100,
      followUps: [
        { customer_id: 'b', status: 'SENT', tenant_id: T },
        { customer_id: 'b', status: 'FAILED', tenant_id: T },
      ],
    });
  });

  it('memisahkan pembeli baru (CAC) dari repeat (LTV); order pertama cancelled tidak dihitung new', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    // A first-ever Aug (new), C first-ever = rC2 (rC1 cancelled diabaikan), B first-ever Jul (bukan new)
    expect(r.kpiSummary.newCustomersAcquired).toBe(2);
    expect(r.kpiSummary.initialRevenue).toBe(320000);
    expect(r.kpiSummary.initialAov).toBe(160000);
    expect(r.kpiSummary.repeatCustomersCount).toBe(1);
    expect(r.kpiSummary.repeatRevenue).toBe(150000);
    expect(r.kpiSummary.totalAdRevenue).toBe(470000);
    expect(r.kpiSummary.totalClinicRevenue).toBe(470000);
    expect(r.kpiSummary.adRevenueSharePct).toBe(100);
  });

  it('menghitung funnel, CAC/ROAS saat spend diisi, dan "-" saat kosong', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE, adSpend: 400000 });
    expect(r.funnel.totalClicks).toBe(4);
    expect(r.funnel.matchedChats).toBe(3);
    expect(r.funnel.unmatchedDrain).toBe(1);
    expect(r.funnel.mqlLeads).toBe(1);
    expect(r.kpiSummary.realCac).toBe(200000);
    expect(r.kpiSummary.costPerLead).toBe(Math.round(400000 / 3));
    expect(r.kpiSummary.costPerMql).toBe(400000);
    expect(r.kpiSummary.initialRoas).toBe(0.8);
    expect(r.kpiSummary.lifetimeRoas).toBe(1.18);

    const noSpend = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(noSpend.kpiSummary.realCac).toBeUndefined();
    expect(noSpend.kpiSummary.initialRoas).toBeUndefined();
  });

  it('memetakan kanal CTWA_NATIVE vs PROMO_CTA berdasarkan ctwa_clid', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    const native = r.channelComparison.find((c) => c.channel === 'CTWA_NATIVE')!;
    const promo = r.channelComparison.find((c) => c.channel === 'PROMO_CTA')!;
    expect(native.leads).toBe(2);
    expect(native.firstTimeBuyers).toBe(2);
    expect(native.mql).toBe(1);
    expect(native.initialRevenue).toBe(320000);
    expect(promo.leads).toBe(1);
    expect(promo.firstTimeBuyers).toBe(0);
  });

  it('menghitung journey (mean/median/bracket) dan lead time (termasuk tanpa tanggal)', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.journeyVelocity.meanDays).toBe(4.5); // (3 + 6) / 2
    expect(r.journeyVelocity.medianDays).toBe(4.5);
    const bracket3to7 = r.journeyVelocity.brackets.find((b) => b.key === 'd3_7')!;
    expect(bracket3to7.count).toBe(2);
    const noDate = r.bookingLeadTime.find((b) => b.key === 'no_date')!;
    expect(noDate.count).toBe(1); // rB2 (booking_date null); rC1 cancelled tidak qualifying
  });

  it('mengagregasi campaign dan follow-up recovery kohort iklan', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    const campA = r.campaignBreakdown.find((c) => c.utmCampaign === 'campA')!;
    expect(campA.clicks).toBe(2); // 1 matched + 1 unmatched
    expect(campA.chats).toBe(1);
    expect(campA.buyers).toBe(1);
    expect(campA.initialRevenue).toBe(200000);
    expect(r.leakageDiagnostics.followUpRecovery.sent).toBe(1);
    expect(r.leakageDiagnostics.followUpRecovery.byStatus.FAILED).toBe(1);
  });
});

describe('meta-performance-analytics: ketahanan & isolasi', () => {
  it('mengecualikan customer sandbox/staff dari semua metrik', async () => {
    const sc = cust('s', T, { is_sandbox_test: true });
    install({
      rangeClicks: [{ tenant_id: T, customerId: 's', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'x', utmCampaign: 'c', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z' }],
      matchedAds: [{ tenant_id: T, customerId: 's', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'x', utmCampaign: 'c', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z', customer: sc }],
      rangeReservations: [{ id: 'rs', tenant_id: T, customer_id: 's', created_at: '2026-08-03T00:00:00Z', booking_date: null, status: 'confirmed', purchase_value: 500000, treatment_detail: 'Pijat', treatment_category: 'BABY', delivery_fee: 0, customer: sc }],
      historyReservations: [{ id: 'rs', tenant_id: T, customer_id: 's', created_at: '2026-08-03T00:00:00Z', status: 'confirmed', purchase_value: 500000, treatment_detail: 'Pijat', treatment_category: 'BABY', delivery_fee: 0, customer: sc }],
      customers: [sc],
    });
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.kpiSummary.newCustomersAcquired).toBe(0);
    expect(r.kpiSummary.initialRevenue).toBe(0);
    expect(r.kpiSummary.totalAdRevenue).toBe(0);
  });

  it('mengisolasi data antar-tenant', async () => {
    const c1 = cust('a1', T);
    const c2 = cust('a2', 'tenant-2');
    install({
      rangeClicks: [
        { tenant_id: T, customerId: 'a1', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'x', utmCampaign: 'c1', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z' },
        { tenant_id: 'tenant-2', customerId: 'a2', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'y', utmCampaign: 'c2', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z' },
      ],
      matchedAds: [
        { tenant_id: T, customerId: 'a1', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'x', utmCampaign: 'c1', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z', customer: c1 },
        { tenant_id: 'tenant-2', customerId: 'a2', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'y', utmCampaign: 'c2', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z', customer: c2 },
      ],
      rangeReservations: [
        { id: 'r1', tenant_id: T, customer_id: 'a1', created_at: '2026-08-03T00:00:00Z', booking_date: null, status: 'confirmed', purchase_value: 100000, treatment_detail: 'Pijat', treatment_category: 'BABY', delivery_fee: 0, customer: c1 },
        { id: 'r2', tenant_id: 'tenant-2', customer_id: 'a2', created_at: '2026-08-03T00:00:00Z', booking_date: null, status: 'confirmed', purchase_value: 900000, treatment_detail: 'Pijat', treatment_category: 'BABY', delivery_fee: 0, customer: c2 },
      ],
      historyReservations: [
        { id: 'r1', tenant_id: T, customer_id: 'a1', created_at: '2026-08-03T00:00:00Z', status: 'confirmed', purchase_value: 100000, treatment_detail: 'Pijat', treatment_category: 'BABY', delivery_fee: 0, customer: c1 },
        { id: 'r2', tenant_id: 'tenant-2', customer_id: 'a2', created_at: '2026-08-03T00:00:00Z', status: 'confirmed', purchase_value: 900000, treatment_detail: 'Pijat', treatment_category: 'BABY', delivery_fee: 0, customer: c2 },
      ],
      customers: [c1, c2],
    });
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.kpiSummary.newCustomersAcquired).toBe(1);
    expect(r.kpiSummary.initialRevenue).toBe(100000);
  });

  it('fallback harga katalog saat purchase_value NULL/0', async () => {
    const c = cust('a', T);
    vi.spyOn(treatmentCatalogService, 'getAllServices').mockReturnValue([
      { name: 'Pijat Bayi', promoPrice: 150000, originalPrice: 180000, category: 'BABY' } as any,
    ]);
    const reservation = {
      id: 'r0', tenant_id: T, customer_id: 'a', created_at: '2026-08-03T00:00:00Z', booking_date: '2026-08-04T00:00:00Z',
      status: 'confirmed', purchase_value: 0, treatment_detail: 'Pijat Bayi', treatment_category: 'BABY', delivery_fee: 0, customer: c,
    };
    install({
      rangeClicks: [{ tenant_id: T, customerId: 'a', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'x', utmCampaign: 'c', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z' }],
      matchedAds: [{ tenant_id: T, customerId: 'a', matchedAt: '2026-08-02T00:00:00Z', ctwa_clid: 'x', utmCampaign: 'c', utmSource: 'meta', utmMedium: 'ctwa', createdAt: '2026-08-02T00:00:00Z', customer: c }],
      rangeReservations: [reservation],
      historyReservations: [reservation],
      customers: [c],
    });
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.kpiSummary.initialRevenue).toBe(150000);
  });

  it('mengembalikan ZERO report (tanpa throw) saat DB offline', async () => {
    (prisma.adClick.findMany as any).mockRejectedValue(new Error('Database offline'));
    (prisma.reservation.findMany as any).mockRejectedValue(new Error('Database offline'));
    (prisma.customer.findMany as any).mockRejectedValue(new Error('Database offline'));
    (prisma as any).conversation = { findMany: vi.fn(() => Promise.reject(new Error('Database offline'))) };
    (prisma as any).followUp = { findMany: vi.fn(() => Promise.reject(new Error('Database offline'))) };
    delete (prisma as any).landingPageView;
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.kpiSummary.newCustomersAcquired).toBe(0);
    expect(r.funnel.totalClicks).toBe(0);
    expect(r.meta.revenueBasis.errors.length).toBeGreaterThan(0);
  });
});

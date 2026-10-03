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
  staffCount?: number;
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
  (prisma.staff.count as any).mockImplementation(() =>
    fx.staffCount === undefined ? Promise.reject(new Error('Database offline')) : Promise.resolve(fx.staffCount),
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

  it('mengembalikan conversionRates dalam skala persen 0-100 (bukan rasio 0-1)', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    // pageViews 100, totalClicks 4, matchedChats 3, mqlLeads 1, newCustomers 2
    expect(r.funnel.conversionRates.lpToClick).toBe(4);
    expect(r.funnel.conversionRates.clickToChat).toBe(75);
    expect(r.funnel.conversionRates.chatToMql).toBe(33.33);
    expect(r.funnel.conversionRates.mqlToBuyer).toBe(200);
    for (const v of Object.values(r.funnel.conversionRates)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(v)).toBe(true);
    }
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

describe('meta-performance-analytics: sanitasi UTM teknis', () => {
  const click = (over: Record<string, unknown>) => ({
    tenant_id: T,
    customerId: null,
    matchedAt: null,
    ctwa_clid: null,
    utmCampaign: null,
    utmSource: null,
    utmMedium: null,
    createdAt: '2026-08-04T02:00:00.000Z',
    ...over,
  });

  beforeEach(() => {
    install({
      rangeClicks: [
        click({ utmCampaign: '{{ad.id}}', utmSource: '{{site_source_name}}' }),
        click({ utmCampaign: '{{adset.id}}', utmSource: '{{site_source_name}}' }),
        click({ utmCampaign: '   ', utmSource: '' }),
        click({ utmCampaign: 'promo-agustus', utmSource: '  meta  ' }),
        click({ utmCampaign: 'promo-juli', utmSource: 'ig' }),
      ],
      matchedAds: [],
      rangeReservations: [],
      historyReservations: [],
      customers: [],
    });
  });

  it('tidak meloloskan label makro {{...}} mentah & menggabungkan makro jadi satu baris', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.campaignBreakdown.every((c) => !c.utmCampaign.includes('{{'))).toBe(true);
    const macroRows = r.campaignBreakdown.filter((c) => c.utmCampaign.includes('macro'));
    expect(macroRows.length).toBe(1);
    expect(macroRows[0].clicks).toBe(2);
    expect(macroRows[0].source).toBeNull();
  });

  it('menggabungkan campaign kosong ke (tanpa campaign)', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    const empty = r.campaignBreakdown.find((c) => c.utmCampaign === '(tanpa campaign)')!;
    expect(empty.clicks).toBe(1);
    expect(empty.source).toBeNull();
  });

  it('hanya trim source (tanpa memetakan alias ke merek)', async () => {
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.campaignBreakdown.find((c) => c.utmCampaign === 'promo-agustus')!.source).toBe('meta');
    // 'ig' dipertahankan apa adanya — bukan diubah menjadi 'Instagram' oleh kode.
    expect(r.campaignBreakdown.find((c) => c.utmCampaign === 'promo-juli')!.source).toBe('ig');
  });
});

describe('meta-performance-analytics: retensi & kapasitas', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const mkRes = (id: string, cid: string, createdAt: string, bookingDate: string | null, customer: any) => ({
    id,
    tenant_id: T,
    customer_id: cid,
    created_at: createdAt,
    booking_date: bookingDate,
    status: 'confirmed',
    purchase_value: 100000,
    treatment_detail: 'Pijat Bayi',
    treatment_category: 'BABY',
    delivery_fee: 0,
    assigned_staff_id: null,
    customer,
  });
  const mkAd = (cid: string, at: string, customer: any) => ({
    tenant_id: T, customerId: cid, matchedAt: at, ctwa_clid: 'x', utmCampaign: 'c', utmSource: 'meta', utmMedium: 'ctwa', createdAt: at, customer,
  });

  it('menghitung kohort retensi 30/60/90 hari & null saat jendela belum matang', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T00:00:00.000Z'));
    const cNew = cust('new', T, { created_at: '2026-08-01T01:00:00.000Z' });
    const cLate = cust('late', T, { created_at: '2026-09-20T01:00:00.000Z' });
    const history = [
      mkRes('n0', 'new', '2026-08-01T05:00:00.000Z', null, cNew),
      mkRes('n1', 'new', '2026-08-10T05:00:00.000Z', null, cNew),
      mkRes('n2', 'new', '2026-09-25T05:00:00.000Z', null, cNew),
      mkRes('l0', 'late', '2026-09-20T05:00:00.000Z', null, cLate),
      mkRes('l1', 'late', '2026-09-25T05:00:00.000Z', null, cLate),
    ];
    install({
      rangeClicks: [mkAd('new', '2026-08-01T02:00:00.000Z', cNew), mkAd('late', '2026-09-20T02:00:00.000Z', cLate)],
      matchedAds: [mkAd('new', '2026-08-01T02:00:00.000Z', cNew), mkAd('late', '2026-09-20T02:00:00.000Z', cLate)],
      rangeReservations: [],
      historyReservations: history,
      customers: [cNew, cLate],
    });
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });

    const aug = r.retentionCohorts.find((c) => c.cohort === '2026-08-01')!;
    expect(aug.size).toBe(1);
    expect(aug.returned30).toBe(1);
    expect(aug.returned60).toBe(2);
    // Jendela 90 hari dari 1 Agu baru matang 30 Okt; per 15 Okt → belum matang.
    expect(aug.returned90).toBeNull();

    const sep = r.retentionCohorts.find((c) => c.cohort === '2026-09-20')!;
    expect(sep.size).toBe(1);
    expect(sep.returned30).toBeNull();
    expect(sep.returned60).toBeNull();
    expect(sep.returned90).toBeNull();
  });

  it('menghitung utilisasi terapis dari jumlah Staff aktif (DB-driven, bukan konstanta)', async () => {
    const c = cust('a', T);
    install({
      rangeClicks: [],
      matchedAds: [],
      rangeReservations: [mkRes('r1', 'a', '2026-08-02T03:00:00.000Z', '2026-08-05T03:00:00.000Z', c)],
      historyReservations: [mkRes('r1', 'a', '2026-08-02T03:00:00.000Z', null, c)],
      customers: [c],
      staffCount: 3,
    });
    const r = await getMetaPerformanceReport({ tenantId: T, startDate: '2026-08-01', endDate: '2026-08-10' });
    expect(r.therapistCapacity).not.toBeNull();
    expect(r.therapistCapacity!.activeTherapists).toBe(3);
    expect(r.therapistCapacity!.bookingCount).toBe(1);
    expect(r.therapistCapacity!.utilizationPct).toBe(3.33); // 1 / (3 * 10 hari)
    expect(r.therapistCapacity!.band).toBe('AMAN');
  });

  it('therapistCapacity null saat DB offline (enrichment opsional, tanpa throw)', async () => {
    install({ rangeClicks: [], matchedAds: [], rangeReservations: [], historyReservations: [], customers: [] });
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    expect(r.therapistCapacity).toBeNull();
  });

  it('menurunkan drop-off MQL dari state (converted/cancelled/outOfCoverage/noReservation)', async () => {
    const cConv = cust('conv', T, { is_mql: true });
    const cNo = cust('nores', T, { is_mql: true });
    const cCancel = cust('cancel', T, { is_mql: true });
    const cOoc = cust('ooc', T, { is_mql: true, is_out_of_coverage: true });
    const ads = [cConv, cNo, cCancel, cOoc].map((c) => mkAd(c.id, '2026-08-02T02:00:00.000Z', c));
    const rows = [
      mkRes('rc', 'conv', '2026-08-03T03:00:00.000Z', null, cConv),
      { ...mkRes('rx', 'cancel', '2026-08-03T03:00:00.000Z', null, cCancel), status: 'cancelled' },
    ];
    install({
      rangeClicks: ads,
      matchedAds: ads,
      rangeReservations: rows,
      historyReservations: rows,
      customers: [cConv, cNo, cCancel, cOoc],
    });
    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    const d = r.leakageDiagnostics.mqlDropOff;
    expect(d.mqlTotal).toBe(4);
    expect(d.converted).toBe(1);
    expect(d.cancelled).toBe(1);
    expect(d.outOfCoverage).toBe(1);
    expect(d.noReservation).toBe(1);
    expect(d.dropped).toBe(3);
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

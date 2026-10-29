import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { getMetaPerformanceReport, META_BOT_EXCLUDE_CLAUSE, buildMonthlyCohorts } from '../../src/services/meta-performance-analytics.service';
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
  tenantSettings?: any;
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
  (prisma as any).tenant = {
    findUnique: vi.fn((args: any) =>
      fx.tenantSettings !== undefined
        ? Promise.resolve({ id: args?.where?.id || T, settings: fx.tenantSettings })
        : Promise.reject(new Error('Database offline')),
    ),
  };
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

  it('memastikan klik CTWA dengan userAgent null lolos META_BOT_EXCLUDE_CLAUSE dan masuk channelComparison CTWA_NATIVE', async () => {
    expect(META_BOT_EXCLUDE_CLAUSE.OR).toBeDefined();
    expect(META_BOT_EXCLUDE_CLAUSE.OR).toContainEqual({ userAgent: null });

    const cCtwa = cust('ctwa-1', T);
    const ctwaClick = {
      tenant_id: T,
      customerId: 'ctwa-1',
      matchedAt: '2026-08-02T02:00:00.000Z',
      ctwa_clid: 'ctwa_direct_123',
      utmCampaign: 'ctwa_campaign',
      utmSource: 'meta',
      utmMedium: 'ctwa',
      userAgent: null,
      createdAt: '2026-08-02T02:00:00.000Z',
      customer: cCtwa,
    };
    const ctwaRes = {
      id: 'r_ctwa',
      tenant_id: T,
      customer_id: 'ctwa-1',
      created_at: '2026-08-03T02:00:00.000Z',
      booking_date: '2026-08-04T02:00:00.000Z',
      status: 'confirmed',
      purchase_value: 125000,
      treatment_detail: 'Pijat Bayi',
      treatment_category: 'BABY',
      delivery_fee: 0,
      customer: cCtwa,
    };

    install({
      rangeClicks: [ctwaClick],
      matchedAds: [ctwaClick],
      rangeReservations: [ctwaRes],
      historyReservations: [ctwaRes],
      customers: [cCtwa],
    });

    const r = await getMetaPerformanceReport({ tenantId: T, ...RANGE });
    const native = r.channelComparison.find((c) => c.channel === 'CTWA_NATIVE');
    expect(native).toBeDefined();
    expect(native?.leads).toBe(1);
    expect(native?.firstTimeBuyers).toBe(1);
    expect(native?.initialRevenue).toBe(125000);
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

  it('menghitung utilisasi terapis dari jumlah Staff aktif dengan slot terkonfigurasi tenant', async () => {
    const c = cust('a', T);
    install({
      rangeClicks: [],
      matchedAds: [],
      rangeReservations: [mkRes('r1', 'a', '2026-08-02T03:00:00.000Z', '2026-08-05T03:00:00.000Z', c)],
      historyReservations: [mkRes('r1', 'a', '2026-08-02T03:00:00.000Z', null, c)],
      customers: [c],
      staffCount: 3,
      tenantSettings: {
        metaPerformanceSettings: {
          dailySlotsPerTherapist: 4,
        },
      },
    });
    const r = await getMetaPerformanceReport({ tenantId: T, startDate: '2026-08-01', endDate: '2026-08-10' });
    expect(r.therapistCapacity).not.toBeNull();
    expect(r.therapistCapacity!.activeTherapists).toBe(3);
    expect(r.therapistCapacity!.dailySlotsPerTherapist).toBe(4);
    expect(r.therapistCapacity!.totalSlotsCapacity).toBe(120); // 3 terapis * 4 slot * 10 hari
    expect(r.therapistCapacity!.bookingCount).toBe(1);
    expect(r.therapistCapacity!.utilizationPct).toBe(0.83); // 1 / 120 slot
    expect(r.therapistCapacity!.band).toBe('AMAN');
  });

  it('therapistCapacity memiliki dailySlotsPerTherapist null dan band UNKNOWN saat belum dikonfigurasi tenant', async () => {
    const c = cust('a', T);
    install({
      rangeClicks: [],
      matchedAds: [],
      rangeReservations: [mkRes('r1', 'a', '2026-08-02T03:00:00.000Z', '2026-08-05T03:00:00.000Z', c)],
      historyReservations: [mkRes('r1', 'a', '2026-08-02T03:00:00.000Z', null, c)],
      customers: [c],
      staffCount: 3,
      tenantSettings: {
        metaPerformanceSettings: {
          // tanpa dailySlotsPerTherapist
        },
      },
    });
    const r = await getMetaPerformanceReport({ tenantId: T, startDate: '2026-08-01', endDate: '2026-08-10' });
    expect(r.therapistCapacity).not.toBeNull();
    expect(r.therapistCapacity!.activeTherapists).toBe(3);
    expect(r.therapistCapacity!.dailySlotsPerTherapist).toBeNull();
    expect(r.therapistCapacity!.totalSlotsCapacity).toBeNull();
    expect(r.therapistCapacity!.utilizationPct).toBeNull();
    expect(r.therapistCapacity!.band).toBe('UNKNOWN');
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
    expect(d.convertedFirstTime).toBe(1);
    expect(d.convertedRepeat).toBe(0);
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


describe('meta-performance-analytics: Mesin Kohort Bulanan & Omzet Treatment Murni', () => {
  it('memisahkan omzet treatment murni dari ongkir (ongkir tidak boleh masuk omzet iklan/LTV)', async () => {
    const c1 = cust('c1', T, { phone: '08123456789' });
    const resAug = {
      id: 'r_aug',
      tenant_id: T,
      customer_id: 'c1',
      created_at: '2026-08-05T03:00:00.000Z',
      booking_date: '2026-08-05T04:00:00.000Z',
      status: 'completed',
      purchase_value: 150000,
      treatment_detail: 'Pijat Bayi',
      treatment_category: 'BABY',
      delivery_fee: 25000, // Ongkos kirim Rp 25.000
      customer: c1,
    };

    const ad1 = {
      tenant_id: T,
      customerId: 'c1',
      matchedAt: '2026-08-02T02:00:00.000Z',
      ctwa_clid: null,
      utmCampaign: 'promo_agustus',
      utmSource: 'meta',
      utmMedium: 'cpc',
      createdAt: '2026-08-02T02:00:00.000Z',
      customer: c1,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [resAug],
      rangeReservations: [resAug],
      matchedAds: [ad1],
      monthlySpends: { '2026-08': { lpwa: 100000 } },
      grossMarginPct: 40,
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    const augLpwa = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-08' && r.channel === 'LPWA')!;
    expect(augLpwa).toBeDefined();
    expect(augLpwa.cohortSize).toBe(1);
    // Omzet murni adalah Rp 150.000 (tanpa ongkir 25.000)
    expect(augLpwa.initialRevenue).toBe(150000);
    expect(augLpwa.initialDeliveryFee).toBe(25000);
    expect(augLpwa.totalRealizedRevenue).toBe(150000);
    expect(augLpwa.revenuePerPatient).toBe(150000);
    // ROAS dihitung terhadap omzet murni: 150.000 / 100.000 = 1.5x (bukan 175.000 / 100.000)
    expect(augLpwa.roas).toBe(1.5);
    expect(augLpwa.paybackStatus).toBe('BALIK_MODAL');
  });

  it('mengelompokkan kohort berdasarkan tanggal kunjungan (booking_date), bukan created_at', async () => {
    // Dipesan akhir Agustus (created_at 31 Aug), tetapi kunjungan awal September (booking_date 2 Sep)
    const c1 = cust('c_sept', T, { phone: '0812999888' });
    const res = {
      id: 'r_sep',
      tenant_id: T,
      customer_id: 'c_sept',
      created_at: '2026-08-31T20:00:00.000Z',
      booking_date: '2026-09-02T09:00:00.000Z',
      status: 'completed',
      purchase_value: 120000,
      treatment_detail: 'Pijat Laktasi',
      treatment_category: 'MOM',
      delivery_fee: 0,
      customer: c1,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [res],
      rangeReservations: [res],
      matchedAds: [],
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    // Pasien wajib masuk kohort 2026-09 (bulan kunjungan riil), BUKAN 2026-08
    const sepRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-09' && r.channel === 'ORGANIC')!;
    expect(sepRow).toBeDefined();
    expect(sepRow.cohortSize).toBe(1);
    expect(sepRow.initialRevenue).toBe(120000);

    const augRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-08' && r.channel === 'ORGANIC');
    expect(augRow).toBeUndefined();
  });

  it('membedakan status completed (terealisasi) vs confirmed (terjadwal mendatang)', async () => {
    const c1 = cust('c_conf', T, { phone: '08155544433' });
    const resConfirmed = {
      id: 'r_conf',
      tenant_id: T,
      customer_id: 'c_conf',
      created_at: '2026-10-20T03:00:00.000Z',
      booking_date: '2026-10-28T04:00:00.000Z',
      status: 'confirmed', // Belum terlaksana
      purchase_value: 140000,
      treatment_detail: 'Pijat Anak',
      treatment_category: 'KIDS',
      delivery_fee: 10000,
      customer: c1,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [resConfirmed],
      rangeReservations: [resConfirmed],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    const octRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-10' && r.channel === 'ORGANIC')!;
    expect(octRow.cohortSize).toBe(1);
    // Omzet terealisasi wajib 0 karena belum completed!
    expect(octRow.initialRevenue).toBe(0);
    expect(octRow.totalRealizedRevenue).toBe(0);
    // Masuk ke upcoming
    expect(octRow.initialUpcomingOrders).toBe(1);
    expect(octRow.initialUpcomingRevenue).toBe(140000);
  });

  it('menghitung repeat M+1 dan M+2, serta status balikan per periode', async () => {
    const c1 = cust('c_repeat', T, { phone: '081888777' });
    const res1 = {
      id: 'r1',
      tenant_id: T,
      customer_id: 'c_repeat',
      created_at: '2026-08-01T03:00:00.000Z',
      booking_date: '2026-08-02T04:00:00.000Z',
      status: 'completed',
      purchase_value: 130000,
      treatment_detail: 'Pijat Bayi',
      delivery_fee: 0,
      customer: c1,
    };
    const res2 = {
      id: 'r2',
      tenant_id: T,
      customer_id: 'c_repeat',
      created_at: '2026-09-10T03:00:00.000Z',
      booking_date: '2026-09-11T04:00:00.000Z',
      status: 'completed',
      purchase_value: 130000,
      treatment_detail: 'Pijat Bayi',
      delivery_fee: 0,
      customer: c1,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [res1, res2],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    const augAll = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-08' && r.channel === 'ALL')!;
    expect(augAll.cohortSize).toBe(1);
    expect(augAll.initialRevenue).toBe(130000);
    expect(augAll.repeatM1).not.toBeNull();
    expect(augAll.repeatM1?.count).toBe(1);
    expect(augAll.repeatM1?.pct).toBe(100);
    expect(augAll.repeatM1?.revenue).toBe(130000);
    expect(augAll.repeatM1?.status).toBe('COMPLETED');
    expect(augAll.totalRealizedRevenue).toBe(260000);
    expect(augAll.revenuePerPatient).toBe(260000);

    // M+2 adalah Oktober (bulan berjalan)
    expect(augAll.repeatM2?.status).toBe('ONGOING');
    // M+3 adalah November (masa depan)
    expect(augAll.repeatM3).toBeNull();
    expect(augAll.repeatM4).toBeNull();
    expect(augAll.repeatM5).toBeNull();
  });

  it('menghitung LTV 60 hari matang HANYA dari pasien iklan kohort matang (tanpa pasien organik)', async () => {
    // Pasien Iklan A: First visit 1 Agustus 2026 (umur > 60 hari) -> omzet 150rb + repeat 120rb = 270rb
    const cAd = cust('c_ad', T, { phone: '08123450001' });
    const adClick = {
      tenant_id: T,
      customerId: 'c_ad',
      matchedAt: '2026-08-01T00:00:00Z',
      ctwa_clid: 'ctwa_mature',
      utmCampaign: 'camp',
      utmSource: 'meta',
      utmMedium: 'ctwa',
      createdAt: '2026-08-01T00:00:00Z',
      customer: cAd,
    };
    const rAd1 = {
      id: 'ra1',
      tenant_id: T,
      customer_id: 'c_ad',
      created_at: '2026-08-01T02:00:00Z',
      booking_date: '2026-08-02T02:00:00Z',
      status: 'completed',
      purchase_value: 150000,
      treatment_detail: 'Pijat',
      delivery_fee: 0,
      customer: cAd,
    };
    const rAd2 = {
      id: 'ra2',
      tenant_id: T,
      customer_id: 'c_ad',
      created_at: '2026-09-01T02:00:00Z',
      booking_date: '2026-09-02T02:00:00Z',
      status: 'completed',
      purchase_value: 120000,
      treatment_detail: 'Pijat',
      delivery_fee: 0,
      customer: cAd,
    };

    // Pasien Organik B: First visit 1 Agustus 2026 -> omzet besar Rp 1.000.000 (DILARANG masuk LTV iklan!)
    const cOrg = cust('c_org', T, { phone: '08123450002' });
    const rOrg = {
      id: 'ro1',
      tenant_id: T,
      customer_id: 'c_org',
      created_at: '2026-08-01T02:00:00Z',
      booking_date: '2026-08-02T02:00:00Z',
      status: 'completed',
      purchase_value: 1000000,
      treatment_detail: 'Pijat',
      delivery_fee: 0,
      customer: cOrg,
    };

    // Pasien Iklan C: First visit 15 Oktober 2026 (umur baru 11 hari -> BELUM MATANG, dilarang masuk!)
    const cNew = cust('c_new', T, { phone: '08123450003' });
    const adNew = {
      tenant_id: T,
      customerId: 'c_new',
      matchedAt: '2026-10-15T00:00:00Z',
      ctwa_clid: 'ctwa_new',
      utmCampaign: 'camp',
      utmSource: 'meta',
      utmMedium: 'ctwa',
      createdAt: '2026-10-15T00:00:00Z',
      customer: cNew,
    };
    const rNew = {
      id: 'rn1',
      tenant_id: T,
      customer_id: 'c_new',
      created_at: '2026-10-15T02:00:00Z',
      booking_date: '2026-10-16T02:00:00Z',
      status: 'completed',
      purchase_value: 100000,
      treatment_detail: 'Pijat',
      delivery_fee: 0,
      customer: cNew,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [rAd1, rAd2, rOrg, rNew],
      rangeReservations: [],
      matchedAds: [adClick, adNew],
      now: new Date('2026-10-26T09:00:00.000Z'),
      grossMarginPct: 40,
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    const planning = result.planning;
    // Hanya pasien c_ad yang masuk: umur > 60 hari dan dari iklan
    expect(planning.matureSamplePatients).toBe(1);
    expect(planning.matureLtv60Days).toBe(270000); // 150rb + 120rb
    // Max allowable CAC dengan margin 40%: 270.000 * 0.40 = 108.000
    expect(planning.maxAllowableCac).toBe(108000);
    // Sampel 1 < 20 sehingga hasEnoughData = false
    expect(planning.hasEnoughData).toBe(false);
  });

  it('menormalkan duplikasi nomor telepon (+62 vs 08) menjadi satu pasien', async () => {
    // Pasien yang sama pesan di bulan 8 dengan format '0812345678' dan di bulan 9 dengan '+62812345678'
    const cA = cust('ca', T, { phone: '0812345678' });
    const cB = cust('cb', T, { phone: '+62812345678' });

    const r1 = {
      id: 'r_tel1',
      tenant_id: T,
      customer_id: 'ca',
      created_at: '2026-08-05T00:00:00Z',
      booking_date: '2026-08-05T00:00:00Z',
      status: 'completed',
      purchase_value: 150000,
      treatment_detail: 'Pijat',
      delivery_fee: 0,
      customer: cA,
    };
    const r2 = {
      id: 'r_tel2',
      tenant_id: T,
      customer_id: 'cb',
      created_at: '2026-09-05T00:00:00Z',
      booking_date: '2026-09-05T00:00:00Z',
      status: 'completed',
      purchase_value: 150000,
      treatment_detail: 'Pijat',
      delivery_fee: 0,
      customer: cB,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [r1, r2],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    // Harus dihitung 1 pasien baru di Agustus yang repeat di September
    const augRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-08' && r.channel === 'ORGANIC')!;
    expect(augRow.cohortSize).toBe(1);
    expect(augRow.repeatM1?.count).toBe(1);

    // September TIDAK boleh mencatat cB sebagai pasien baru
    const sepRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-09' && r.channel === 'ORGANIC');
    expect(sepRow).toBeUndefined();
  });

  it('menghitung retensi repeat order bulanan hingga M+4 dan M+5 secara akurat', async () => {
    const c1 = cust('c_m5', T, { phone: '08123450099' });
    const rMay = {
      id: 'r_may',
      tenant_id: T,
      customer_id: 'c_m5',
      created_at: '2026-05-10T03:00:00.000Z',
      booking_date: '2026-05-11T04:00:00.000Z',
      status: 'completed',
      purchase_value: 100000,
      treatment_detail: 'Pijat Bayi',
      delivery_fee: 0,
      customer: c1,
    };
    const rSep = {
      id: 'r_sep',
      tenant_id: T,
      customer_id: 'c_m5',
      created_at: '2026-09-15T03:00:00.000Z',
      booking_date: '2026-09-15T04:00:00.000Z',
      status: 'completed',
      purchase_value: 120000,
      treatment_detail: 'Pijat Bayi',
      delivery_fee: 0,
      customer: c1,
    };
    const rOct = {
      id: 'r_oct',
      tenant_id: T,
      customer_id: 'c_m5',
      created_at: '2026-10-20T03:00:00.000Z',
      booking_date: '2026-10-20T04:00:00.000Z',
      status: 'completed',
      purchase_value: 130000,
      treatment_detail: 'Pijat Bayi',
      delivery_fee: 0,
      customer: c1,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [rMay, rSep, rOct],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    const mayRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-05' && r.channel === 'ALL')!;
    expect(mayRow).toBeDefined();
    expect(mayRow.cohortSize).toBe(1);
    expect(mayRow.initialRevenue).toBe(100000);
    expect(mayRow.repeatM1?.count).toBe(0);
    expect(mayRow.repeatM2?.count).toBe(0);
    expect(mayRow.repeatM3?.count).toBe(0);
    expect(mayRow.repeatM4).not.toBeNull();
    expect(mayRow.repeatM4?.count).toBe(1);
    expect(mayRow.repeatM4?.revenue).toBe(120000);
    expect(mayRow.repeatM4?.status).toBe('COMPLETED');
    expect(mayRow.repeatM5).not.toBeNull();
    expect(mayRow.repeatM5?.count).toBe(1);
    expect(mayRow.repeatM5?.revenue).toBe(130000);
    expect(mayRow.repeatM5?.status).toBe('ONGOING');
    expect(mayRow.totalRealizedRevenue).toBe(350000);
  });

  it('menghitung cumulative repeat rate dan jeda rata-rata hari ke kunjungan kedua (avgDaysToSecondVisit)', async () => {
    const c1 = cust('c_rep1', T, { phone: '0811111111' });
    const c2 = cust('c_rep2', T, { phone: '0822222222' });

    // c1: first visit 2026-06-01, second visit 2026-06-21 (delta 20 hari)
    const r1_1 = {
      id: 'r1_1', tenant_id: T, customer_id: 'c_rep1', created_at: '2026-06-01T03:00:00.000Z',
      booking_date: '2026-06-01T03:00:00.000Z', status: 'completed', purchase_value: 100000,
      treatment_detail: 'Pijat Bayi', delivery_fee: 0, customer: c1,
    };
    const r1_2 = {
      id: 'r1_2', tenant_id: T, customer_id: 'c_rep1', created_at: '2026-06-21T03:00:00.000Z',
      booking_date: '2026-06-21T03:00:00.000Z', status: 'completed', purchase_value: 100000,
      treatment_detail: 'Pijat Bayi', delivery_fee: 0, customer: c1,
    };

    // c2: first visit 2026-06-05, second visit 2026-07-05 (delta 30 hari)
    const r2_1 = {
      id: 'r2_1', tenant_id: T, customer_id: 'c_rep2', created_at: '2026-06-05T03:00:00.000Z',
      booking_date: '2026-06-05T03:00:00.000Z', status: 'completed', purchase_value: 100000,
      treatment_detail: 'Pijat Bayi', delivery_fee: 0, customer: c2,
    };
    const r2_2 = {
      id: 'r2_2', tenant_id: T, customer_id: 'c_rep2', created_at: '2026-07-05T03:00:00.000Z',
      booking_date: '2026-07-05T03:00:00.000Z', status: 'completed', purchase_value: 100000,
      treatment_detail: 'Pijat Bayi', delivery_fee: 0, customer: c2,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [r1_1, r1_2, r2_1, r2_2],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
    });

    const junRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2026-06' && r.channel === 'ALL')!;
    expect(junRow).toBeDefined();
    expect(junRow.cohortSize).toBe(2);
    expect(junRow.cumulativeRepeatCount).toBe(2);
    expect(junRow.cumulativeRepeatPct).toBe(100);
    // (20 hari + 30 hari) / 2 = 25 hari
    expect(junRow.avgDaysToSecondVisit).toBe(25);
  });

  it('mengecualikan bulan sesuai excludedCohortMonths konfigurasi tenant', async () => {
    const cOld = cust('c_old', T);
    const rOld = {
      id: 'r_old', tenant_id: T, customer_id: 'c_old', created_at: '2025-08-10T03:00:00.000Z',
      booking_date: '2025-08-10T03:00:00.000Z', status: 'completed', purchase_value: 100000,
      treatment_detail: 'Pijat Bayi', delivery_fee: 0, customer: cOld,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [rOld],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
      cohortStartMonth: '2026-01',
      excludedCohortMonths: ['2025-08'],
    });

    const oldRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2025-08');
    expect(oldRow).toBeUndefined();
  });

  it('menyertakan bulan lampau jika tidak dikecualikan oleh konfigurasi tenant (anti-hardcode)', async () => {
    const cOld = cust('c_old', T);
    const rOld = {
      id: 'r_old', tenant_id: T, customer_id: 'c_old', created_at: '2025-08-10T03:00:00.000Z',
      booking_date: '2025-08-10T03:00:00.000Z', status: 'completed', purchase_value: 100000,
      treatment_detail: 'Pijat Bayi', delivery_fee: 0, customer: cOld,
    };

    const result = await buildMonthlyCohorts({
      tenantId: T,
      historyReservations: [rOld],
      rangeReservations: [],
      matchedAds: [],
      now: new Date('2026-10-26T09:00:00.000Z'),
      treatmentFeeOf: async (r) => r.purchase_value,
      cohortStartMonth: null,
      excludedCohortMonths: [],
    });

    const oldRow = result.monthlyCohorts.find((r) => r.cohortMonth === '2025-08');
    expect(oldRow).toBeDefined();
    expect(oldRow?.cohortSize).toBe(1);
  });
});

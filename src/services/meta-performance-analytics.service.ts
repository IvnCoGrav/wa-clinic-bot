import { z } from 'zod';
import { prisma } from '../db/client';
import { responseCacheService } from './response-cache.service';
import { resolveTreatmentValue } from './capi.service';
import { resolveDeliveryFeeSnapshot } from './reservation-core.service';

/**
 * META ADS PERFORMANCE & SALES ANALYTICS — kontrak kanonis (Fase 0).
 *
 * Sumber: docs/plans/META_PERFORMANCE_SALES_DASHBOARD_REVISI_PLAN.md
 * Semua definisi di bawah WAJIB dipatuhi; jangan disimpang tanpa Confirmation Gate.
 *
 * ── KANONIS CAC vs LTV ──────────────────────────────────────────────────────
 * Qualifying reservation = masuk hitung akuisisi/omzet bila SEMUA benar:
 *   - tenant_id = tenantId peminta
 *   - status NOT IN ('cancelled','rejected')
 *   - customer.is_sandbox_test = false AND customer.is_internal_staff = false
 * First-ever customer = reservasi qualifying dengan MIN(created_at) per customer.
 *   - newCustomersAcquired (periode) = customer yang first-ever-nya jatuh DALAM [start,end].
 *   - initialRevenue = totalFee atas first-ever tersebut (satu baris per customer).
 *   - repeatRevenue (periode) = reservasi qualifying BUKAN first-ever yang created_at DALAM [start,end].
 * DILARANG memakai flag `is_repeat_order` sebagai otoritas (computeIsRepeatOrder di
 * reservation-core.service.ts:343 hanya hint saat create, tidak tahan cancel kemudian).
 *
 * ── KANONIS OMZET (anti-KNOWN_ISSUES #179) ─────────────────────────────────
 *   treatmentFee = (purchase_value > 0) ? purchase_value
 *                : (await resolveTreatmentValue(treatment_detail, tenantId) ?? 0)
 *   deliveryFee  = resolveDeliveryFeeSnapshot(r)  // snapshot delivery_fee > fallback Customer.ongkir
 *   totalFee     = treatmentFee + deliveryFee
 *   Status dikecualikan dari revenue: ['cancelled','rejected']; pending/hold TIDAK masuk revenue.
 *
 * ── KANONIS KANAL (tanpa join fiktif LP→customer) ─────────────────────────
 *   LandingPageView TIDAK punya phone/customerId → HANYA coverage atas funnel.
 *   Atribusi bawah funnel by AdClick: ctwa_clid != null → 'CTWA_NATIVE', else 'PROMO_CTA'.
 *
 * ── KANONIS TANGGAL (WIB) ──────────────────────────────────────────────────
 *   firstTouch  = adClick.matchedAt ?? customer.created_at
 *   firstAnchor = first-ever qualifying reservation.created_at
 *   journeyDays = floor((firstAnchor − firstTouch)/86400000), clamp >= 0
 *   leadTimeDays = booking_date ? floor((booking_date − created_at)/86400000) : null
 *   Batas range [start,end] = hari kalender WIB (UTC+7).
 */

// ── Guardrails teknis ───────────────────────────────────────────────────────
export const SANDBOX_EXCLUDE = { is_sandbox_test: false, is_internal_staff: false } as const;
export const EXCLUDED_REVENUE_STATUSES = ['cancelled', 'rejected'] as const;

/**
 * Klausa pengecualian bot/crawler — cermin `BOT_EXCLUDE_CLAUSE` di
 * src/routes/admin/meta-attribution.subroute.ts:55-64. Diekspor agar suatu saat
 * route dapat mengimpor dari sini (satu sumber), bukan menyalin ulang.
 */
export const META_BOT_EXCLUDE_CLAUSE: any = {
  NOT: [
    { userAgent: { contains: 'facebookexternalhit', mode: 'insensitive' } },
    { userAgent: { contains: 'facebot', mode: 'insensitive' } },
    { userAgent: { contains: 'meta-externalagent', mode: 'insensitive' } },
    { userAgent: { contains: 'googlebot', mode: 'insensitive' } },
    { userAgent: { contains: 'bingbot', mode: 'insensitive' } },
    { userAgent: { contains: 'twitterbot', mode: 'insensitive' } },
  ],
};

const WIB_OFFSET_MS = 7 * 3600 * 1000;
const MS_PER_DAY = 86_400_000;
const MAX_ROWS = 5000;
const CACHE_TTL_SECONDS = 30;

// ── Kontrak query ───────────────────────────────────────────────────────────
export const MetaPerformanceQuerySchema = z.object({
  tenantId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  adSpend: z.number().nonnegative().max(1e12).optional(),
});
export type MetaPerformanceQueryOptions = z.infer<typeof MetaPerformanceQuerySchema>;

export interface RevenueBasis {
  treatmentSource: 'purchase_value+catalog_fallback';
  deliverySource: 'snapshot+fallback';
  excludedStatuses: readonly string[];
  pendingHoldIncluded: false;
  truncated: boolean;
  errors: string[];
}

export interface MetaPerformanceReport {
  meta: {
    tenantId: string;
    startDate: string;
    endDate: string;
    adSpend?: number;
    revenueBasis: RevenueBasis;
    dbNote?: string;
  };
  kpiSummary: {
    newCustomersAcquired: number;
    initialRevenue: number;
    initialAov: number;
    repeatCustomersCount: number;
    repeatRevenue: number;
    totalAdRevenue: number;
    totalClinicRevenue: number;
    adRevenueSharePct: number;
    realCac?: number;
    costPerLead?: number;
    costPerMql?: number;
    initialRoas?: number;
    lifetimeRoas?: number;
  };
  funnel: {
    pageViews: number;
    totalClicks: number;
    matchedChats: number;
    unmatchedDrain: number;
    mqlLeads: number;
    newCustomers: number;
    conversionRates: { lpToClick: number; clickToChat: number; chatToMql: number; mqlToBuyer: number };
    coverageNote: string;
    ctrNote?: string;
  };
  channelComparison: Array<{
    channel: 'CTWA_NATIVE' | 'PROMO_CTA';
    leads: number;
    mql: number;
    firstTimeBuyers: number;
    initialRevenue: number;
    aov: number;
    meanJourneyDays: number | null;
  }>;
  campaignBreakdown: Array<{
    utmCampaign: string;
    source: string | null;
    clicks: number;
    chats: number;
    mql: number;
    buyers: number;
    initialRevenue: number;
    status: 'MATCHED' | 'PENDING';
  }>;
  journeyVelocity: {
    meanDays: number | null;
    medianDays: number | null;
    brackets: Array<{ key: string; label: string; count: number; pct: number }>;
  };
  bookingLeadTime: Array<{ key: string; label: string; count: number; pct: number }>;
  treatmentPreferences: Array<{ category: string; name: string; orders: number; revenue: number }>;
  leakageDiagnostics: {
    topDropOffStates: Array<{ state: string; count: number }>;
    outOfCoverageCount: number;
    topRegions: Array<{ region: string; count: number }>;
    followUpRecovery: { sent: number; byStatus: Record<string, number> };
  };
}

// ── Helper teknis ───────────────────────────────────────────────────────────
function wibTodayStr(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
function wibDayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - WIB_OFFSET_MS);
}
function wibDayEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - WIB_OFFSET_MS);
}
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? round2(numerator / denominator) : 0;
}
function safeDivOrUndef(numerator: number, denominator: number): number | undefined {
  return denominator > 0 ? Math.round(numerator / denominator) : undefined;
}
function isSandboxed(customer: any): boolean {
  return Boolean(customer?.is_sandbox_test) || Boolean(customer?.is_internal_staff);
}
function isQualifyingStatus(status: string | null | undefined): boolean {
  const s = (status || '').toLowerCase();
  return s !== 'cancelled' && s !== 'rejected';
}

const JOURNEY_BRACKETS: Array<{ key: string; label: string; test: (d: number) => boolean }> = [
  { key: 'lt1', label: '< 24 Jam', test: (d) => d < 1 },
  { key: 'd1_3', label: '1 - 3 Hari', test: (d) => d >= 1 && d < 3 },
  { key: 'd3_7', label: '3 - 7 Hari', test: (d) => d >= 3 && d < 7 },
  { key: 'd7_14', label: '7 - 14 Hari', test: (d) => d >= 7 && d < 14 },
  { key: 'gt14', label: '> 14 Hari', test: (d) => d >= 14 },
];
const LEADTIME_BRACKETS: Array<{ key: string; label: string; test: (d: number) => boolean }> = [
  { key: 'same_day', label: 'Same-Day (H-0)', test: (d) => d <= 0 },
  { key: 'h1', label: 'H-1 (Besok)', test: (d) => d === 1 },
  { key: 'h2_3', label: 'H-2 s/d H-3', test: (d) => d >= 2 && d <= 3 },
  { key: 'h4_7', label: 'H-4 s/d H-7', test: (d) => d >= 4 && d <= 7 },
  { key: 'gt7', label: '> H-7', test: (d) => d > 7 },
];
const NO_DATE_KEY = { key: 'no_date', label: 'Tanpa Tanggal' };

// ── ZERO report (offline-safe) ──────────────────────────────────────────────
export function buildZeroMetaPerformanceReport(
  tenantId: string,
  startDate: string,
  endDate: string,
  opts: { adSpend?: number; errors?: string[]; dbNote?: string } = {},
): MetaPerformanceReport {
  return {
    meta: {
      tenantId,
      startDate,
      endDate,
      adSpend: opts.adSpend,
      revenueBasis: {
        treatmentSource: 'purchase_value+catalog_fallback',
        deliverySource: 'snapshot+fallback',
        excludedStatuses: EXCLUDED_REVENUE_STATUSES,
        pendingHoldIncluded: false,
        truncated: false,
        errors: opts.errors ?? [],
      },
      dbNote: opts.dbNote,
    },
    kpiSummary: {
      newCustomersAcquired: 0,
      initialRevenue: 0,
      initialAov: 0,
      repeatCustomersCount: 0,
      repeatRevenue: 0,
      totalAdRevenue: 0,
      totalClinicRevenue: 0,
      adRevenueSharePct: 0,
      realCac: undefined,
      costPerLead: undefined,
      costPerMql: undefined,
      initialRoas: undefined,
      lifetimeRoas: undefined,
    },
    funnel: {
      pageViews: 0,
      totalClicks: 0,
      matchedChats: 0,
      unmatchedDrain: 0,
      mqlLeads: 0,
      newCustomers: 0,
      conversionRates: { lpToClick: 0, clickToChat: 0, chatToMql: 0, mqlToBuyer: 0 },
      coverageNote: 'Tidak ada data tersedia (DB offline atau rentang kosong).',
    },
    channelComparison: [],
    campaignBreakdown: [],
    journeyVelocity: {
      meanDays: null,
      medianDays: null,
      brackets: JOURNEY_BRACKETS.map((b) => ({ key: b.key, label: b.label, count: 0, pct: 0 })),
    },
    bookingLeadTime: [...LEADTIME_BRACKETS, NO_DATE_KEY].map((b) => ({ key: b.key, label: b.label, count: 0, pct: 0 })),
    treatmentPreferences: [],
    leakageDiagnostics: {
      topDropOffStates: [],
      outOfCoverageCount: 0,
      topRegions: [],
      followUpRecovery: { sent: 0, byStatus: {} },
    },
  };
}

/**
 * Laporan performa Meta Ads to Sales (tenant-scoped, read-only).
 * Offline-safe: setiap query gagal → fallback aman, tidak melempar unhandled rejection.
 */
export async function getMetaPerformanceReport(
  options: MetaPerformanceQueryOptions,
): Promise<MetaPerformanceReport> {
  const q = MetaPerformanceQuerySchema.parse(options);
  const tenantId = q.tenantId;

  const endStr = q.endDate || wibTodayStr();
  const startStr = q.startDate || new Date(wibDayStart(endStr).getTime() - 29 * MS_PER_DAY + WIB_OFFSET_MS).toISOString().slice(0, 10);
  const start = wibDayStart(startStr);
  const end = wibDayEnd(endStr);

  const cacheKey = `meta-perf:${tenantId}:${startStr}:${endStr}:${q.adSpend ?? 'na'}`;
  const cached = responseCacheService.get<MetaPerformanceReport>(cacheKey);
  if (cached) return cached;

  const errors: string[] = [];
  let truncated = false;

  const safeArr = async <T>(label: string, p: Promise<T[]> | null): Promise<T[]> => {
    if (!p) return [];
    try {
      return await p;
    } catch (e: any) {
      errors.push(`${label}: ${String(e?.message || e).slice(0, 120)}`);
      return [];
    }
  };

  const pvModel = (prisma as any).landingPageView;
  const convoModel = (prisma as any).conversation;
  const followUpModel = (prisma as any).followUp;

  const baseWhere = { tenant_id: tenantId, ...META_BOT_EXCLUDE_CLAUSE };

  const dateWhere = { createdAt: { gte: start, lte: end } };

  const [rangeClicks, matchedAds, rangeReservations, historyReservations, convoRows, followUpRows, cohortCustomers] =
    await Promise.all([
      safeArr(
        'adClick',
        prisma.adClick.findMany({
          where: { ...baseWhere, ...dateWhere },
          select: { customerId: true, matchedAt: true, utmCampaign: true, utmSource: true, utmMedium: true, ctwa_clid: true, createdAt: true },
          take: MAX_ROWS,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'adClick(matched)',
        prisma.adClick.findMany({
          where: { ...baseWhere, matchedAt: { not: null } },
          select: { customerId: true, matchedAt: true, utmCampaign: true, utmSource: true, utmMedium: true, ctwa_clid: true, createdAt: true, customer: { select: { id: true, created_at: true, is_mql: true, kecamatan: true, kota: true, is_out_of_coverage: true } } },
          take: MAX_ROWS,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'reservation(range)',
        prisma.reservation.findMany({
          where: { tenant_id: tenantId, created_at: { gte: start, lte: end } },
          select: {
            id: true, customer_id: true, created_at: true, booking_date: true, status: true, purchase_value: true,
            treatment_detail: true, treatment_category: true, delivery_fee: true,
            customer: { select: { id: true, created_at: true, ongkir: true, is_mql: true, mql_triggered_at: true, is_sandbox_test: true, is_internal_staff: true, kecamatan: true, kota: true, is_out_of_coverage: true } },
          },
          orderBy: { created_at: 'asc' },
          take: MAX_ROWS + 1,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'reservation(history)',
        prisma.reservation.findMany({
          where: { tenant_id: tenantId },
          select: {
            id: true, customer_id: true, created_at: true, status: true, purchase_value: true, treatment_detail: true,
            treatment_category: true, delivery_fee: true,
            customer: { select: { id: true, created_at: true, ongkir: true, is_sandbox_test: true, is_internal_staff: true } },
          },
          orderBy: { created_at: 'asc' },
          take: MAX_ROWS + 1,
        }) as unknown as Promise<any[]>,
      ),
      safeArr(
        'conversation',
        convoModel && typeof convoModel.findMany === 'function'
          ? (convoModel.findMany({
              where: { tenant_id: tenantId },
              select: { customer_id: true, current_state: true, is_human_handling: true },
              take: MAX_ROWS + 1,
            }) as Promise<any[]>)
          : null,
      ),
      safeArr(
        'followUp',
        followUpModel && typeof followUpModel.findMany === 'function'
          ? (followUpModel.findMany({
              where: { tenant_id: tenantId, type: 'NO_PURCHASE' },
              select: { customer_id: true, status: true },
              take: MAX_ROWS + 1,
            }) as Promise<any[]>)
          : null,
      ),
      safeArr(
        'customer(cohort)',
        prisma.customer.findMany({
          where: { tenant_id: tenantId, ...SANDBOX_EXCLUDE, adClick: { isNot: null } },
          select: { id: true, created_at: true, is_mql: true, mql_triggered_at: true, kecamatan: true, kota: true, is_out_of_coverage: true },
          take: MAX_ROWS + 1,
        }) as unknown as Promise<any[]>,
      ),
    ]);

  if (rangeReservations.length > MAX_ROWS || matchedAds.length > MAX_ROWS || historyReservations.length > MAX_ROWS) {
    truncated = true;
  }
  if (rangeReservations.length > MAX_ROWS) rangeReservations.length = MAX_ROWS;
  if (historyReservations.length > MAX_ROWS) historyReservations.length = MAX_ROWS;
  if (matchedAds.length > MAX_ROWS) matchedAds.length = MAX_ROWS;

  const dbNote = errors.length ? `Sebagian query gagal: ${errors.slice(0, 3).join(' | ')}` : undefined;

  // ── Kanal & kohort iklan ──────────────────────────────────────────────────
  const channelOf = (a: any): 'CTWA_NATIVE' | 'PROMO_CTA' => (a?.ctwa_clid ? 'CTWA_NATIVE' : 'PROMO_CTA');
  const cohortCustomerIds = new Set<string>();
  const firstTouchByCustomer = new Map<string, number>();
  for (const a of matchedAds) {
    if (!a.customerId) continue;
    cohortCustomerIds.add(a.customerId);
    const t = a.matchedAt ? new Date(a.matchedAt).getTime() : (a.customer?.created_at ? new Date(a.customer.created_at).getTime() : NaN);
    if (Number.isFinite(t)) {
      const prev = firstTouchByCustomer.get(a.customerId);
      if (prev === undefined || t < prev) firstTouchByCustomer.set(a.customerId, t);
    }
  }

  const customerMap = new Map<string, any>();
  for (const c of cohortCustomers) customerMap.set(c.id, c);
  for (const a of matchedAds) {
    if (a.customerId && !customerMap.has(a.customerId)) customerMap.set(a.customerId, a.customer);
  }

  // ── Revenue seam ──────────────────────────────────────────────────────────
  const catalogCache = new Map<string, number>();
  const treatmentFeeOf = async (r: any): Promise<number> => {
    const pv = Number(r?.purchase_value);
    if (Number.isFinite(pv) && pv > 0) return pv;
    const detail = r?.treatment_detail;
    if (!detail) return 0;
    const key = String(detail);
    if (catalogCache.has(key)) return catalogCache.get(key) || 0;
    let resolved = 0;
    try {
      const v = await resolveTreatmentValue(detail, tenantId);
      resolved = v && v > 0 ? v : 0;
    } catch {
      resolved = 0;
    }
    catalogCache.set(key, resolved);
    return resolved;
  };
  const totalFeeOf = (r: any, treatmentFee: number): number => treatmentFee + resolveDeliveryFeeSnapshot(r);

  const isQualifying = (r: any): boolean => isQualifyingStatus(r?.status) && !isSandboxed(r?.customer);

  // First-ever qualifying reservation per cohort customer.
  const firstEverByCustomer = new Map<string, any>();
  for (const r of historyReservations) {
    if (!r.customer_id || !cohortCustomerIds.has(r.customer_id)) continue;
    if (!isQualifying(r)) continue;
    if (!firstEverByCustomer.has(r.customer_id)) firstEverByCustomer.set(r.customer_id, r);
  }

  // ── Funnel ────────────────────────────────────────────────────────────────
  const totalClicks = rangeClicks.length;
  const matchedChats = rangeClicks.filter((a) => a.matchedAt).length;
  const unmatchedDrain = Math.max(0, totalClicks - matchedChats);

  const pageViews = pvModel && typeof pvModel.count === 'function'
    ? await (pvModel.count({ where: { ...baseWhere, ...dateWhere } }) as Promise<number>).catch(() => 0)
    : 0;

  const mqlCohort = cohortCustomers.filter((c) => c.is_mql);
  const mqlLeads = mqlCohort.length;

  // ── KPI CAC / LTV ─────────────────────────────────────────────────────────
  let initialRevenue = 0;
  let newCustomers = 0;
  let totalClinicRevenue = 0;
  const journeyDaysList: number[] = [];
  const channelAgg = new Map<string, { leads: Set<string>; mql: number; buyers: number; initialRevenue: number; journey: number[] }>();
  const campaignAgg = new Map<string, { source: string | null; clicks: number; chats: number }>();

  for (const a of rangeClicks) {
    const key = a.utmCampaign || '(tanpa campaign)';
    const entry = campaignAgg.get(key) || { source: a.utmSource || a.utmMedium || null, clicks: 0, chats: 0 };
    entry.clicks += 1;
    if (a.matchedAt) entry.chats += 1;
    campaignAgg.set(key, entry);
  }

  // Earliest matched ad per customer → atribusi kanal & campaign deterministik.
  const earliestAdByCustomer = new Map<string, any>();
  for (const a of matchedAds) {
    if (!a.customerId) continue;
    const t = new Date(a.matchedAt || a.createdAt).getTime();
    const prev = earliestAdByCustomer.get(a.customerId);
    if (!prev || t < new Date(prev.matchedAt || prev.createdAt).getTime()) earliestAdByCustomer.set(a.customerId, a);
  }

  const campaignDetail = new Map<string, { mql: number; buyers: number; initialRevenue: number }>();

  for (const customerId of cohortCustomerIds) {
    const ad = earliestAdByCustomer.get(customerId);
    const ch = ad ? channelOf(ad) : 'PROMO_CTA';
    const camp = ad?.utmCampaign || '(tanpa campaign)';
    const cust = customerMap.get(customerId);

    const ce = channelAgg.get(ch) || { leads: new Set<string>(), mql: 0, buyers: 0, initialRevenue: 0, journey: [] as number[] };
    ce.leads.add(customerId);
    if (cust?.is_mql) ce.mql += 1;
    channelAgg.set(ch, ce);

    const cd = campaignDetail.get(camp) || { mql: 0, buyers: 0, initialRevenue: 0 };
    if (cust?.is_mql) cd.mql += 1;

    const firstEver = firstEverByCustomer.get(customerId);
    if (firstEver) {
      const createdAt = new Date(firstEver.created_at).getTime();
      if (createdAt >= start.getTime() && createdAt <= end.getTime()) {
        newCustomers += 1;
        const fee = await treatmentFeeOf(firstEver);
        const total = totalFeeOf(firstEver, fee);
        initialRevenue += total;
        ce.buyers += 1;
        ce.initialRevenue += total;
        cd.buyers += 1;
        cd.initialRevenue += total;
        const touch = firstTouchByCustomer.get(customerId);
        if (touch !== undefined) {
          const jd = Math.max(0, Math.floor((createdAt - touch) / MS_PER_DAY));
          ce.journey.push(jd);
          journeyDaysList.push(jd);
        }
      }
    }
    campaignDetail.set(camp, cd);
  }

  // Repeat revenue: qualifying cohort reservations in range that are NOT the first-ever reservation.
  let repeatRevenue = 0;
  const repeatCustomerSet = new Set<string>();
  const leadTimeBuckets = new Map<string, number>();
  for (const b of LEADTIME_BRACKETS) leadTimeBuckets.set(b.key, 0);
  leadTimeBuckets.set(NO_DATE_KEY.key, 0);

  const treatmentAgg = new Map<string, { category: string; name: string; orders: number; revenue: number }>();
  let leadTimeTotal = 0;

  for (const r of rangeReservations) {
    if (!r.customer_id) continue;
    const qualifies = isQualifying(r);
    const fee = qualifies ? await treatmentFeeOf(r) : 0;
    const total = qualifies ? totalFeeOf(r, fee) : 0;
    if (qualifies) totalClinicRevenue += total;

    const firstEver = firstEverByCustomer.get(r.customer_id);
    const isFirstEverRow = firstEver && firstEver.id === r.id;

    if (qualifies && cohortCustomerIds.has(r.customer_id)) {
      if (!isFirstEverRow) {
        repeatRevenue += total;
        repeatCustomerSet.add(r.customer_id);
      }
      // lead time (all qualifying cohort bookings with date)
      if (r.booking_date) {
        const lt = Math.floor((new Date(r.booking_date).getTime() - new Date(r.created_at).getTime()) / MS_PER_DAY);
        const bucket = LEADTIME_BRACKETS.find((b) => b.test(lt));
        if (bucket) leadTimeBuckets.set(bucket.key, (leadTimeBuckets.get(bucket.key) || 0) + 1);
        leadTimeTotal += 1;
      } else {
        leadTimeBuckets.set(NO_DATE_KEY.key, (leadTimeBuckets.get(NO_DATE_KEY.key) || 0) + 1);
      }
      // treatment preferences
      if (r.treatment_detail) {
        const name = String(r.treatment_detail).split(/\r?\n|,|;/)[0].trim();
        if (name) {
          const key = `${r.treatment_category || 'OTHER'}::${name}`;
          const t = treatmentAgg.get(key) || { category: r.treatment_category || 'OTHER', name, orders: 0, revenue: 0 };
          t.orders += 1;
          t.revenue += total;
          treatmentAgg.set(key, t);
        }
      }
    }
  }

  const initialAov = newCustomers > 0 ? Math.round(initialRevenue / newCustomers) : 0;
  const totalAdRevenue = initialRevenue + repeatRevenue;
  const adRevenueSharePct = totalClinicRevenue > 0 ? round2((totalAdRevenue / totalClinicRevenue) * 100) : 0;
  const adSpend = q.adSpend;
  const kpiSummary = {
    newCustomersAcquired: newCustomers,
    initialRevenue,
    initialAov,
    repeatCustomersCount: repeatCustomerSet.size,
    repeatRevenue,
    totalAdRevenue,
    totalClinicRevenue,
    adRevenueSharePct,
    realCac: adSpend !== undefined && newCustomers > 0 ? Math.round(adSpend / newCustomers) : undefined,
    costPerLead: adSpend !== undefined && matchedChats > 0 ? Math.round(adSpend / matchedChats) : undefined,
    costPerMql: adSpend !== undefined && mqlLeads > 0 ? Math.round(adSpend / mqlLeads) : undefined,
    initialRoas: adSpend !== undefined && adSpend > 0 ? round2(initialRevenue / adSpend) : undefined,
    lifetimeRoas: adSpend !== undefined && adSpend > 0 ? round2(totalAdRevenue / adSpend) : undefined,
  };

  const journeySorted = [...journeyDaysList].sort((a, b) => a - b);
  const journeyBrackets = JOURNEY_BRACKETS.map((b) => {
    const count = journeyDaysList.filter((d) => b.test(d)).length;
    return { key: b.key, label: b.label, count, pct: journeyDaysList.length > 0 ? round2((count / journeyDaysList.length) * 100) : 0 };
  });

  const leadTimeArr = [...LEADTIME_BRACKETS, NO_DATE_KEY].map((b) => {
    const count = leadTimeBuckets.get(b.key) || 0;
    return { key: b.key, label: b.label, count, pct: leadTimeTotal > 0 && b.key !== NO_DATE_KEY.key ? round2((count / leadTimeTotal) * 100) : 0 };
  });

  const channelComparison: MetaPerformanceReport['channelComparison'] = (['CTWA_NATIVE', 'PROMO_CTA'] as const).map((channel) => {
    const ce = channelAgg.get(channel) || { leads: new Set<string>(), mql: 0, buyers: 0, initialRevenue: 0, journey: [] as number[] };
    return {
      channel,
      leads: ce.leads.size,
      mql: ce.mql,
      firstTimeBuyers: ce.buyers,
      initialRevenue: ce.initialRevenue,
      aov: ce.buyers > 0 ? Math.round(ce.initialRevenue / ce.buyers) : 0,
      meanJourneyDays: mean(ce.journey),
    };
  });

  const allCampaigns = new Set<string>([...campaignAgg.keys(), ...campaignDetail.keys()]);
  const campaignBreakdown = Array.from(allCampaigns)
    .map((utmCampaign) => {
      const v = campaignAgg.get(utmCampaign) || { source: null as string | null, clicks: 0, chats: 0 };
      const cd = campaignDetail.get(utmCampaign) || { mql: 0, buyers: 0, initialRevenue: 0 };
      return {
        utmCampaign,
        source: v.source,
        clicks: v.clicks,
        chats: v.chats,
        mql: cd.mql,
        buyers: cd.buyers,
        initialRevenue: cd.initialRevenue,
        status: (v.chats > 0 ? 'MATCHED' : 'PENDING') as 'MATCHED' | 'PENDING',
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.buyers - a.buyers);

  const treatmentPreferences = Array.from(treatmentAgg.values()).sort((a, b) => b.orders - a.orders).slice(0, 10);

  // ── Leakage diagnostics ───────────────────────────────────────────────────
  const closingCustomerIds = new Set<string>();
  for (const r of rangeReservations) {
    if (r.customer_id && isQualifying(r) && cohortCustomerIds.has(r.customer_id)) closingCustomerIds.add(r.customer_id);
  }
  const stateAgg = new Map<string, number>();
  for (const c of convoRows) {
    if (!c.customer_id || !cohortCustomerIds.has(c.customer_id)) continue;
    if (closingCustomerIds.has(c.customer_id)) continue;
    const label = c.is_human_handling ? `${c.current_state || 'UNKNOWN'} (Human Handling)` : (c.current_state || 'UNKNOWN');
    stateAgg.set(label, (stateAgg.get(label) || 0) + 1);
  }
  const topDropOffStates = Array.from(stateAgg.entries()).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count).slice(0, 5);

  const regionAgg = new Map<string, number>();
  let outOfCoverageCount = 0;
  for (const c of customerMap.values()) {
    if (c?.is_out_of_coverage) outOfCoverageCount += 1;
    const region = c?.kecamatan || c?.kota;
    if (region) regionAgg.set(region, (regionAgg.get(region) || 0) + 1);
  }
  const topRegions = Array.from(regionAgg.entries()).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count).slice(0, 10);

  const followUpByStatus: Record<string, number> = {};
  let followUpSent = 0;
  for (const f of followUpRows) {
    if (!f.customer_id || !cohortCustomerIds.has(f.customer_id)) continue;
    const st = f.status || 'UNKNOWN';
    followUpByStatus[st] = (followUpByStatus[st] || 0) + 1;
    if (st === 'SENT') followUpSent += 1;
  }

  const conversionRates = {
    lpToClick: safeDiv(totalClicks, pageViews),
    clickToChat: safeDiv(matchedChats, totalClicks),
    chatToMql: safeDiv(mqlLeads, matchedChats),
    mqlToBuyer: safeDiv(newCustomers, mqlLeads),
  };

  const coverageNote = pageViews === 0 && totalClicks > 0
    ? 'Belum ada PageView terinstrumentasi pada rentang ini (LP belum pasang tracker/beacon). Klik CTA = superset.'
    : pageViews > 0 && totalClicks > pageViews
      ? 'CTR parsial — sebagian klik dari link langsung / LP tanpa tracker (coverage gap).'
      : 'PageView = LP terinstrumentasi (subset); Klik CTA = superset (termasuk direct/cta). Data sebelum beacon tidak di-backfill.';
  const ctrNote = pageViews > 0 && totalClicks > pageViews ? 'CTR parsial (klik > view).' : undefined;

  const report: MetaPerformanceReport = {
    meta: {
      tenantId,
      startDate: startStr,
      endDate: endStr,
      adSpend,
      revenueBasis: {
        treatmentSource: 'purchase_value+catalog_fallback',
        deliverySource: 'snapshot+fallback',
        excludedStatuses: EXCLUDED_REVENUE_STATUSES,
        pendingHoldIncluded: false,
        truncated,
        errors,
      },
      dbNote,
    },
    kpiSummary,
    funnel: {
      pageViews,
      totalClicks,
      matchedChats,
      unmatchedDrain,
      mqlLeads,
      newCustomers,
      conversionRates,
      coverageNote,
      ctrNote,
    },
    channelComparison,
    campaignBreakdown,
    journeyVelocity: {
      meanDays: mean(journeyDaysList),
      medianDays: median(journeySorted),
      brackets: journeyBrackets,
    },
    bookingLeadTime: leadTimeArr,
    treatmentPreferences,
    leakageDiagnostics: {
      topDropOffStates,
      outOfCoverageCount,
      topRegions,
      followUpRecovery: { sent: followUpSent, byStatus: followUpByStatus },
    },
  };

  if (errors.length === 0) {
    responseCacheService.set(cacheKey, report, CACHE_TTL_SECONDS);
  }
  return report;
}

/** Ekspor helper murni untuk pengujian unit (tanpa DB). */
export const _internal = { wibDayStart, wibDayEnd, median, mean, safeDiv, safeDivOrUndef, JOURNEY_BRACKETS, LEADTIME_BRACKETS };

import { z } from 'zod';

export const SANDBOX_EXCLUDE = { is_sandbox_test: false, is_internal_staff: false } as const;
export const EXCLUDED_REVENUE_STATUSES = ['cancelled', 'rejected'] as const;

export const META_BOT_EXCLUDE_CLAUSE: any = {
  OR: [
    { userAgent: null },
    {
      NOT: [
        { userAgent: { contains: 'facebookexternalhit', mode: 'insensitive' } },
        { userAgent: { contains: 'facebot', mode: 'insensitive' } },
        { userAgent: { contains: 'meta-externalagent', mode: 'insensitive' } },
        { userAgent: { contains: 'googlebot', mode: 'insensitive' } },
        { userAgent: { contains: 'bingbot', mode: 'insensitive' } },
        { userAgent: { contains: 'twitterbot', mode: 'insensitive' } },
      ],
    },
  ],
};

export const WIB_OFFSET_MS = 7 * 3600 * 1000;
export const MS_PER_DAY = 86_400_000;
export const MAX_ROWS = 5000;
export const CACHE_TTL_SECONDS = 30;

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

export type CohortChannel = 'ALL' | 'LPWA' | 'CTWA' | 'ORGANIC';

export interface CohortMonthlyPeriodMetric {
  count: number;
  pct: number;
  orders: number;
  revenue: number;
  upcomingCount: number;
  upcomingRevenue: number;
  status: 'COMPLETED' | 'ONGOING' | 'FUTURE';
}

export interface UnifiedMonthlyCohortRow {
  cohortMonth: string;
  channel: CohortChannel;
  channelLabel: string;
  cohortSize: number;
  initialRevenue: number;
  initialDeliveryFee: number;
  initialUpcomingOrders: number;
  initialUpcomingRevenue: number;
  repeatM1: CohortMonthlyPeriodMetric | null;
  repeatM2: CohortMonthlyPeriodMetric | null;
  repeatM3: CohortMonthlyPeriodMetric | null;
  repeatM4: CohortMonthlyPeriodMetric | null;
  repeatM5: CohortMonthlyPeriodMetric | null;
  cumulativeRepeatCount?: number;
  cumulativeRepeatPct?: number;
  avgDaysToSecondVisit?: number | null;
  totalRealizedRevenue: number;
  revenuePerPatient: number;
  adSpend: number | null;
  cac: number | null;
  roas: number | null;
  paybackStatus: 'BALIK_MODAL' | 'BELUM_BALIK_MODAL' | 'BELUM_DIISI' | 'TIDAK_BERLAKU';
  isOngoing: boolean;
  isSmallSample: boolean;
}

export interface CohortPlanningMetrics {
  matureLtv60Days: number | null;
  matureSamplePatients: number;
  hasEnoughData: boolean;
  grossMarginPct: number;
  maxAllowableCac: number | null;
  minSampleThreshold: number;
  dataCutoffDate: string;
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
    channel: 'CTWA_NATIVE' | 'CTWA_FUZZY' | 'PROMO_CTA';
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
    mqlDropOff: {
      mqlTotal: number;
      converted: number;
      convertedFirstTime?: number;
      convertedRepeat?: number;
      dropped: number;
      outOfCoverage: number;
      cancelled: number;
      noReservation: number;
    };
  };
  retentionCohorts: Array<{
    cohort: string;
    size: number;
    returned30: number | null;
    returned60: number | null;
    returned90: number | null;
  }>;
  monthlyCohorts: UnifiedMonthlyCohortRow[];
  rolling3MonthCohorts?: UnifiedMonthlyCohortRow[];
  cohortPlanning: CohortPlanningMetrics;
  therapistCapacity: {
    activeTherapists: number;
    dailySlotsPerTherapist: number | null;
    totalSlotsCapacity: number | null;
    bookingCount: number;
    utilizationPct: number | null;
    band: 'AMAN' | 'OPTIMAL' | 'PENUH' | 'UNKNOWN';
  } | null;
}

export function wibTodayStr(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
export function wibDayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - WIB_OFFSET_MS);
}
export function wibDayEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - WIB_OFFSET_MS);
}
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
export function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? round2(numerator / denominator) : 0;
}
export function safeDivOrUndef(numerator: number, denominator: number): number | undefined {
  return denominator > 0 ? Math.round(numerator / denominator) : undefined;
}
export function isSandboxed(customer: any): boolean {
  return Boolean(customer?.is_sandbox_test) || Boolean(customer?.is_internal_staff);
}
export function isQualifyingStatus(status: string | null | undefined): boolean {
  const s = (status || '').toLowerCase();
  return s !== 'cancelled' && s !== 'rejected';
}

const UTM_MACRO_RE = /\{\{[^}]*\}\}/;
export function isUnrenderedUtmMacro(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && UTM_MACRO_RE.test(raw);
}
export function sanitizeUtmCampaign(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '(tanpa campaign)';
  return isUnrenderedUtmMacro(t) ? '(macro UTM belum dirender)' : t;
}
export function sanitizeUtmSource(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t || isUnrenderedUtmMacro(t)) return null;
  return t;
}

export const RETENTION_WINDOWS_DAYS = [30, 60, 90] as const;

export function wibDateKey(date: Date): string {
  return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function capacityBandFor(utilizationPct: number | null): 'AMAN' | 'OPTIMAL' | 'PENUH' | 'UNKNOWN' {
  if (utilizationPct === null || !Number.isFinite(utilizationPct)) return 'UNKNOWN';
  if (utilizationPct < 65) return 'AMAN';
  if (utilizationPct <= 85) return 'OPTIMAL';
  return 'PENUH';
}

export const JOURNEY_BRACKETS: Array<{ key: string; label: string; test: (d: number) => boolean }> = [
  { key: 'lt1', label: '< 24 Jam', test: (d) => d < 1 },
  { key: 'd1_3', label: '1 - 3 Hari', test: (d) => d >= 1 && d < 3 },
  { key: 'd3_7', label: '3 - 7 Hari', test: (d) => d >= 3 && d < 7 },
  { key: 'd7_14', label: '7 - 14 Hari', test: (d) => d >= 7 && d < 14 },
  { key: 'gt14', label: '> 14 Hari', test: (d) => d >= 14 },
];
export const LEADTIME_BRACKETS: Array<{ key: string; label: string; test: (d: number) => boolean }> = [
  { key: 'same_day', label: 'Same-Day (H-0)', test: (d) => d <= 0 },
  { key: 'h1', label: 'H-1 (Besok)', test: (d) => d === 1 },
  { key: 'h2_3', label: 'H-2 s/d H-3', test: (d) => d >= 2 && d <= 3 },
  { key: 'h4_7', label: 'H-4 s/d H-7', test: (d) => d >= 4 && d <= 7 },
  { key: 'gt7', label: '> H-7', test: (d) => d > 7 },
];
export const NO_DATE_KEY = { key: 'no_date', label: 'Tanpa Tanggal' };

export function buildZeroMetaPerformanceReport(
  tenantId: string,
  startDate: string,
  endDate: string,
  opts: { adSpend?: number; errors?: string[]; dbNote?: string } = {}
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
      mqlDropOff: { mqlTotal: 0, converted: 0, dropped: 0, outOfCoverage: 0, cancelled: 0, noReservation: 0 },
    },
    retentionCohorts: [],
    monthlyCohorts: [],
    rolling3MonthCohorts: [],
    cohortPlanning: {
      matureLtv60Days: null,
      matureSamplePatients: 0,
      hasEnoughData: false,
      grossMarginPct: 40,
      maxAllowableCac: null,
      minSampleThreshold: 20,
      dataCutoffDate: wibTodayStr(),
    },
    therapistCapacity: null,
  };
}

export function wibMonthKey(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 7);
}

export function monthDiff(fromMonth: string, toMonth: string): number {
  const [y1, m1] = fromMonth.split('-').map(Number);
  const [y2, m2] = toMonth.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function addMonths(monthStr: string, n: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) + n;
  const newY = Math.floor(totalMonths / 12);
  const newM = (totalMonths % 12) + 1;
  return `${newY}-${String(newM).padStart(2, '0')}`;
}

export function normalizePhone(p?: string | null): string {
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('62')) return digits;
  return digits;
}

export interface BuildMonthlyCohortsParams {
  tenantId: string;
  historyReservations: any[];
  rangeReservations: any[];
  matchedAds: any[];
  monthlySpends?: Record<string, { lpwa?: number; ctwa?: number }>;
  defaultSpend?: number;
  grossMarginPct?: number;
  minSampleThreshold?: number;
  now?: Date;
  treatmentFeeOf: (r: any) => Promise<number>;
  cohortStartMonth?: string | null;
  excludedCohortMonths?: string[];
}

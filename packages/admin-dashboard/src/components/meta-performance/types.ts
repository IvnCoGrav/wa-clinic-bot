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

export interface RevenueBasis {
  treatmentSource: string;
  deliverySource: string;
  excludedStatuses: string[];
  pendingHoldIncluded: boolean;
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
    dailySlotsPerTherapist?: number;
    totalSlotsCapacity?: number;
    bookingCount: number;
    utilizationPct: number | null;
    band: 'AMAN' | 'OPTIMAL' | 'PENUH' | 'UNKNOWN';
  } | null;
}

export const fmtRupiah = (v?: number | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? `Rp ${v.toLocaleString('id-ID')}` : '-';

export const fmtPct = (v?: number | null, digits = 2): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '-';

export const fmtNum = (v?: number | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('id-ID') : '-';

export function fmtCompactCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '-';
  if (val === 0) return '0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    const num = abs / 1_000_000_000;
    return `${sign}${num % 1 === 0 ? num.toFixed(0) : num.toFixed(1).replace(/\.0$/, '')}b`;
  }
  if (abs >= 1_000_000) {
    const num = abs / 1_000_000;
    return `${sign}${num % 1 === 0 ? num.toFixed(0) : num.toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (abs >= 1_000) {
    const num = abs / 1_000;
    return `${sign}${num % 1 === 0 ? num.toFixed(0) : num.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${sign}${abs}`;
}

/**
 * Helper murni untuk kalkulasi dan validasi metrik dashboard (audit anti-slop).
 * Bebas efek samping — mudah diuji unit test offline.
 */

export function pickNumber(val: unknown, fallback: number | null = null): number | null {
  if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
    return val;
  }
  return fallback;
}

export function hasChartData(data: Array<{ revenue?: number | null; bookings?: number }>): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.some((item) => (item.revenue && item.revenue > 0) || (item.bookings && item.bookings > 0));
}

export interface DailyChartPoint {
  name: string;
  day: number;
  revenue: number | null;
  bookings: number;
  lunasRevenue?: number;
  pendingRevenue?: number;
  lastMonthRevenue: number | null;
  lastMonthBookings: number | null;
  avg6mRevenue: number | null;
  avg6mBookings: number | null;
  baselineSamples: number;
  hasHappened: boolean;
  dayName?: string;
  dateStr?: string;
}

/**
 * Memetakan payload `dailyTrend` dari backend ke format titik chart bersama.
 * Menghindari duplikasi parsing antara Overview dan FinancialAnalytics.
 */
export function mapDailyTrendToChart(dailyTrend: any[]): DailyChartPoint[] {
  if (!Array.isArray(dailyTrend)) return [];
  return dailyTrend.map((p: any) => {
    const hasHappened = p?.isPastOrToday !== false;
    return {
      name: String(p?.day ?? ''),
      day: Number(p?.day ?? 0),
      revenue: hasHappened ? (Number.isFinite(p?.revenue) ? Number(p.revenue) : 0) : null,
      bookings: Number.isFinite(p?.bookingsCount) ? Number(p.bookingsCount) : 0,
      lunasRevenue: hasHappened ? (Number.isFinite(p?.lunasRevenue) ? Number(p.lunasRevenue) : 0) : 0,
      pendingRevenue: hasHappened ? (Number.isFinite(p?.pendingRevenue) ? Number(p.pendingRevenue) : 0) : 0,
      lastMonthRevenue:
        p?.lastMonthRevenue !== undefined && p?.lastMonthRevenue !== null ? Number(p.lastMonthRevenue) : null,
      lastMonthBookings:
        p?.lastMonthBookings !== undefined && p?.lastMonthBookings !== null ? Number(p.lastMonthBookings) : null,
      avg6mRevenue: p?.avg6mRevenue !== undefined && p?.avg6mRevenue !== null ? Number(p.avg6mRevenue) : null,
      avg6mBookings:
        p?.avg6mBookings !== undefined && p?.avg6mBookings !== null ? Number(p.avg6mBookings) : null,
      baselineSamples: Number.isFinite(p?.baselineSamples) ? Number(p.baselineSamples) : 0,
      hasHappened,
      dayName: p?.dayName,
      dateStr: p?.dateStr,
    };
  });
}

export interface ForecastSummaryDto {
  method: 'BASELINE_PACED' | 'BASELINE_ONLY' | 'RUN_RATE_FLAT' | 'HISTORICAL' | 'NOT_APPLICABLE';
  asOfDay: number;
  daysRemaining: number;
  pacingFactor: number | null;
  projectedEndRevenue: number | null;
  projectedEndBookings: number | null;
  scheduledFutureRevenue: number;
}

export interface CumulativeChartPoint {
  name: string;
  day: number;
  dateStr?: string;
  dayName?: string;
  hasHappened: boolean;
  isForecast: boolean;
  scheduledRevenue: number;
  cumulativeRevenue: number | null;
  cumulativeRepeatRevenue: number | null;
  cumulativeNewRevenue: number | null;
  cumulativeBookings: number | null;
  cumulativeRepeatBookings: number | null;
  cumulativeNewBookings: number | null;
  cumulativeLastMonthRevenue: number | null;
  cumulativeLastMonthBookings: number | null;
  cumulativeAvgRevenue: number | null;
  cumulativeAvgBookings: number | null;
  cumulativeForecastRevenue: number | null;
  cumulativeForecastBookings: number | null;
}

export function mapCumulativeTrendToChart(cumulativeTrend: any[]): CumulativeChartPoint[] {
  if (!Array.isArray(cumulativeTrend)) return [];
  return cumulativeTrend.map((p: any) => ({
    name: String(p?.day ?? ''),
    day: Number(p?.day ?? 0),
    dateStr: p?.dateStr,
    dayName: p?.dayName,
    hasHappened: p?.isPastOrToday !== false,
    isForecast: Boolean(p?.isForecast),
    scheduledRevenue: pickNumber(p?.scheduledRevenue, 0) ?? 0,
    cumulativeRevenue: pickNumber(p?.cumulativeRevenue),
    cumulativeRepeatRevenue: pickNumber(p?.cumulativeRepeatRevenue),
    cumulativeNewRevenue: pickNumber(p?.cumulativeNewRevenue),
    cumulativeBookings: pickNumber(p?.cumulativeBookings),
    cumulativeRepeatBookings: pickNumber(p?.cumulativeRepeatBookings),
    cumulativeNewBookings: pickNumber(p?.cumulativeNewBookings),
    cumulativeLastMonthRevenue: pickNumber(p?.cumulativeLastMonthRevenue),
    cumulativeLastMonthBookings: pickNumber(p?.cumulativeLastMonthBookings),
    cumulativeAvgRevenue: pickNumber(p?.cumulativeAvgRevenue),
    cumulativeAvgBookings: pickNumber(p?.cumulativeAvgBookings),
    cumulativeForecastRevenue: pickNumber(p?.cumulativeForecastRevenue),
    cumulativeForecastBookings: pickNumber(p?.cumulativeForecastBookings),
  }));
}

/**
 * Label mode baseline yang dipakai bersama oleh Overview & Financial Analytics.
 * Menghindari duplikasi string di dua halaman (dan label "MA 7-hari" yang salah
 * saat smoothing 0/3/5).
 */
export function describeBaselineMode(
  mode?: string | null,
  smoothingWindowDays?: number | null
): string {
  if (mode === 'calendar') {
    const window = Number(smoothingWindowDays);
    return Number.isFinite(window) && window > 1 ? `Kalender (MA ${window}-hari)` : 'Kalender (tanpa MA)';
  }
  return 'Hari Sepekan (Weekday)';
}

/**
 * Dipertahankan sebagai re-export agar pemanggil lama tidak rusak. Implementasi
 * tunggal ada di `utils/money.ts` supaya nominal di dashboard, invoice, dan chat
 * tidak lagi berbeda format.
 */
export { formatRupiah } from '../utils/money';

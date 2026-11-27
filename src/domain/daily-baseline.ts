import { AnalyticsBaselineSettings, BaselineMode } from '../config/analytics-baseline';
import { shiftWibMonth, WIB_OFFSET_MS } from '../utils/wib-time';

export interface BaselineReservationInput {
  bookingDate: Date | string | null;
  revenue: number;
  bookings?: number;
}

export interface DailyComparisonPoint {
  day: number;
  avg6mRevenue: number | null;
  avg6mBookings: number | null;
  samples: number;
}

export interface PreviousMonthSummary {
  year: number;
  month: number;
  daysInMonth: number;
  byDay: Map<number, { revenue: number; bookings: number }>;
}

export interface DailyBaselineResult {
  available: boolean;
  reason?: 'INSUFFICIENT_HISTORY' | 'NO_HISTORY';
  mode: BaselineMode;
  smoothingWindowDays: number;
  monthsRequested: number;
  monthsUsed: number;
  windowStart: { year: number; month: number };
  windowEnd: { year: number; month: number };
  byDay: Map<number, DailyComparisonPoint>;
  previousMonth: PreviousMonthSummary;
}

export type MonthPosition = 'past' | 'current' | 'future';

export interface CumulativeTrendInputPoint {
  day: number;
  dateStr: string;
  dayName: string;
  isPastOrToday: boolean;
  revenue: number;
  bookingsCount: number;
  repeatRevenue: number;
  newRevenue: number;
  repeatBookings: number;
  newBookings: number;
}

export interface CumulativeTrendPoint {
  day: number;
  dateStr: string;
  dayName: string;
  isPastOrToday: boolean;
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

  targetPaceRevenue: number | null;
}

export interface ForecastSummary {
  method: 'BASELINE_PACED' | 'BASELINE_ONLY' | 'RUN_RATE_FLAT' | 'HISTORICAL' | 'NOT_APPLICABLE';
  asOfDay: number;
  daysRemaining: number;
  pacingFactor: number | null;
  projectedEndRevenue: number | null;
  projectedEndBookings: number | null;
  scheduledFutureRevenue: number;

  // Realisasi s/d hari ini (basis target & required pace)
  revenueToDate: number;
  bookingsToDate: number;

  // Skenario berbasis risiko historis & gap target (Fase 6)
  cancellationRate: number; // persen, historis 3 bulan
  conservativeRevenue: number | null;
  baseRevenue: number | null;
  optimisticRevenue: number | null;
  gapToTargetRevenue: number | null;
  requiredDailyRevenue: number | null;
  requiredDailyBookings: number | null;
}

export interface CumulativeForecastContext {
  monthPosition: MonthPosition;
  asOfDay: number; // 0 = bulan masa depan, 1..D = bulan berjalan, D = bulan historis
}

/**
 * Ekstraksi komponen tanggal zona waktu WIB (UTC+7) tanpa toISOString().
 */
export function wibDateParts(date: Date | string | null): {
  year: number;
  month: number;
  date: number;
  dayOfWeek: number;
} | null {
  if (!date) return null;
  const t = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  if (!Number.isFinite(t)) return null;

  const d = new Date(t + WIB_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    date: d.getUTCDate(),
    dayOfWeek: d.getUTCDay(),
  };
}

/**
 * Jumlah hari dalam satu bulan (1-indexed month: 1=Jan, 12=Des).
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Hari dalam sepekan (0=Minggu, 1=Senin, ..., 6=Sabtu) pada zona WIB.
 */
function weekdayWib(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Membangun baseline harian multi-bulan dan ringkasan komparasi bulan lalu (domain murni).
 */
export function buildDailyBaseline(input: {
  targetYear: number;
  targetMonth: number;
  settings: AnalyticsBaselineSettings;
  reservations: BaselineReservationInput[];
}): DailyBaselineResult {
  const { targetYear, targetMonth, settings, reservations } = input;
  const monthsRequested = Math.max(1, settings.months);
  const minMonths = Math.min(settings.minMonths, monthsRequested);

  // Batas jendela historis: M-monthsRequested s/d M-1
  const windowStart = shiftWibMonth(targetYear, targetMonth, -monthsRequested);
  const windowEnd = shiftWibMonth(targetYear, targetMonth, -1);

  // Previous month (M-1)
  const prevMonthInfo = windowEnd;
  const prevDaysCount = daysInMonth(prevMonthInfo.year, prevMonthInfo.month);

  // Struktur bulan-bulan dalam jendela historis
  const windowMonths: Array<{ year: number; month: number; daysCount: number; key: string }> = [];
  for (let offset = -monthsRequested; offset <= -1; offset++) {
    const ym = shiftWibMonth(targetYear, targetMonth, offset);
    windowMonths.push({
      year: ym.year,
      month: ym.month,
      daysCount: daysInMonth(ym.year, ym.month),
      key: `${ym.year}-${String(ym.month).padStart(2, '0')}`,
    });
  }

  // Agregasi transaksi historis per tanggal WIB YYYY-MM-DD
  const dailyTotals = new Map<string, { revenue: number; bookings: number }>();
  // Catat bulan-bulan yang memiliki setidaknya satu reservasi valid
  const activeMonthKeys = new Set<string>();

  for (const r of reservations) {
    if (!r.bookingDate) continue;
    const rev = Number(r.revenue);
    if (!Number.isFinite(rev) || rev < 0) continue;
    const count = Number.isFinite(r.bookings) && (r.bookings as number) > 0 ? (r.bookings as number) : 1;

    const parts = wibDateParts(r.bookingDate);
    if (!parts) continue;

    const dateKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.date).padStart(2, '0')}`;
    const monthKey = `${parts.year}-${String(parts.month).padStart(2, '0')}`;

    const existing = dailyTotals.get(dateKey) || { revenue: 0, bookings: 0 };
    existing.revenue += rev;
    existing.bookings += count;
    dailyTotals.set(dateKey, existing);

    activeMonthKeys.add(monthKey);
  }

  // Saring bulan dalam jendela yang aktif (memiliki transaksi)
  const usedMonths = windowMonths.filter((wm) => activeMonthKeys.has(wm.key));
  const monthsUsed = usedMonths.length;

  const available = monthsUsed >= minMonths;
  let reason: 'INSUFFICIENT_HISTORY' | 'NO_HISTORY' | undefined;
  if (monthsUsed === 0) {
    reason = 'NO_HISTORY';
  } else if (!available) {
    reason = 'INSUFFICIENT_HISTORY';
  }

  // Siapkan Previous Month data (M-1)
  // R-04: Hanya isi prevByDay bila bulan M-1 memiliki minimal 1 reservasi valid.
  // Jika bulan lalu kosong (klinik baru / gap data), biarkan kosong agar garis chart tidak jatuh rata ke 0 (missing != nol).
  const prevMonthKey = `${prevMonthInfo.year}-${String(prevMonthInfo.month).padStart(2, '0')}`;
  const hasPrevMonthReservations = activeMonthKeys.has(prevMonthKey);
  const prevByDay = new Map<number, { revenue: number; bookings: number }>();

  if (hasPrevMonthReservations) {
    for (let d = 1; d <= prevDaysCount; d++) {
      const dateKey = `${prevMonthInfo.year}-${String(prevMonthInfo.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const val = dailyTotals.get(dateKey);
      if (val) {
        prevByDay.set(d, {
          revenue: Math.round(val.revenue),
          bookings: Math.round(val.bookings * 10) / 10,
        });
      } else {
        prevByDay.set(d, { revenue: 0, bookings: 0 });
      }
    }
  }

  const previousMonth: PreviousMonthSummary = {
    year: prevMonthInfo.year,
    month: prevMonthInfo.month,
    daysInMonth: prevDaysCount,
    byDay: prevByDay,
  };

  // Hitung baseline harian untuk bulan target (1..targetDaysCount)
  const targetDaysCount = daysInMonth(targetYear, targetMonth);
  const byDay = new Map<number, DailyComparisonPoint>();

  if (settings.mode === 'weekday') {
    // Mode Weekday: Rata-rata per hari-dalam-pekan (Minggu=0, Senin=1, dst.)
    const weekdaySum = [0, 0, 0, 0, 0, 0, 0];
    const weekdayBookingsSum = [0, 0, 0, 0, 0, 0, 0];
    const weekdayCount = [0, 0, 0, 0, 0, 0, 0];

    // Iterasi setiap hari dalam bulan-bulan yang terpakai
    for (const um of usedMonths) {
      for (let d = 1; d <= um.daysCount; d++) {
        const wd = weekdayWib(um.year, um.month, d);
        const dateKey = `${um.year}-${String(um.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayData = dailyTotals.get(dateKey) || { revenue: 0, bookings: 0 };

        weekdaySum[wd] += dayData.revenue;
        weekdayBookingsSum[wd] += dayData.bookings;
        weekdayCount[wd] += 1;
      }
    }

    for (let d = 1; d <= targetDaysCount; d++) {
      const wd = weekdayWib(targetYear, targetMonth, d);
      const count = weekdayCount[wd];
      if (count > 0 && monthsUsed > 0) {
        byDay.set(d, {
          day: d,
          avg6mRevenue: Math.round(weekdaySum[wd] / count),
          avg6mBookings: Math.round((weekdayBookingsSum[wd] / count) * 10) / 10,
          samples: count,
        });
      } else {
        byDay.set(d, {
          day: d,
          avg6mRevenue: null,
          avg6mBookings: null,
          samples: 0,
        });
      }
    }
  } else {
    // Mode Calendar: Rata-rata per tanggal 1..31 + opsi Moving Average terpusat
    const rawAvgRev: Array<number | null> = new Array(targetDaysCount + 1).fill(null);
    const rawAvgBook: Array<number | null> = new Array(targetDaysCount + 1).fill(null);
    const rawSamples: number[] = new Array(targetDaysCount + 1).fill(0);

    for (let d = 1; d <= targetDaysCount; d++) {
      let sumRev = 0;
      let sumBook = 0;
      let monthMatches = 0;

      for (const um of usedMonths) {
        if (d <= um.daysCount) {
          monthMatches += 1;
          const dateKey = `${um.year}-${String(um.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const dayData = dailyTotals.get(dateKey);
          if (dayData) {
            sumRev += dayData.revenue;
            sumBook += dayData.bookings;
          }
        }
      }

      if (monthMatches > 0) {
        rawAvgRev[d] = sumRev / monthMatches;
        rawAvgBook[d] = sumBook / monthMatches;
        rawSamples[d] = monthMatches;
      }
    }

    const smoothWindow = settings.smoothingWindowDays;
    const radius = smoothWindow > 1 ? Math.floor((smoothWindow - 1) / 2) : 0;

    for (let d = 1; d <= targetDaysCount; d++) {
      if (radius > 0) {
        const start = Math.max(1, d - radius);
        const end = Math.min(targetDaysCount, d + radius);

        let windowRevSum = 0;
        let windowBookSum = 0;
        let validPoints = 0;

        for (let j = start; j <= end; j++) {
          if (rawAvgRev[j] !== null && Number.isFinite(rawAvgRev[j])) {
            windowRevSum += rawAvgRev[j] as number;
            windowBookSum += rawAvgBook[j] as number;
            validPoints += 1;
          }
        }

        if (validPoints > 0) {
          byDay.set(d, {
            day: d,
            avg6mRevenue: Math.round(windowRevSum / validPoints),
            avg6mBookings: Math.round((windowBookSum / validPoints) * 10) / 10,
            samples: rawSamples[d],
          });
        } else {
          byDay.set(d, {
            day: d,
            avg6mRevenue: null,
            avg6mBookings: null,
            samples: 0,
          });
        }
      } else {
        if (rawAvgRev[d] !== null) {
          byDay.set(d, {
            day: d,
            avg6mRevenue: Math.round(rawAvgRev[d] as number),
            avg6mBookings: Math.round((rawAvgBook[d] as number) * 10) / 10,
            samples: rawSamples[d],
          });
        } else {
          byDay.set(d, {
            day: d,
            avg6mRevenue: null,
            avg6mBookings: null,
            samples: 0,
          });
        }
      }
    }
  }

  return {
    available,
    reason,
    mode: settings.mode,
    smoothingWindowDays: settings.mode === 'calendar' ? settings.smoothingWindowDays : 0,
    monthsRequested,
    monthsUsed,
    windowStart,
    windowEnd,
    byDay,
    previousMonth,
  };
}

export function computeCumulativeAndForecast(input: {
  dailyPoints: CumulativeTrendInputPoint[];
  baseline: DailyBaselineResult | null;
  daysInMonth: number;
  context: CumulativeForecastContext;
  targetRevenue?: number | null;
  targetBookings?: number | null;
  /** Rasio pembatalan historis 0..1 (bukan persen). */
  cancellationRate?: number;
}): { points: CumulativeTrendPoint[]; summary: ForecastSummary } {
  const {
    dailyPoints,
    baseline,
    daysInMonth,
    context,
    targetRevenue,
    targetBookings,
    cancellationRate,
  } = input;
  const cancelRate = Math.max(0, Math.min(0.5, Number(cancellationRate) || 0));
  const { monthPosition } = context;
  const isPast = monthPosition === 'past';
  const isFuture = monthPosition === 'future';
  const asOfDay = isPast
    ? daysInMonth
    : isFuture
    ? 0
    : Math.max(0, Math.min(context.asOfDay, daysInMonth));

  const byDay = new Map<number, CumulativeTrendInputPoint>();
  for (const p of dailyPoints) byDay.set(p.day, p);

  const baselineAvailable = Boolean(baseline?.available);
  const baselineByDay = baselineAvailable ? baseline!.byDay : null;
  const prevHasData = Boolean(baseline?.previousMonth && baseline.previousMonth.byDay.size > 0);
  const prevByDay = prevHasData ? baseline!.previousMonth.byDay : null;
  const prevDays = baseline?.previousMonth.daysInMonth ?? 0;

  // Prefix akumulasi realisasi
  const revPrefix = new Array<number>(daysInMonth + 1).fill(0);
  const repeatRevPrefix = new Array<number>(daysInMonth + 1).fill(0);
  const newRevPrefix = new Array<number>(daysInMonth + 1).fill(0);
  const bookPrefix = new Array<number>(daysInMonth + 1).fill(0);
  const repeatBookPrefix = new Array<number>(daysInMonth + 1).fill(0);
  const newBookPrefix = new Array<number>(daysInMonth + 1).fill(0);

  for (let d = 1; d <= daysInMonth; d++) {
    const p = byDay.get(d);
    revPrefix[d] = revPrefix[d - 1] + (p?.revenue ?? 0);
    repeatRevPrefix[d] = repeatRevPrefix[d - 1] + (p?.repeatRevenue ?? 0);
    newRevPrefix[d] = newRevPrefix[d - 1] + (p?.newRevenue ?? 0);
    bookPrefix[d] = bookPrefix[d - 1] + (p?.bookingsCount ?? 0);
    repeatBookPrefix[d] = repeatBookPrefix[d - 1] + (p?.repeatBookings ?? 0);
    newBookPrefix[d] = newBookPrefix[d - 1] + (p?.newBookings ?? 0);
  }

  // Prefix bulan lalu & baseline (null bila hari itu tidak punya data)
  const lastRev = new Array<number | null>(daysInMonth + 1).fill(null);
  const lastBook = new Array<number | null>(daysInMonth + 1).fill(null);
  const avgRev = new Array<number | null>(daysInMonth + 1).fill(null);
  const avgBook = new Array<number | null>(daysInMonth + 1).fill(null);

  let cumLastRev = 0;
  let cumLastBook = 0;
  let cumAvgRev = 0;
  let cumAvgBook = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    if (prevByDay && d <= prevDays) {
      const prev = prevByDay.get(d);
      if (prev !== undefined) {
        cumLastRev += prev.revenue;
        cumLastBook += prev.bookings;
        lastRev[d] = cumLastRev;
        lastBook[d] = cumLastBook;
      }
    }
    if (baselineByDay) {
      const b = baselineByDay.get(d);
      if (b?.avg6mRevenue != null) {
        cumAvgRev += b.avg6mRevenue;
        cumAvgBook += b.avg6mBookings ?? 0;
        avgRev[d] = cumAvgRev;
        avgBook[d] = cumAvgBook;
      }
    }
  }

  // Pacing baseline s/d hari ini
  let baselineCumRevT = 0;
  let baselineCumBookT = 0;
  if (baselineByDay) {
    for (let d = 1; d <= asOfDay; d++) {
      const b = baselineByDay.get(d);
      if (b?.avg6mRevenue != null) baselineCumRevT += b.avg6mRevenue;
      if (b?.avg6mBookings != null) baselineCumBookT += b.avg6mBookings;
    }
  }

  const actualRevT = revPrefix[asOfDay];
  const actualBookT = bookPrefix[asOfDay];
  const flatRevRate = asOfDay > 0 ? actualRevT / asOfDay : 0;
  const flatBookRate = asOfDay > 0 ? actualBookT / asOfDay : 0;

  let pacingRev: number | null = null;
  let pacingBook: number | null = null;
  let method: ForecastSummary['method'];

  if (isFuture) {
    method = 'NOT_APPLICABLE';
  } else if (isPast) {
    method = 'HISTORICAL';
  } else if (baselineAvailable && baselineCumRevT > 0) {
    pacingRev = actualRevT > 0 ? actualRevT / baselineCumRevT : 1;
    pacingBook = baselineCumBookT > 0 ? actualBookT / baselineCumBookT : 1;
    method = actualRevT > 0 ? 'BASELINE_PACED' : 'BASELINE_ONLY';
  } else {
    method = 'RUN_RATE_FLAT';
  }

  // Proyeksi kumulatif untuk d > asOfDay.
  // Base = risk-adjusted: booking terjadwal dikurangi cancellation rate historis.
  const forecastRev = new Array<number | null>(daysInMonth + 1).fill(null);
  const forecastBook = new Array<number | null>(daysInMonth + 1).fill(null);

  let baseCumRev = actualRevT;
  let baseCumBook = actualBookT;
  let conservativeCumRev = actualRevT;
  let optimisticCumRev = actualRevT;

  if (monthPosition === 'current' && asOfDay < daysInMonth) {
    forecastRev[asOfDay] = baseCumRev;
    forecastBook[asOfDay] = baseCumBook;

    for (let d = asOfDay + 1; d <= daysInMonth; d++) {
      const p = byDay.get(d);
      const bookedRev = p?.revenue ?? 0;
      const bookedBook = p?.bookingsCount ?? 0;
      const b = baselineByDay?.get(d);

      const expectedRev =
        pacingRev != null && b?.avg6mRevenue != null
          ? Math.round(b.avg6mRevenue * pacingRev)
          : Math.round(flatRevRate);
      const expectedBook =
        pacingBook != null && b?.avg6mBookings != null
          ? Math.round(b.avg6mBookings * pacingBook * 10) / 10
          : Math.round(flatBookRate * 10) / 10;

      const baseScheduledRev = bookedRev * (1 - cancelRate);
      const conservativeScheduledRev = bookedRev * (1 - Math.min(0.6, cancelRate * 1.5));
      const optimisticScheduledRev = bookedRev * (1 - cancelRate * 0.5);

      baseCumRev += Math.round(Math.max(baseScheduledRev, expectedRev));
      conservativeCumRev += Math.round(Math.max(conservativeScheduledRev, expectedRev * 0.9));
      optimisticCumRev += Math.round(Math.max(optimisticScheduledRev, expectedRev * 1.1));

      const baseScheduledBook = bookedBook * (1 - cancelRate);
      baseCumBook += Math.round(Math.max(baseScheduledBook, expectedBook) * 10) / 10;

      forecastRev[d] = baseCumRev;
      forecastBook[d] = baseCumBook;
    }
  }

  const points: CumulativeTrendPoint[] = [];
  let scheduledFutureRevenue = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const p = byDay.get(d);
    const realized = isPast ? true : isFuture ? false : d <= asOfDay;
    const scheduled = !realized ? (p?.revenue ?? 0) : 0;
    scheduledFutureRevenue += scheduled;

    points.push({
      day: d,
      dateStr: p?.dateStr ?? '',
      dayName: p?.dayName ?? '',
      isPastOrToday: realized,
      isForecast: monthPosition === 'current' && d > asOfDay,
      scheduledRevenue: scheduled,

      cumulativeRevenue: realized ? revPrefix[d] : null,
      cumulativeRepeatRevenue: realized ? repeatRevPrefix[d] : null,
      cumulativeNewRevenue: realized ? newRevPrefix[d] : null,
      cumulativeBookings: realized ? bookPrefix[d] : null,
      cumulativeRepeatBookings: realized ? repeatBookPrefix[d] : null,
      cumulativeNewBookings: realized ? newBookPrefix[d] : null,

      cumulativeLastMonthRevenue: lastRev[d],
      cumulativeLastMonthBookings: lastBook[d],
      cumulativeAvgRevenue: avgRev[d],
      cumulativeAvgBookings: avgBook[d],

      cumulativeForecastRevenue: forecastRev[d],
      cumulativeForecastBookings: forecastBook[d],

      targetPaceRevenue:
        targetRevenue && targetRevenue > 0
          ? Math.round((targetRevenue / daysInMonth) * d)
          : null,
    });
  }

  const projectedEndRevenue =
    monthPosition === 'past'
      ? revPrefix[daysInMonth]
      : monthPosition === 'current'
      ? forecastRev[daysInMonth] ?? actualRevT
      : null;

  const projectedEndBookings =
    monthPosition === 'past'
      ? bookPrefix[daysInMonth]
      : monthPosition === 'current'
      ? forecastBook[daysInMonth] ?? actualBookT
      : null;

  const daysRemaining = Math.max(0, daysInMonth - asOfDay);

  const baseRevenue = projectedEndRevenue;
  const conservativeRevenue =
    monthPosition === 'past'
      ? projectedEndRevenue
      : monthPosition === 'current'
      ? Math.round(conservativeCumRev)
      : null;
  const optimisticRevenue =
    monthPosition === 'past'
      ? projectedEndRevenue
      : monthPosition === 'current'
      ? Math.round(optimisticCumRev)
      : null;

  const gapToTargetRevenue =
    targetRevenue != null && targetRevenue > 0 && baseRevenue != null
      ? Math.round(targetRevenue - baseRevenue)
      : null;

  const requiredDailyRevenue =
    targetRevenue != null && targetRevenue > 0 && monthPosition !== 'future'
      ? daysRemaining > 0
        ? Math.round(Math.max(0, targetRevenue - actualRevT) / daysRemaining)
        : 0
      : null;

  const requiredDailyBookings =
    targetBookings != null && targetBookings > 0 && monthPosition !== 'future'
      ? daysRemaining > 0
        ? Math.round((Math.max(0, targetBookings - actualBookT) / daysRemaining) * 10) / 10
        : 0
      : null;

  return {
    points,
    summary: {
      method,
      asOfDay,
      daysRemaining,
      pacingFactor: pacingRev,
      projectedEndRevenue,
      projectedEndBookings,
      scheduledFutureRevenue,
      revenueToDate: actualRevT,
      bookingsToDate: actualBookT,
      cancellationRate: Math.round(cancelRate * 1000) / 10,
      conservativeRevenue,
      baseRevenue,
      optimisticRevenue,
      gapToTargetRevenue,
      requiredDailyRevenue,
      requiredDailyBookings,
    },
  };
}

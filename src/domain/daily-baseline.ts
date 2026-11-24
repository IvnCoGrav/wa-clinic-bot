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

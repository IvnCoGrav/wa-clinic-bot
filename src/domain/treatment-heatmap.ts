import { DAY_NAMES_ID, WIB_OFFSET_MS, shiftWibMonth, wibMonthBoundsUtc } from '../utils/wib-time';

/**
 * Domain murni (tanpa DB/IO) untuk agregasi Treatment Heatmap.
 *
 * Metrik warna = JUMLAH reservasi `completed` saja; omzet & jumlah item hanya
 * informasi pendukung di tooltip. Modul ini sengaja tidak mengenal Prisma agar
 * perilaku agregasi bisa diuji tanpa database.
 */

export type HeatmapScope = 'weekly' | 'monthly' | 'multi';

export interface HeatmapHours {
  startHourWib: number;
  endHourWib: number;
}

export interface HeatmapReservationInput {
  id: string;
  bookingDate: Date | string | null;
  status: string;
  revenue: number;
  itemCount: number;
}

export interface HeatmapCellMetrics {
  count: number;
  revenue: number;
  itemCount: number;
}

export interface HeatmapHourlyCell extends HeatmapCellMetrics {
  /** 0 = Senin … 6 = Minggu. */
  dayIndex: number;
  /** Jam WIB 0–23, atau -1 untuk reservasi di luar jam operasional. */
  hour: number;
}

export interface HeatmapDayCell extends HeatmapCellMetrics {
  dateKey: string;
  dayOfMonth: number;
  /** 0 = Senin … 6 = Minggu. */
  dayIndex: number;
  dayName: string;
  isToday: boolean;
  isFuture: boolean;
}

export interface HeatmapWeekRow extends HeatmapCellMetrics {
  weekIndex: number;
  label: string;
  startDateKey: string;
  endDateKey: string;
  days: HeatmapDayCell[];
}

export interface HeatmapMonthSummary extends HeatmapCellMetrics {
  year: number;
  month: number;
  monthName: string;
  peakDay: { dateKey: string; count: number } | null;
  days: HeatmapDayCell[];
}

export interface HeatmapQuality {
  /** Reservasi completed valid-tanggal yang masuk agregasi. */
  totalCompleted: number;
  /** Reservasi completed tanpa `booking_date` (tidak bisa dipetakan ke jam). */
  missingBookingDate: number;
  /** Reservasi completed di luar jam operasional tenant. */
  outsideHoursCount: number;
  /** Jam WIB tepat 09:00:00.000 — indikasi booking tanpa jam eksplisit (jam default parser). */
  defaultedHourCount: number;
  /** Reservasi non-completed pada jendela periode (sengaja tidak diwarnai). */
  excludedNonCompleted: number;
}

export interface TreatmentHeatmapTotals extends HeatmapCellMetrics {}

export interface TreatmentHeatmapResponse {
  year: number;
  month: number;
  monthName: string;
  scope: HeatmapScope;
  generatedAt: string;
  metric: 'count';
  hours: HeatmapHours;
  /** Jam operasional yang ditampilkan (start s.d. end-1). */
  hourSlots: number[];
  maxCount: number;
  maxRevenue: number;
  totals: TreatmentHeatmapTotals;
  hourly?: HeatmapHourlyCell[];
  weeks?: HeatmapWeekRow[];
  days?: HeatmapDayCell[];
  months?: HeatmapMonthSummary[];
  quality: HeatmapQuality;
}

export interface BuildTreatmentHeatmapParams {
  year: number;
  month: number;
  scope: HeatmapScope;
  hours: HeatmapHours;
  /** Baris completed (sudah dihitung nilai tagihannya oleh service). */
  reservations: HeatmapReservationInput[];
  excludedNonCompleted?: number;
  /** Jendela bulan untuk scope multi (default 3, maksimum 12). */
  monthCount?: number;
  now?: Date;
}

interface Acc extends HeatmapCellMetrics {}

const MAX_MULTI_MONTHS = 12;

function emptyAcc(): Acc {
  return { count: 0, revenue: 0, itemCount: 0 };
}

function addTo(map: Map<string, Acc>, key: string, r: HeatmapReservationInput): void {
  const acc = map.get(key) || emptyAcc();
  acc.count += 1;
  acc.revenue += r.revenue;
  acc.itemCount += r.itemCount;
  map.set(key, acc);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toWib(date: Date): Date {
  return new Date(date.getTime() + WIB_OFFSET_MS);
}

function wibDateKey(wib: Date): string {
  return `${wib.getUTCFullYear()}-${pad2(wib.getUTCMonth() + 1)}-${pad2(wib.getUTCDate())}`;
}

/** Senin = 0 … Minggu = 6. */
function mondayIndex(wib: Date): number {
  return (wib.getUTCDay() + 6) % 7;
}

function shortDayName(dayIndex: number): string {
  return DAY_NAMES_ID[(dayIndex + 1) % 7].slice(0, 3);
}

function monthNameOf(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('id-ID', {
    month: 'long',
    timeZone: 'UTC',
  });
}

function shortMonthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('id-ID', {
    month: 'short',
    timeZone: 'UTC',
  });
}

function resolveHourSlots(hours: HeatmapHours): { slots: number[]; start: number; end: number } {
  const start = Number.isInteger(hours?.startHourWib) ? Math.min(23, Math.max(0, hours.startHourWib)) : 8;
  let end = Number.isInteger(hours?.endHourWib) ? Math.min(24, Math.max(0, hours.endHourWib)) : 17;
  if (end <= start) end = Math.min(24, start + 1);
  const slots: number[] = [];
  for (let h = start; h < end; h++) slots.push(h);
  return { slots, start, end };
}

function buildDayCells(
  year: number,
  month: number,
  daysInMonth: number,
  dayAcc: Map<string, Acc>,
  todayKey: string
): HeatmapDayCell[] {
  const cells: HeatmapDayCell[] = [];
  const firstWib = new Date(Date.UTC(year, month - 1, 1));
  const firstDayIndex = mondayIndex(firstWib);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${pad2(month)}-${pad2(d)}`;
    const acc = dayAcc.get(dateKey) || emptyAcc();
    const dayIndex = (firstDayIndex + d - 1) % 7;
    cells.push({
      dateKey,
      dayOfMonth: d,
      dayIndex,
      dayName: shortDayName(dayIndex),
      isToday: dateKey === todayKey,
      isFuture: dateKey > todayKey,
      count: acc.count,
      revenue: acc.revenue,
      itemCount: acc.itemCount,
    });
  }
  return cells;
}

function buildWeeks(
  year: number,
  month: number,
  days: HeatmapDayCell[]
): HeatmapWeekRow[] {
  const weeks = new Map<number, HeatmapWeekRow>();
  for (const day of days) {
    const weekIndex = Math.floor((day.dayOfMonth - 1 + days[0].dayIndex) / 7) + 1;
    let row = weeks.get(weekIndex);
    if (!row) {
      row = {
        weekIndex,
        label: '',
        startDateKey: day.dateKey,
        endDateKey: day.dateKey,
        count: 0,
        revenue: 0,
        itemCount: 0,
        days: [],
      };
      weeks.set(weekIndex, row);
    }
    row.days.push(day);
    row.startDateKey = day.dateKey;
    row.endDateKey = day.dateKey;
    row.count += day.count;
    row.revenue += day.revenue;
    row.itemCount += day.itemCount;
  }

  const monthShort = shortMonthName(year, month);
  return Array.from(weeks.values())
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .map((row) => {
      const first = row.days[0]?.dayOfMonth;
      const last = row.days[row.days.length - 1]?.dayOfMonth;
      const range = first === last ? `${first} ${monthShort}` : `${first}–${last} ${monthShort}`;
      return { ...row, label: `Pekan ${row.weekIndex} (${range})` };
    });
}

function maxOf(cells: Array<{ count: number; revenue: number }>): { maxCount: number; maxRevenue: number } {
  let maxCount = 0;
  let maxRevenue = 0;
  for (const c of cells) {
    if (c.count > maxCount) maxCount = c.count;
    if (c.revenue > maxRevenue) maxRevenue = c.revenue;
  }
  return { maxCount, maxRevenue };
}

/**
 * Bangun seluruh struktur heatmap dari baris reservasi completed.
 * Deterministik: input sama (termasuk `now`) → output sama.
 */
export function buildTreatmentHeatmap(params: BuildTreatmentHeatmapParams): TreatmentHeatmapResponse {
  const { year, month, scope, hours } = params;
  const reservations = params.reservations || [];
  const now = params.now || new Date();
  const todayKey = wibDateKey(toWib(now));

  const hoursSafe: HeatmapHours = {
    startHourWib: Number.isInteger(hours?.startHourWib) ? hours.startHourWib : 8,
    endHourWib: Number.isInteger(hours?.endHourWib) ? hours.endHourWib : 17,
  };
  const { slots, start, end } = resolveHourSlots(hoursSafe);

  const requestedMonths = Number(params.monthCount);
  const multiCount = Math.min(
    MAX_MULTI_MONTHS,
    Math.max(1, Math.floor(Number.isFinite(requestedMonths) ? requestedMonths : 3))
  );
  const windowMonths: Array<{ year: number; month: number; daysInMonth: number }> = [];
  if (scope === 'multi') {
    for (let i = multiCount - 1; i >= 0; i--) {
      const ym = shiftWibMonth(year, month, -i);
      const bounds = wibMonthBoundsUtc(ym.year, ym.month);
      if (bounds) windowMonths.push({ ...ym, daysInMonth: bounds.daysInMonth });
    }
  } else {
    const bounds = wibMonthBoundsUtc(year, month);
    windowMonths.push({ year, month, daysInMonth: bounds?.daysInMonth || 30 });
  }

  const allowedMonthKeys = new Set(windowMonths.map((m) => `${m.year}-${pad2(m.month)}`));

  const quality: HeatmapQuality = {
    totalCompleted: 0,
    missingBookingDate: 0,
    outsideHoursCount: 0,
    defaultedHourCount: 0,
    excludedNonCompleted: Math.max(0, params.excludedNonCompleted || 0),
  };
  const totals = emptyAcc();

  // Akumulator: per tanggal, per (hari, jam), per bulan.
  const dayAcc = new Map<string, Acc>();
  const hourAcc = new Map<string, Acc>(); // key: `${dayIndex}-${hour|-1}`
  const monthAcc = new Map<string, Acc>(); // key: `YYYY-MM`

  for (const r of reservations) {
    if (!r.bookingDate) {
      quality.missingBookingDate += 1;
      continue;
    }
    const raw = r.bookingDate instanceof Date ? r.bookingDate : new Date(r.bookingDate);
    if (isNaN(raw.getTime())) {
      quality.missingBookingDate += 1;
      continue;
    }

    const wib = toWib(raw);
    const dateKey = wibDateKey(wib);
    const monthKey = `${wib.getUTCFullYear()}-${pad2(wib.getUTCMonth() + 1)}`;
    if (!allowedMonthKeys.has(monthKey)) continue;

    const hour = wib.getUTCHours();
    const minutes = wib.getUTCMinutes();
    const seconds = wib.getUTCSeconds();
    const ms = wib.getUTCMilliseconds();
    const isOutside = hour < start || hour >= end;

    quality.totalCompleted += 1;
    if (isOutside) quality.outsideHoursCount += 1;
    if (hour === 9 && minutes === 0 && seconds === 0 && ms === 0) quality.defaultedHourCount += 1;

    totals.count += 1;
    totals.revenue += r.revenue;
    totals.itemCount += r.itemCount;

    addTo(dayAcc, dateKey, r);
    addTo(monthAcc, monthKey, r);
    addTo(hourAcc, `${mondayIndex(wib)}-${isOutside ? -1 : hour}`, r);
  }

  const monthName = monthNameOf(year, month);
  const base: TreatmentHeatmapResponse = {
    year,
    month,
    monthName,
    scope,
    generatedAt: now.toISOString(),
    metric: 'count',
    hours: hoursSafe,
    hourSlots: slots,
    maxCount: 0,
    maxRevenue: 0,
    totals,
    quality,
  };

  if (scope === 'weekly') {
    const hourly: HeatmapHourlyCell[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      for (const hour of [...slots, -1]) {
        const acc = hourAcc.get(`${dayIndex}-${hour}`) || emptyAcc();
        hourly.push({ dayIndex, hour, ...acc });
      }
    }
    const { maxCount, maxRevenue } = maxOf(hourly);
    const selected = windowMonths[0];
    const days = buildDayCells(selected.year, selected.month, selected.daysInMonth, dayAcc, todayKey);
    return { ...base, hourly, weeks: buildWeeks(selected.year, selected.month, days), maxCount, maxRevenue };
  }

  if (scope === 'monthly') {
    const selected = windowMonths[0];
    const days = buildDayCells(selected.year, selected.month, selected.daysInMonth, dayAcc, todayKey);
    const { maxCount, maxRevenue } = maxOf(days);
    return { ...base, days, maxCount, maxRevenue };
  }

  const months: HeatmapMonthSummary[] = windowMonths.map((m) => {
    const key = `${m.year}-${pad2(m.month)}`;
    const acc = monthAcc.get(key) || emptyAcc();
    const days = buildDayCells(m.year, m.month, m.daysInMonth, dayAcc, todayKey);
    const peak = days.reduce<HeatmapDayCell | null>(
      (best, d) => (d.count > 0 && (!best || d.count > best.count) ? d : best),
      null
    );
    return {
      year: m.year,
      month: m.month,
      monthName: monthNameOf(m.year, m.month),
      count: acc.count,
      revenue: acc.revenue,
      itemCount: acc.itemCount,
      peakDay: peak ? { dateKey: peak.dateKey, count: peak.count } : null,
      days,
    };
  });

  const allDays = months.flatMap((m) => m.days);
  const { maxCount, maxRevenue } = maxOf(allDays);
  return { ...base, months, maxCount, maxRevenue };
}

import { describe, it, expect } from 'vitest';
import {
  computeCumulativeAndForecast,
  buildDailyBaseline,
  type CumulativeTrendInputPoint,
  type DailyBaselineResult,
} from '../../src/domain/daily-baseline';
import { DEFAULT_ANALYTICS_BASELINE_SETTINGS } from '../../src/config/analytics-baseline';

function createMockDailyPoints(daysInMonth: number, customDaily: Record<number, Partial<CumulativeTrendInputPoint>> = {}): CumulativeTrendInputPoint[] {
  const points: CumulativeTrendInputPoint[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const override = customDaily[d] || {};
    points.push({
      day: d,
      dateStr: `2026-11-${String(d).padStart(2, '0')}`,
      dayName: 'Rab',
      isPastOrToday: d <= 15,
      revenue: override.revenue ?? 100000,
      bookingsCount: override.bookingsCount ?? 1,
      repeatRevenue: override.repeatRevenue ?? 40000,
      newRevenue: override.newRevenue ?? 60000,
      repeatBookings: override.repeatBookings ?? 0.4,
      newBookings: override.newBookings ?? 0.6,
      ...override,
    });
  }
  return points;
}

function createMockBaseline(available = true, prevDays = 30): DailyBaselineResult {
  const byDay = new Map();
  const prevByDay = new Map();

  for (let d = 1; d <= 31; d++) {
    byDay.set(d, {
      day: d,
      avg6mRevenue: available ? 120000 : null,
      avg6mBookings: available ? 1.2 : null,
      samples: available ? 6 : 0,
    });
  }

  for (let d = 1; d <= prevDays; d++) {
    prevByDay.set(d, {
      revenue: 90000,
      bookings: 1,
    });
  }

  return {
    available,
    reason: available ? undefined : 'INSUFFICIENT_HISTORY',
    mode: 'weekday',
    smoothingWindowDays: 0,
    monthsRequested: 6,
    monthsUsed: available ? 6 : 1,
    windowStart: { year: 2026, month: 5 },
    windowEnd: { year: 2026, month: 10 },
    byDay,
    previousMonth: {
      year: 2026,
      month: 10,
      daysInMonth: prevDays,
      byDay: prevByDay,
    },
  };
}

describe('computeCumulativeAndForecast - Domain Engine Murni (Fase 1)', () => {
  it('1. 10 hari realisasi -> cumulativeRevenue monoton naik', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline = createMockBaseline();

    const { points } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 10 },
    });

    for (let d = 1; d <= 10; d++) {
      expect(points[d - 1].cumulativeRevenue).not.toBeNull();
      if (d > 1) {
        expect(points[d - 1].cumulativeRevenue!).toBeGreaterThanOrEqual(points[d - 2].cumulativeRevenue!);
      }
    }
  });

  it('2. Anchor mulus: cumulativeForecastRevenue[T] === cumulativeRevenue[T]', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline = createMockBaseline();

    const { points } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 15 },
    });

    const day15 = points[14]; // hari ke-15
    expect(day15.cumulativeRevenue).toBe(1500000);
    expect(day15.cumulativeForecastRevenue).toBe(day15.cumulativeRevenue);
  });

  it('3. Lantai komitmen: projectedEndRevenue >= total booked s/d akhir bulan', () => {
    // Hari 16..30 memiliki booking terjadwal sangat besar
    const dailyPoints = createMockDailyPoints(30, {
      20: { revenue: 5000000, bookingsCount: 10 },
    });
    const baseline = createMockBaseline();

    const { summary } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 15 },
    });

    expect(summary.projectedEndRevenue).toBeGreaterThanOrEqual(15 * 100000 + 5000000);
  });

  it('4. Baseline 3 vs 6 vs 12: cumulativeAvgRevenue berbeda sesuai baseline yang disuplai', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline3 = createMockBaseline();
    baseline3.byDay.forEach((v) => { v.avg6mRevenue = 100000; });
    const baseline12 = createMockBaseline();
    baseline12.byDay.forEach((v) => { v.avg6mRevenue = 200000; });

    const res3 = computeCumulativeAndForecast({
      dailyPoints,
      baseline: baseline3,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 15 },
    });
    const res12 = computeCumulativeAndForecast({
      dailyPoints,
      baseline: baseline12,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 15 },
    });

    expect(res3.points[14].cumulativeAvgRevenue).toBe(15 * 100000);
    expect(res12.points[14].cumulativeAvgRevenue).toBe(15 * 200000);
  });

  it('5. New + Repeat: cumNew + cumRepeat === cumActual pada setiap titik realisasi', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline = createMockBaseline();

    const { points } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 12 },
    });

    for (let d = 1; d <= 12; d++) {
      const p = points[d - 1];
      expect(p.cumulativeRevenue).toBe(p.cumulativeNewRevenue! + p.cumulativeRepeatRevenue!);
      expect(p.cumulativeBookings).toBeCloseTo(p.cumulativeNewBookings! + p.cumulativeRepeatBookings!, 1);
    }
  });

  it('6. Bulan lalu 28 hari, bulan ini 31: cumLast null setelah hari ke-28', () => {
    const dailyPoints = createMockDailyPoints(31);
    const baseline = createMockBaseline(true, 28); // Feb 28 hari

    const { points } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 31,
      context: { monthPosition: 'current', asOfDay: 10 },
    });

    expect(points[27].cumulativeLastMonthRevenue).not.toBeNull(); // hari 28
    expect(points[28].cumulativeLastMonthRevenue).toBeNull(); // hari 29
    expect(points[29].cumulativeLastMonthRevenue).toBeNull(); // hari 30
    expect(points[30].cumulativeLastMonthRevenue).toBeNull(); // hari 31
  });

  it('7. Baseline unavailable: cumAvg null semua titik', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline = createMockBaseline(false);

    const { points } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 10 },
    });

    for (const p of points) {
      expect(p.cumulativeAvgRevenue).toBeNull();
      expect(p.cumulativeAvgBookings).toBeNull();
    }
  });

  it('8. Bulan historis: cumForecast null, method=HISTORICAL', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline = createMockBaseline();

    const { points, summary } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'past', asOfDay: 30 },
    });

    expect(summary.method).toBe('HISTORICAL');
    for (const p of points) {
      expect(p.cumulativeForecastRevenue).toBeNull();
      expect(p.isForecast).toBe(false);
      expect(p.isPastOrToday).toBe(true);
    }
    expect(summary.projectedEndRevenue).toBe(points[29].cumulativeRevenue);
  });

  it('9. Bulan masa depan: cumActual null, method=NOT_APPLICABLE', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline = createMockBaseline();

    const { points, summary } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'future', asOfDay: 0 },
    });

    expect(summary.method).toBe('NOT_APPLICABLE');
    for (const p of points) {
      expect(p.cumulativeRevenue).toBeNull();
      expect(p.isPastOrToday).toBe(false);
    }
  });

  it('10. Hari 1 belum ada booking: method=BASELINE_ONLY, pacingFactor=1', () => {
    const dailyPoints = createMockDailyPoints(30, {
      1: { revenue: 0, bookingsCount: 0, repeatRevenue: 0, newRevenue: 0 },
    });
    const baseline = createMockBaseline();

    const { summary } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 1 },
    });

    expect(summary.method).toBe('BASELINE_ONLY');
    expect(summary.pacingFactor).toBe(1);
  });

  it('11. Booking terjadwal > baseline: proyeksi memakai booking riil', () => {
    const dailyPoints = createMockDailyPoints(30, {
      20: { revenue: 1000000 }, // baseline hanya 120000
    });
    const baseline = createMockBaseline();

    const { points } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 19 },
    });

    // Pertambahan dari hari 19 ke 20 minimal 1.000.000
    const diff = points[19].cumulativeForecastRevenue! - points[18].cumulativeForecastRevenue!;
    expect(diff).toBeGreaterThanOrEqual(1000000);
  });

  it('12. Bulan lalu kosong: cumLast null semua (bukan 0)', () => {
    const dailyPoints = createMockDailyPoints(30);
    const baseline = createMockBaseline();
    baseline.previousMonth.byDay.clear(); // tidak ada reservasi bulan lalu

    const { points } = computeCumulativeAndForecast({
      dailyPoints,
      baseline,
      daysInMonth: 30,
      context: { monthPosition: 'current', asOfDay: 15 },
    });

    for (const p of points) {
      expect(p.cumulativeLastMonthRevenue).toBeNull();
      expect(p.cumulativeLastMonthBookings).toBeNull();
    }
  });
});

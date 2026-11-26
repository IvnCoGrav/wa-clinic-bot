import { describe, it, expect } from 'vitest';
import {
  pickNumber,
  hasChartData,
  formatRupiah,
  mapCumulativeTrendToChart,
} from '../../packages/admin-dashboard/src/lib/dashboard-metrics';

describe('dashboard-metrics helper (audit anti-slop)', () => {
  describe('pickNumber', () => {
    it('returns number when input is a valid finite number', () => {
      expect(pickNumber(42)).toBe(42);
      expect(pickNumber(0)).toBe(0);
      expect(pickNumber(-10)).toBe(-10);
    });

    it('returns fallback when input is null, undefined, NaN, or non-number', () => {
      expect(pickNumber(null)).toBeNull();
      expect(pickNumber(undefined)).toBeNull();
      expect(pickNumber(NaN)).toBeNull();
      expect(pickNumber(Infinity)).toBeNull();
      expect(pickNumber('142' as any, 0)).toBe(0);
    });
  });

  describe('hasChartData', () => {
    it('returns false for empty or all-zero arrays', () => {
      expect(hasChartData([])).toBe(false);
      expect(hasChartData([{ revenue: 0, bookings: 0 }])).toBe(false);
      expect(hasChartData([{ revenue: 0 }, { bookings: 0 }])).toBe(false);
    });

    it('returns true if any item has positive revenue or bookings', () => {
      expect(hasChartData([{ revenue: 100000, bookings: 0 }])).toBe(true);
      expect(hasChartData([{ revenue: 0, bookings: 2 }])).toBe(true);
    });
  });

  describe('formatRupiah', () => {
    it('formats valid numbers with IDR currency style', () => {
      const res = formatRupiah(3600000);
      expect(res).toContain('3.600.000');
    });

    it('memakai tanda hubung untuk null, undefined, atau NaN', () => {
      expect(formatRupiah(null)).toBe('-');
      expect(formatRupiah(undefined)).toBe('-');
      expect(formatRupiah(NaN)).toBe('-');
    });
  });

  describe('mapCumulativeTrendToChart (Fase 3)', () => {
    it('returns empty array for non-array inputs', () => {
      expect(mapCumulativeTrendToChart(null as any)).toEqual([]);
      expect(mapCumulativeTrendToChart(undefined as any)).toEqual([]);
      expect(mapCumulativeTrendToChart('not-array' as any)).toEqual([]);
    });

    it('maps valid points, handling nulls and NaNs gracefully', () => {
      const input = [
        {
          day: 1,
          dateStr: '2026-11-01',
          dayName: 'Min',
          isPastOrToday: true,
          isForecast: false,
          scheduledRevenue: 0,
          cumulativeRevenue: 150000,
          cumulativeRepeatRevenue: 50000,
          cumulativeNewRevenue: 100000,
          cumulativeBookings: 1,
          cumulativeRepeatBookings: 0.3,
          cumulativeNewBookings: 0.7,
          cumulativeLastMonthRevenue: 120000,
          cumulativeLastMonthBookings: 1,
          cumulativeAvgRevenue: 130000,
          cumulativeAvgBookings: 1.1,
          cumulativeForecastRevenue: null,
          cumulativeForecastBookings: null,
        },
        {
          day: 2,
          dateStr: '2026-11-02',
          dayName: 'Sen',
          isPastOrToday: false,
          isForecast: true,
          scheduledRevenue: 200000,
          cumulativeRevenue: null,
          cumulativeRepeatRevenue: null,
          cumulativeNewRevenue: null,
          cumulativeBookings: null,
          cumulativeRepeatBookings: null,
          cumulativeNewBookings: null,
          cumulativeLastMonthRevenue: null,
          cumulativeLastMonthBookings: null,
          cumulativeAvgRevenue: 260000,
          cumulativeAvgBookings: 2.2,
          cumulativeForecastRevenue: 300000,
          cumulativeForecastBookings: 2.5,
        },
      ];

      const res = mapCumulativeTrendToChart(input);
      expect(res.length).toBe(2);

      expect(res[0].name).toBe('1');
      expect(res[0].hasHappened).toBe(true);
      expect(res[0].isForecast).toBe(false);
      expect(res[0].cumulativeRevenue).toBe(150000);
      expect(res[0].cumulativeForecastRevenue).toBeNull();

      expect(res[1].name).toBe('2');
      expect(res[1].hasHappened).toBe(false);
      expect(res[1].isForecast).toBe(true);
      expect(res[1].cumulativeRevenue).toBeNull();
      expect(res[1].cumulativeForecastRevenue).toBe(300000);
      expect(res[1].scheduledRevenue).toBe(200000);
    });
  });
});

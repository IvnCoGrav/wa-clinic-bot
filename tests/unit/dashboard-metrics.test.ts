import { describe, it, expect } from 'vitest';
import { pickNumber, hasChartData, formatRupiah } from '../../packages/admin-dashboard/src/lib/dashboard-metrics';

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

    it('returns em-dash for null, undefined, or NaN', () => {
      expect(formatRupiah(null)).toBe('—');
      expect(formatRupiah(undefined)).toBe('—');
      expect(formatRupiah(NaN)).toBe('—');
    });
  });
});

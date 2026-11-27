import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REVENUE_QUERY,
  isRevenueStatusIncluded,
  describeRevenueBasis,
  buildRevenueBasisMeta,
  type RevenueQuery,
} from '../../src/domain/analytics-contract';

describe('Analytics Domain Contract (Fase 1)', () => {
  describe('DEFAULT_REVENUE_QUERY', () => {
    it('memiliki konfigurasi default kanonis yang tepat', () => {
      expect(DEFAULT_REVENUE_QUERY).toEqual({
        basis: 'booking_date',
        statusFilter: 'all_non_cancelled',
        includeDeliveryFee: true,
        includePending: true,
        includeUpcoming: true,
      });
    });
  });

  describe('isRevenueStatusIncluded', () => {
    it('selalu menolak status cancelled dan rejected pada semua filter', () => {
      const filters = [
        'all_non_cancelled',
        'completed_only',
        'confirmed_and_completed',
        'confirmed_only',
      ] as const;

      for (const filter of filters) {
        expect(isRevenueStatusIncluded('cancelled', filter)).toBe(false);
        expect(isRevenueStatusIncluded('CANCELLED', filter)).toBe(false);
        expect(isRevenueStatusIncluded('rejected', filter)).toBe(false);
        expect(isRevenueStatusIncluded('REJECTED', filter)).toBe(false);
        expect(isRevenueStatusIncluded(' cancelled ', filter)).toBe(false);
      }
    });

    it('mendukung filter completed_only', () => {
      expect(isRevenueStatusIncluded('completed', 'completed_only')).toBe(true);
      expect(isRevenueStatusIncluded('COMPLETED', 'completed_only')).toBe(true);
      expect(isRevenueStatusIncluded('confirmed', 'completed_only')).toBe(false);
      expect(isRevenueStatusIncluded('pending', 'completed_only')).toBe(false);
      expect(isRevenueStatusIncluded('en_route', 'completed_only')).toBe(false);
    });

    it('mendukung filter confirmed_and_completed', () => {
      expect(isRevenueStatusIncluded('completed', 'confirmed_and_completed')).toBe(true);
      expect(isRevenueStatusIncluded('confirmed', 'confirmed_and_completed')).toBe(true);
      expect(isRevenueStatusIncluded('CONFIRMED', 'confirmed_and_completed')).toBe(true);
      expect(isRevenueStatusIncluded('pending', 'confirmed_and_completed')).toBe(false);
      expect(isRevenueStatusIncluded('en_route', 'confirmed_and_completed')).toBe(false);
    });

    it('mendukung filter confirmed_only', () => {
      expect(isRevenueStatusIncluded('confirmed', 'confirmed_only')).toBe(true);
      expect(isRevenueStatusIncluded('completed', 'confirmed_only')).toBe(false);
      expect(isRevenueStatusIncluded('pending', 'confirmed_only')).toBe(false);
    });

    it('mendukung filter all_non_cancelled', () => {
      expect(isRevenueStatusIncluded('confirmed', 'all_non_cancelled')).toBe(true);
      expect(isRevenueStatusIncluded('completed', 'all_non_cancelled')).toBe(true);
      expect(isRevenueStatusIncluded('en_route', 'all_non_cancelled')).toBe(true);
      expect(isRevenueStatusIncluded('arrived', 'all_non_cancelled')).toBe(true);
      expect(isRevenueStatusIncluded('pending', 'all_non_cancelled')).toBe(true);
      expect(isRevenueStatusIncluded('', 'all_non_cancelled')).toBe(true);
      expect(isRevenueStatusIncluded(null, 'all_non_cancelled')).toBe(true);
      expect(isRevenueStatusIncluded(undefined, 'all_non_cancelled')).toBe(true);
    });
  });

  describe('describeRevenueBasis & buildRevenueBasisMeta', () => {
    it('menghasilkan deskripsi lengkap untuk query default', () => {
      const desc = describeRevenueBasis(DEFAULT_REVENUE_QUERY);
      expect(desc).toBe(
        'Basis tanggal treatment; semua non-cancelled; termasuk tagihan; termasuk jadwal mendatang; termasuk ongkir'
      );
    });

    it('menghasilkan deskripsi yang sesuai saat basis created_at dan tanpa ongkir/pending/upcoming', () => {
      const query: RevenueQuery = {
        basis: 'created_at',
        statusFilter: 'completed_only',
        includeDeliveryFee: false,
        includePending: false,
        includeUpcoming: false,
      };
      const desc = describeRevenueBasis(query);
      expect(desc).toBe(
        'Basis tanggal booking dibuat; hanya selesai; hanya lunas; tanpa jadwal mendatang; tanpa ongkir'
      );
    });

    it('buildRevenueBasisMeta menyertakan discountApplied dan label', () => {
      const meta = buildRevenueBasisMeta(DEFAULT_REVENUE_QUERY);
      expect(meta.discountApplied).toBe(true);
      expect(meta.basis).toBe('booking_date');
      expect(meta.statusFilter).toBe('all_non_cancelled');
      expect(meta.label).toBe(
        'Basis tanggal treatment; semua non-cancelled; termasuk tagihan; termasuk jadwal mendatang; termasuk ongkir'
      );
    });
  });
});

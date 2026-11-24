import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_ANALYTICS_BASELINE_SETTINGS,
  normalizeAnalyticsBaselineSettings,
  getAnalyticsBaselineSettings,
  clearAnalyticsBaselineSettingsCache,
} from '../../src/config/analytics-baseline';
import { prisma } from '../../src/db/client';

describe('Analytics Baseline Settings (Fase 1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAnalyticsBaselineSettingsCache();
  });

  describe('normalizeAnalyticsBaselineSettings', () => {
    it('normalizes valid input correctly', () => {
      const res = normalizeAnalyticsBaselineSettings({
        months: '9',
        mode: 'calendar',
        smoothingWindowDays: 7,
        minMonths: 4,
      });

      expect(res).toEqual({
        months: 9,
        mode: 'calendar',
        smoothingWindowDays: 7,
        minMonths: 4,
      });
    });

    it('falls back to defaults on invalid months, mode, and smoothing values', () => {
      expect(
        normalizeAnalyticsBaselineSettings({
          months: 0,
          mode: 'invalid_mode',
          smoothingWindowDays: 4, // 4 tidak diizinkan (hanya 0, 3, 5, 7)
          minMonths: 0,
        })
      ).toEqual({
        months: 6,
        mode: 'weekday',
        smoothingWindowDays: 0,
        minMonths: 3,
      });

      expect(
        normalizeAnalyticsBaselineSettings({
          months: 13,
          mode: 'x',
          smoothingWindowDays: 'abc',
        })
      ).toEqual({
        months: 6,
        mode: 'weekday',
        smoothingWindowDays: 0,
        minMonths: 3,
      });
    });

    it('forces smoothingWindowDays to 0 if mode is weekday', () => {
      const res = normalizeAnalyticsBaselineSettings({
        months: 6,
        mode: 'weekday',
        smoothingWindowDays: 7,
      });

      expect(res.mode).toBe('weekday');
      expect(res.smoothingWindowDays).toBe(0);
    });

    it('caps minMonths if minMonths exceeds months', () => {
      const res = normalizeAnalyticsBaselineSettings({
        months: 2,
        minMonths: 5,
      });

      expect(res.months).toBe(2);
      expect(res.minMonths).toBe(2);
    });
  });

  describe('getAnalyticsBaselineSettings', () => {
    it('returns default settings when DB returns no override', async () => {
      vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValueOnce({
        settings: {},
      });

      const settings = await getAnalyticsBaselineSettings('tenant-a');
      expect(settings).toEqual(DEFAULT_ANALYTICS_BASELINE_SETTINGS);
    });

    it('returns custom settings when DB provides tenant override', async () => {
      vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValueOnce({
        settings: {
          analyticsBaseline: {
            months: 8,
            mode: 'calendar',
            smoothingWindowDays: 5,
            minMonths: 4,
          },
        },
      });

      const settings = await getAnalyticsBaselineSettings('tenant-custom');
      expect(settings).toEqual({
        months: 8,
        mode: 'calendar',
        smoothingWindowDays: 5,
        minMonths: 4,
      });

      // Verifikasi cache hit (findUnique tidak dipanggil lagi)
      const cached = await getAnalyticsBaselineSettings('tenant-custom');
      expect(cached).toEqual(settings);
      expect((prisma as any).tenant.findUnique).toHaveBeenCalledTimes(1);
    });

    it('gracefully falls back to default settings when DB rejects/throws', async () => {
      vi.spyOn((prisma as any).tenant, 'findUnique').mockRejectedValueOnce(
        new Error('Database offline connection failed')
      );

      const settings = await getAnalyticsBaselineSettings('tenant-error');
      expect(settings).toEqual(DEFAULT_ANALYTICS_BASELINE_SETTINGS);
    });
  });
});

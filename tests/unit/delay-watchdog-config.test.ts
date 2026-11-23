import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  getDelayWatchdogSettings,
  clearDelayWatchdogCache,
  DEFAULT_DELAY_WATCHDOG_SETTINGS,
} from '../../src/config/delay-watchdog-config';
import {
  parseTenantSettingsPatch,
  applyTenantSettingsPatch,
} from '../../src/config/tenant-settings.config';

describe('DelayWatchdogConfig & TenantSettings', () => {
  const tenantId = 'tenant-watchdog-test';

  beforeEach(() => {
    vi.restoreAllMocks();
    clearDelayWatchdogCache();
  });

  describe('getDelayWatchdogSettings', () => {
    it('mengembalikan default jika DB offline / melempar error', async () => {
      vi.spyOn(prisma.tenant as any, 'findUnique').mockRejectedValue(new Error('Database offline'));

      const settings = await getDelayWatchdogSettings(tenantId);
      expect(settings).toEqual(DEFAULT_DELAY_WATCHDOG_SETTINGS);
      expect(settings.toleranceMinutes).toBe(30);
      expect(settings.criticalExtraMinutes).toBe(15);
      expect(settings.maxPrevOriginGapHours).toBe(3);
      expect(settings.adminRecipients).toEqual([]);
    });

    it('mengambil override dari Tenant.settings saat tersedia', async () => {
      vi.spyOn(prisma.tenant as any, 'findUnique').mockResolvedValue({
        id: tenantId,
        settings: {
          delayWatchdog: {
            toleranceMinutes: 20,
            criticalExtraMinutes: 10,
            maxPrevOriginGapHours: 4,
            adminRecipients: ['081234567890', '628987654321'],
          },
        },
      });

      const settings = await getDelayWatchdogSettings(tenantId);
      expect(settings.toleranceMinutes).toBe(20);
      expect(settings.criticalExtraMinutes).toBe(10);
      expect(settings.maxPrevOriginGapHours).toBe(4);
      expect(settings.adminRecipients).toEqual(['6281234567890', '628987654321']);
    });

    it('presedensi: jika Tenant.settings kosong, membaca StaffScorecardPolicy.tolerance_minutes', async () => {
      vi.spyOn(prisma.tenant as any, 'findUnique').mockResolvedValue({
        id: tenantId,
        settings: {},
      });
      vi.spyOn((prisma as any).staffScorecardPolicy, 'findFirst').mockResolvedValue({
        tolerance_minutes: 25,
      });

      const settings = await getDelayWatchdogSettings(tenantId);
      expect(settings.toleranceMinutes).toBe(25);
      expect(settings.criticalExtraMinutes).toBe(15); // default
      expect(settings.maxPrevOriginGapHours).toBe(3); // default
      expect(settings.adminRecipients).toEqual([]);
    });

    it('presedensi: Tenant.settings mengalahkan StaffScorecardPolicy', async () => {
      vi.spyOn(prisma.tenant as any, 'findUnique').mockResolvedValue({
        id: tenantId,
        settings: {
          delayWatchdog: {
            toleranceMinutes: 40,
          },
        },
      });
      const policySpy = vi.spyOn((prisma as any).staffScorecardPolicy, 'findFirst');

      const settings = await getDelayWatchdogSettings(tenantId);
      expect(settings.toleranceMinutes).toBe(40);
      expect(policySpy).not.toHaveBeenCalled();
    });

    it('cache berfungsi dalam TTL 5 menit dan terhapus lewat clearDelayWatchdogCache', async () => {
      const tenantSpy = vi.spyOn(prisma.tenant as any, 'findUnique').mockResolvedValue({
        id: tenantId,
        settings: { delayWatchdog: { toleranceMinutes: 35 } },
      });

      const first = await getDelayWatchdogSettings(tenantId);
      expect(first.toleranceMinutes).toBe(35);
      expect(tenantSpy).toHaveBeenCalledTimes(1);

      // Panggilan kedua membaca dari cache
      const second = await getDelayWatchdogSettings(tenantId);
      expect(second.toleranceMinutes).toBe(35);
      expect(tenantSpy).toHaveBeenCalledTimes(1);

      // Bersihkan cache
      clearDelayWatchdogCache(tenantId);
      await getDelayWatchdogSettings(tenantId);
      expect(tenantSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('parseTenantSettingsPatch — delayWatchdog validation', () => {
    it('menerima payload patch valid dan menormalisasi nomor HP admin', () => {
      const res = parseTenantSettingsPatch({
        delayWatchdog: {
          toleranceMinutes: 30,
          criticalExtraMinutes: 15,
          maxPrevOriginGapHours: 2,
          adminRecipients: ['08123456789', '628198765432'],
        },
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.delayWatchdog).toEqual({
          toleranceMinutes: 30,
          criticalExtraMinutes: 15,
          maxPrevOriginGapHours: 2,
          adminRecipients: ['628123456789', '628198765432'],
        });
      }
    });

    it('menolak kunci tidak dikenal di delayWatchdog', () => {
      const res = parseTenantSettingsPatch({
        delayWatchdog: {
          toleranceMinutes: 30,
          unknownKey: 'invalid',
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.some((e) => e.includes('delayWatchdog.unknownKey'))).toBe(true);
      }
    });

    it('menolak nilai di luar rentang aman', () => {
      const res = parseTenantSettingsPatch({
        delayWatchdog: {
          toleranceMinutes: 0, // min 1
          criticalExtraMinutes: 150, // max 120
          maxPrevOriginGapHours: 15, // max 12
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.some((e) => e.includes('toleranceMinutes'))).toBe(true);
        expect(res.errors.some((e) => e.includes('criticalExtraMinutes'))).toBe(true);
        expect(res.errors.some((e) => e.includes('maxPrevOriginGapHours'))).toBe(true);
      }
    });

    it('menolak nomor admin tidak valid', () => {
      const res = parseTenantSettingsPatch({
        delayWatchdog: {
          adminRecipients: ['bukan_nomor', '123'],
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.some((e) => e.includes('nomor') && e.includes('tidak valid'))).toBe(true);
      }
    });

    it('menolak jika adminRecipients melebihi 5 nomor', () => {
      const res = parseTenantSettingsPatch({
        delayWatchdog: {
          adminRecipients: [
            '08111111111',
            '08222222222',
            '08333333333',
            '08444444444',
            '08555555555',
            '08666666666',
          ],
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.some((e) => e.includes('maksimal 5 nomor'))).toBe(true);
      }
    });
  });

  describe('applyTenantSettingsPatch — delayWatchdog merge', () => {
    it('menggabungkan setelan delayWatchdog tanpa merusak bagian lain', () => {
      const current = {
        clinicLocation: { lat: -7.25, lng: 112.75, name: 'Klinik A' },
        delayWatchdog: { toleranceMinutes: 30, adminRecipients: ['62811111111'] },
      };

      const patched = applyTenantSettingsPatch(current, {
        delayWatchdog: { toleranceMinutes: 45 },
      });

      expect(patched.clinicLocation).toEqual(current.clinicLocation);
      expect(patched.delayWatchdog.toleranceMinutes).toBe(45);
      expect(patched.delayWatchdog.adminRecipients).toEqual(['62811111111']);
    });
  });
});

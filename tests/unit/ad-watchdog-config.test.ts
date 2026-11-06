import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AdWatchdogSettingsSchema,
  DEFAULT_AD_WATCHDOG_SETTINGS,
  loadAdWatchdogSettings,
  invalidateSettingsCache,
} from '../../src/services/ad-watchdog.service';
import { prisma } from '../../src/db/client';

describe('AdWatchdog Config & Zod Schema', () => {
  beforeEach(() => {
    invalidateSettingsCache();
    vi.restoreAllMocks();
  });

  it('menggunakan default values yang benar ketika parsing empty object', () => {
    const parsed = AdWatchdogSettingsSchema.parse({});
    expect(parsed).toEqual(DEFAULT_AD_WATCHDOG_SETTINGS);
    expect(parsed.enabled).toBe(false);
    expect(parsed.activeStartHourWib).toBe(8);
    expect(parsed.activeEndHourWib).toBe(21);
    expect(parsed.minViews).toBe(30);
    expect(parsed.minCtr).toBe(0.04);
    expect(parsed.minAgedClicks).toBe(3);
    expect(parsed.graceMinutes).toBe(20);
    expect(parsed.cooldownMinutes).toBe(180);
    expect(parsed.baselineDays).toBe(7);
    expect(parsed.lowTrafficRatio).toBe(0.5);
    expect(parsed.paidMediums).toEqual(['cpc', 'paid', 'ctwa', 'ctwa_fuzzy']);
    expect(parsed.telegramTopicId).toBeNull();
  });

  it('memvalidasi custom valid values', () => {
    const custom = {
      enabled: true,
      activeStartHourWib: 9,
      activeEndHourWib: 20,
      minViews: 50,
      minCtr: 0.05,
      minAgedClicks: 5,
      graceMinutes: 15,
      cooldownMinutes: 120,
      baselineDays: 14,
      lowTrafficRatio: 0.4,
      paidMediums: ['paid', 'google'],
      telegramTopicId: 42,
    };
    const parsed = AdWatchdogSettingsSchema.parse(custom);
    expect(parsed).toEqual(custom);
  });

  it('menolak nilai di luar range (negative views, invalid hours, invalid ctr)', () => {
    expect(() => AdWatchdogSettingsSchema.parse({ minViews: -5 })).toThrow();
    expect(() => AdWatchdogSettingsSchema.parse({ activeStartHourWib: 25 })).toThrow();
    expect(() => AdWatchdogSettingsSchema.parse({ activeEndHourWib: -1 })).toThrow();
    expect(() => AdWatchdogSettingsSchema.parse({ minCtr: 1.5 })).toThrow();
    expect(() => AdWatchdogSettingsSchema.parse({ lowTrafficRatio: -0.1 })).toThrow();
  });

  it('loadAdWatchdogSettings mem-fallback ke default jika database offline atau record tidak ada', async () => {
    // tests/setup.ts mem-mock prisma agar throw "Database offline"
    const settings = await loadAdWatchdogSettings('default-tenant');
    expect(settings).toEqual(DEFAULT_AD_WATCHDOG_SETTINGS);
  });

  it('loadAdWatchdogSettings mem-parse JSON settings tenant dengan benar', async () => {
    vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValueOnce({
      id: 'tenant-test',
      settings: {
        adWatchdog: {
          enabled: true,
          minViews: 45,
          telegramTopicId: 3,
        },
      },
    });

    const settings = await loadAdWatchdogSettings('tenant-test');
    expect(settings.enabled).toBe(true);
    expect(settings.minViews).toBe(45);
    expect(settings.telegramTopicId).toBe(3);
    // Non-overridden fields keep default values
    expect(settings.minCtr).toBe(0.04);
    expect(settings.activeStartHourWib).toBe(8);
  });

  it('loadAdWatchdogSettings menggunakan in-memory cache sebelum TTL', async () => {
    const spy = vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValue({
      id: 'tenant-cache',
      settings: {
        adWatchdog: {
          enabled: true,
          minViews: 100,
        },
      },
    });

    const s1 = await loadAdWatchdogSettings('tenant-cache');
    expect(s1.minViews).toBe(100);
    expect(spy).toHaveBeenCalledTimes(1);

    // Call kedua harus hit cache tanpa panggil DB
    const s2 = await loadAdWatchdogSettings('tenant-cache');
    expect(s2.minViews).toBe(100);
    expect(spy).toHaveBeenCalledTimes(1);

    // Invalidate cache
    invalidateSettingsCache('tenant-cache');
    const s3 = await loadAdWatchdogSettings('tenant-cache');
    expect(s3.minViews).toBe(100);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('loadAdWatchdogSettings fallback ke default dan mencatat warn jika isi settings invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValueOnce({
      id: 'tenant-invalid',
      settings: {
        adWatchdog: {
          minViews: -999, // Invalid
        },
      },
    });

    const settings = await loadAdWatchdogSettings('tenant-invalid');
    expect(settings).toEqual(DEFAULT_AD_WATCHDOG_SETTINGS);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AdWatchdog] Invalid settings for tenant tenant-invalid'),
      expect.anything()
    );
  });
});

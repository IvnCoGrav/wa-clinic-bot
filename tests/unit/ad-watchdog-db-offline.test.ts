import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkAndNotify,
  loadAdWatchdogSettings,
  invalidateSettingsCache,
  DEFAULT_AD_WATCHDOG_SETTINGS,
} from '../../src/services/ad-watchdog.service';
import { prisma } from '../../src/db/client';
import { adFunnelMetricsService } from '../../src/services/ad-funnel-metrics.service';

describe('AdWatchdog DB-Offline Resilience', () => {
  beforeEach(() => {
    invalidateSettingsCache();
    vi.restoreAllMocks();
  });

  it('loadAdWatchdogSettings fallback senyap ke default saat Prisma offline', async () => {
    // tests/setup.ts default: prisma rejects "Database offline"
    const settings = await loadAdWatchdogSettings('default-tenant');
    expect(settings).toEqual(DEFAULT_AD_WATCHDOG_SETTINGS);
    expect(settings.enabled).toBe(false);
  });

  it('checkAndNotify mengembalikan DISABLED dan tidak throw error saat DB offline', async () => {
    // Karena default settings `enabled: false` saat DB offline, cron harus skip senyap
    const res = await checkAndNotify('default-tenant', new Date());
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('DISABLED');
  });

  it('checkAndNotify mengembalikan METRICS_UNAVAILABLE jika computeFunnelMetrics gagal atau bernilai null', async () => {
    // Mock tenant enabled
    vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValueOnce({
      id: 'default-tenant',
      settings: { adWatchdog: { enabled: true } },
    });

    // Mock metrics compute returns null
    vi.spyOn(adFunnelMetricsService, 'computeFunnelMetrics').mockResolvedValueOnce(null);

    const now1400Wib = new Date('2026-11-06T07:00:00.000Z');
    const res = await checkAndNotify('default-tenant', now1400Wib);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('METRICS_UNAVAILABLE');
  });

  it('checkAndNotify tidak crash jika AdminNotificationLog query melempar error saat DB offline', async () => {
    vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValue({
      id: 'default-tenant',
      settings: { adWatchdog: { enabled: true } },
    });

    vi.spyOn((prisma as any).adminNotificationLog, 'findFirst').mockRejectedValueOnce(
      new Error('Database offline')
    );
    vi.spyOn((prisma as any).adminNotificationLog, 'create').mockRejectedValueOnce(
      new Error('Database offline')
    );

    const anomalyMetrics = {
      paidViews: 50,
      uniquePaidClicks: 5,
      paidAgedClicks: 4,
      paidMatchedLeads: 0,
      inboundChats: 0,
      ctr: 0.1,
    };

    const now1400Wib = new Date('2026-11-06T07:00:00.000Z');
    // Harusnya tidak crash (fail-quiet atau dispatch alert)
    await expect(checkAndNotify('default-tenant', now1400Wib, anomalyMetrics, 50)).resolves.toBeDefined();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAndNotify, invalidateSettingsCache } from '../../src/services/ad-watchdog.service';
import { prisma } from '../../src/db/client';
import { AlertService } from '../../src/services/alert.service';
import { FunnelMetrics } from '../../src/services/ad-funnel-metrics.service';

describe('AdWatchdog Cooldown & Idempotency', () => {
  const fixedNow = new Date('2026-11-06T07:00:00.000Z'); // 14:00 WIB (inside operational hours)

  const anomalyMetrics: FunnelMetrics = {
    paidViews: 50,
    uniquePaidClicks: 5,
    paidAgedClicks: 4,
    paidMatchedLeads: 0,
    inboundChats: 0, // TOTAL_SILENCE
    ctr: 0.1,
  };

  beforeEach(() => {
    invalidateSettingsCache();
    vi.restoreAllMocks();

    // Default mock tenant: enabled
    vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValue({
      id: 'default-tenant',
      name: 'Kala Baby Spa',
      settings: {
        adWatchdog: {
          enabled: true,
          minViews: 30,
          minAgedClicks: 3,
          cooldownMinutes: 180,
        },
      },
    });
  });

  it('menahan alert jika cooldown masih aktif (< 180 menit)', async () => {
    // Mock AdminNotificationLog menemukan log yang dikirim 60 menit lalu
    vi.spyOn((prisma as any).adminNotificationLog, 'findFirst').mockResolvedValueOnce({
      id: 'log-1',
      tenant_id: 'default-tenant',
      notification_type: 'AD_FUNNEL_ANOMALY',
      sent_at: new Date(fixedNow.getTime() - 60 * 60 * 1000),
    });

    const notifySpy = vi.spyOn(AlertService.prototype, 'notifyAlert');

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);
    expect(res.sent).toBe(false);
    expect(res.signal).toBe('TOTAL_SILENCE');
    expect(res.reason).toBe('COOLDOWN_ACTIVE');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('mengabaikan kirim jika terjadi idempotency race (P2002 Prisma Unique Error)', async () => {
    // Cooldown check lolos (findFirst = null)
    vi.spyOn((prisma as any).adminNotificationLog, 'findFirst').mockResolvedValueOnce(null);

    // Create log melempar P2002 (bentrok idempotency_key)
    const p2002Error: any = new Error('Unique constraint failed on idempotency_key');
    p2002Error.code = 'P2002';
    vi.spyOn((prisma as any).adminNotificationLog, 'create').mockRejectedValueOnce(p2002Error);

    const notifySpy = vi.spyOn(AlertService.prototype, 'notifyAlert');

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);
    expect(res.sent).toBe(false);
    expect(res.signal).toBe('TOTAL_SILENCE');
    expect(res.reason).toBe('IDEMPOTENCY_CLAIMED');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('berhasil mengirim alert dan mencatat log saat cooldown bersih', async () => {
    vi.spyOn((prisma as any).adminNotificationLog, 'findFirst').mockResolvedValueOnce(null);
    const createSpy = vi.spyOn((prisma as any).adminNotificationLog, 'create').mockResolvedValueOnce({
      id: 'log-new',
    });
    const updateSpy = vi.spyOn((prisma as any).adminNotificationLog, 'update').mockResolvedValue({} as any);
    const notifySpy = vi.spyOn(AlertService.prototype, 'notifyAlert').mockResolvedValueOnce({
      sent: true,
      channel: 'telegram',
    } as any);

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);
    expect(res.sent).toBe(true);
    expect(res.signal).toBe('TOTAL_SILENCE');
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 'default-tenant',
          notification_type: 'AD_FUNNEL_ANOMALY',
          // M-07: klaim idempotensi dulu (PENDING), SENT hanya setelah terkirim.
          status: 'PENDING',
        }),
      })
    );
    expect(updateSpy).toHaveBeenCalledWith({ where: { id: 'log-new' }, data: { status: 'SENT' } });
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AD_FUNNEL_ANOMALY',
        rawMessage: true,
      })
    );
  });
});

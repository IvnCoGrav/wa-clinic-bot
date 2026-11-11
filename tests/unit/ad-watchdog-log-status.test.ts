import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAndNotify, invalidateSettingsCache } from '../../src/services/ad-watchdog.service';
import { prisma } from '../../src/db/client';
import { AlertService } from '../../src/services/alert.service';
import { FunnelMetrics } from '../../src/services/ad-funnel-metrics.service';

/**
 * M-07: status SENT tidak boleh ditulis sebelum alert benar-benar terkirim.
 * Kontrak baru: create PENDING (klaim idempotensi) → kirim → update SENT/FAILED.
 */
describe('AdWatchdog — status log mengikuti hasil kirim (M-07)', () => {
  const fixedNow = new Date('2026-11-06T07:00:00.000Z'); // 14:00 WIB
  const anomalyMetrics: FunnelMetrics = {
    paidViews: 50,
    uniquePaidClicks: 5,
    paidAgedClicks: 4,
    paidMatchedLeads: 0,
    inboundChats: 0,
    ctr: 0.1,
  };

  beforeEach(() => {
    invalidateSettingsCache();
    vi.restoreAllMocks();
    vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValue({
      id: 'default-tenant',
      name: 'Kala Baby Spa',
      settings: { adWatchdog: { enabled: true, minViews: 30, minAgedClicks: 3, cooldownMinutes: 180 } },
    } as any);
    vi.spyOn((prisma as any).adminNotificationLog, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn((prisma as any).adminNotificationLog, 'create').mockResolvedValue({ id: 'log-9' } as any);
  });

  it('kirim sukses → log dibuat PENDING lalu di-update SENT', async () => {
    const updateSpy = vi.spyOn((prisma as any).adminNotificationLog, 'update').mockResolvedValue({} as any);
    vi.spyOn(AlertService.prototype, 'notifyAlert').mockResolvedValue({ sent: true, channel: 'telegram' } as any);

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);

    expect(res.sent).toBe(true);
    const createArg = ((prisma as any).adminNotificationLog.create as any).mock.calls[0][0];
    expect(createArg.data.status).toBe('PENDING');
    expect(updateSpy).toHaveBeenCalledWith({ where: { id: 'log-9' }, data: { status: 'SENT' } });
  });

  it('pengiriman gagal → log FAILED dan res.sent false (bukan sukses palsu)', async () => {
    const updateSpy = vi.spyOn((prisma as any).adminNotificationLog, 'update').mockResolvedValue({} as any);
    vi.spyOn(AlertService.prototype, 'notifyAlert').mockResolvedValue({ sent: false, channel: 'console' } as any);

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);

    expect(res.sent).toBe(false);
    expect(res.reason).toBe('DELIVERY_FAILED');
    expect(updateSpy).toHaveBeenCalledWith({ where: { id: 'log-9' }, data: { status: 'FAILED' } });
  });

  it('exception saat kirim → log FAILED (tidak meninggalkan PENDING)', async () => {
    const updateSpy = vi.spyOn((prisma as any).adminNotificationLog, 'update').mockResolvedValue({} as any);
    vi.spyOn(AlertService.prototype, 'notifyAlert').mockRejectedValue(new Error('network down'));

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);

    expect(res.sent).toBe(false);
    expect(updateSpy).toHaveBeenCalledWith({ where: { id: 'log-9' }, data: { status: 'FAILED' } });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAndNotify, invalidateSettingsCache } from '../../src/services/ad-watchdog.service';
import { prisma } from '../../src/db/client';
import { AlertService } from '../../src/services/alert.service';
import { resolveGatewayForTenant } from '../../src/integrations/whatsapp/factory';
import { FunnelMetrics } from '../../src/services/ad-funnel-metrics.service';

vi.mock('../../src/integrations/whatsapp/factory', () => ({
  resolveGatewayForTenant: vi.fn(),
}));

/**
 * TEMPORARY (2026-11-15, keputusan owner) — salinan alert watchdog via WhatsApp.
 *
 * Konteks produksi: alert `TOTAL_SILENCE`/`INSTRUMENTATION_SUSPECT` sudah terkirim
 * ke Telegram grup "Report kala" (thread 3), tetapi owner menyatakan tidak melihat
 * notifikasi tersebut. Solusi sementara: kirim salinan via WhatsApp dari nomor bot
 * ke penerima yang dikonfigurasi per-tenant (`settings.adWatchdog.whatsappRecipients`).
 * Dicatat di docs/KNOWN_ISSUES.md #350 sebagai solusi sementara.
 *
 * Kontrak:
 *  1. Nomor dinormalisasi ke format 62… (input 08… / 8… / 62… sama-sama diterima).
 *  2. Salinan WA TIDAK boleh menggagalkan alert Telegram (fail-soft).
 *  3. Tanpa penerima terkonfigurasi → tidak ada pengiriman WA (perilaku lama).
 *  4. Setiap salinan WA dicatat di admin_notification_logs dengan channel WHATSAPP
 *     dan idempotency_key unik (suffix :WA:<index>) agar tidak bentrok dengan
 *     baris Telegram yang sudah memakai key utama.
 */
describe('AdWatchdog — salinan alert via WhatsApp (temporary)', () => {
  const fixedNow = new Date('2026-11-06T07:00:00.000Z'); // 14:00 WIB
  const anomalyMetrics: FunnelMetrics = {
    paidViews: 50,
    uniquePaidClicks: 5,
    paidAgedClicks: 4,
    paidMatchedLeads: 0,
    inboundChats: 0,
    ctr: 0.1,
  };

  const mockGateway = { sendTextMessage: vi.fn().mockResolvedValue({ success: true }) };

  const setTenantSettings = (adWatchdog: Record<string, unknown>) => {
    vi.spyOn((prisma as any).tenant, 'findUnique').mockResolvedValue({
      id: 'default-tenant',
      name: 'Kala Baby Spa',
      settings: { adWatchdog: { enabled: true, minViews: 30, minAgedClicks: 3, cooldownMinutes: 180, ...adWatchdog } },
    } as any);
  };

  beforeEach(() => {
    invalidateSettingsCache();
    vi.restoreAllMocks();
    mockGateway.sendTextMessage.mockReset();
    mockGateway.sendTextMessage.mockResolvedValue({ success: true });
    vi.mocked(resolveGatewayForTenant).mockResolvedValue(mockGateway as any);
    vi.spyOn((prisma as any).adminNotificationLog, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn((prisma as any).adminNotificationLog, 'create').mockResolvedValue({ id: 'log-wa' } as any);
    vi.spyOn((prisma as any).adminNotificationLog, 'update').mockResolvedValue({} as any);
    vi.spyOn(AlertService.prototype, 'notifyAlert').mockResolvedValue({ sent: true, channel: 'telegram' } as any);
  });

  it('1. mengirim salinan WA ke penerima terkonfigurasi + mencatat channel WHATSAPP', async () => {
    setTenantSettings({ whatsappRecipients: ['088235780925'] });

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);

    expect(res.sent).toBe(true);
    expect(mockGateway.sendTextMessage).toHaveBeenCalledTimes(1);
    // 088235780925 → 6288235780925
    expect(mockGateway.sendTextMessage).toHaveBeenCalledWith(
      '6288235780925',
      expect.stringContaining('[WATCHDOG IKLAN]')
    );
    const waLog = ((prisma as any).adminNotificationLog.create as any).mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.channel === 'WHATSAPP');
    expect(waLog).toBeTruthy();
    expect(waLog.recipient).toBe('6288235780925');
    expect(waLog.status).toBe('SENT');
    expect(waLog.idempotency_key).toContain(':WA:');
  });

  it('2. tanpa penerima WA → tidak ada pengiriman WA (perilaku lama tetap)', async () => {
    setTenantSettings({});

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);

    expect(res.sent).toBe(true);
    expect(mockGateway.sendTextMessage).not.toHaveBeenCalled();
  });

  it('3. WA gagal (exception) → alert Telegram tetap sukses, log WA FAILED', async () => {
    setTenantSettings({ whatsappRecipients: ['6288235780925'] });
    mockGateway.sendTextMessage.mockRejectedValueOnce(new Error('waha down'));

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);

    expect(res.sent).toBe(true);
    const waLog = ((prisma as any).adminNotificationLog.create as any).mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.channel === 'WHATSAPP');
    expect(waLog.status).toBe('FAILED');
    expect(waLog.error_message).toContain('waha down');
  });

  it('4. gateway tidak tersedia → alert Telegram tetap sukses (fail-soft)', async () => {
    setTenantSettings({ whatsappRecipients: ['6288235780925'] });
    vi.mocked(resolveGatewayForTenant).mockRejectedValueOnce(new Error('gateway init failed'));

    const res = await checkAndNotify('default-tenant', fixedNow, anomalyMetrics, 50);

    expect(res.sent).toBe(true);
    expect(mockGateway.sendTextMessage).not.toHaveBeenCalled();
  });
});

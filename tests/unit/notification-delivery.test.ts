import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: factory vi.mock di-hoist ke atas file, jadi mock fn harus di-hoist juga.
const h = vi.hoisted(() => ({
  adminNotificationLog: { findUnique: vi.fn(), create: vi.fn() },
  sendTextMessage: vi.fn(),
  resolveGatewayForTenant: vi.fn(),
  notifyAlert: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: { adminNotificationLog: h.adminNotificationLog },
}));

vi.mock('../../src/integrations/whatsapp/factory', () => ({
  resolveGatewayForTenant: (...args: any[]) => h.resolveGatewayForTenant(...args),
}));

vi.mock('../../src/services/alert.service', () => ({
  alertService: { notifyAlert: (...args: any[]) => h.notifyAlert(...args) },
  AlertType: { DAILY_OPS_REPORT: 'DAILY_OPS_REPORT' },
  AlertSeverity: { INFO: 'INFO' },
}));

const adminNotificationLog = h.adminNotificationLog;
const sendTextMessage = h.sendTextMessage;
const resolveGatewayForTenant = h.resolveGatewayForTenant;
const notifyAlert = h.notifyAlert;

import {
  notificationDeliveryService,
  formatReportDateWib,
} from '../../src/services/notification-delivery.service';

describe('NotificationDeliveryService (Fase 1r)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationDeliveryService.clearMemoryLogs();
    adminNotificationLog.findUnique.mockResolvedValue(null);
    adminNotificationLog.create.mockImplementation(async ({ data }: any) => ({ id: 'log-1', ...data }));
    resolveGatewayForTenant.mockResolvedValue({
      providerType: 'WAHA',
      sendTextMessage,
    });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid-1', provider: 'WAHA' });
    notifyAlert.mockResolvedValue({ sent: true, channel: 'telegram' });
  });

  it('menormalkan nomor WA dari berbagai format ke E.164 (tanpa regex hafalan)', async () => {
    const cases: Array<[string, string]> = [
      ['08123456789', '628123456789'],
      ['+62 812-3456-7890', '6281234567890'],
      ['62812 3456 789', '628123456789'],
      ['8123456789', '628123456789'],
    ];
    for (const [input, expected] of cases) {
      sendTextMessage.mockClear();
      await notificationDeliveryService.send({
        tenantId: 'tenant-a',
        channel: 'WHATSAPP',
        recipient: input,
        type: 'TEST_SIMULATION',
        title: 't',
        messageContent: 'm',
      });
      expect(sendTextMessage).toHaveBeenCalledWith(expected, 'm');
    }
  });

  it('mengisolasi log per tenant (idempotency key tidak bocor antar-tenant)', async () => {
    // tenant-a sudah pernah SENT untuk tanggal ini
    adminNotificationLog.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.idempotency_key === 'tenant-a:NIGHTLY_WATCHDOG:2026-09-27') {
        return { id: 'existing-a', status: 'SENT' };
      }
      return null;
    });

    const resA = await notificationDeliveryService.send({
      tenantId: 'tenant-a',
      channel: 'TELEGRAM',
      recipient: '111',
      type: 'NIGHTLY_WATCHDOG',
      title: 't',
      messageContent: 'm',
      reportDate: '2026-09-27',
      idempotencyKey: 'tenant-a:NIGHTLY_WATCHDOG:2026-09-27',
    });
    expect(resA.status).toBe('ALREADY_SENT');
    expect(notifyAlert).not.toHaveBeenCalled();

    // tenant-b dengan tanggal sama TETAP dikirim (tidak tertahan log tenant-a)
    const resB = await notificationDeliveryService.send({
      tenantId: 'tenant-b',
      channel: 'TELEGRAM',
      recipient: '222',
      type: 'NIGHTLY_WATCHDOG',
      title: 't',
      messageContent: 'm',
      reportDate: '2026-09-27',
      idempotencyKey: 'tenant-b:NIGHTLY_WATCHDOG:2026-09-27',
    });
    expect(resB.status).toBe('SENT');
    expect(notifyAlert).toHaveBeenCalledTimes(1);
  });

  it('idempoten: tidak mengirim ulang bila key sama sudah SENT (anti-spam cron restart)', async () => {
    adminNotificationLog.findUnique.mockResolvedValue({ id: 'log-x', status: 'SENT' });
    const res = await notificationDeliveryService.send({
      tenantId: 'tenant-a',
      channel: 'TELEGRAM',
      recipient: '111',
      type: 'NIGHTLY_WATCHDOG',
      title: 't',
      messageContent: 'm',
      reportDate: '2026-09-27',
      idempotencyKey: 'tenant-a:NIGHTLY_WATCHDOG:2026-09-27',
    });
    expect(res.status).toBe('ALREADY_SENT');
    expect(notifyAlert).not.toHaveBeenCalled();
    expect(adminNotificationLog.create).not.toHaveBeenCalled();
  });

  it('WABA → SKIPPED (bukan FAILED) dan tetap tercatat di log', async () => {
    resolveGatewayForTenant.mockResolvedValue({
      providerType: 'WABA',
      sendTextMessage,
    });
    const res = await notificationDeliveryService.send({
      tenantId: 'tenant-waba',
      channel: 'WHATSAPP',
      recipient: '628123456789',
      type: 'NIGHTLY_WATCHDOG',
      title: 't',
      messageContent: 'm',
    });
    expect(res.status).toBe('SKIPPED');
    expect(res.success).toBe(false);
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(adminNotificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) })
    );
  });

  it('kegagalan gateway WAHA → FAILED + error_message tersimpan', async () => {
    sendTextMessage.mockResolvedValue({
      success: false,
      provider: 'WAHA',
      error: { code: 'X', message: 'session down' },
    });
    const res = await notificationDeliveryService.send({
      tenantId: 'tenant-a',
      channel: 'WHATSAPP',
      recipient: '628123456789',
      type: 'ALERT_URGENT',
      title: 't',
      messageContent: 'm',
    });
    expect(res.status).toBe('FAILED');
    expect(res.error).toContain('session down');
    expect(adminNotificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', error_message: expect.stringContaining('session down') }),
      })
    );
  });

  it('DB offline → log ke memori, tidak melempar (cron-safe)', async () => {
    adminNotificationLog.findUnique.mockRejectedValue(new Error('Database offline'));
    adminNotificationLog.create.mockRejectedValue(new Error('Database offline'));

    const res = await notificationDeliveryService.send({
      tenantId: 'tenant-a',
      channel: 'TELEGRAM',
      recipient: '111',
      type: 'DAILY_BRIEFING',
      title: 't',
      messageContent: 'm',
    });
    expect(res.success).toBe(true);
    expect(res.logId).toMatch(/^mem-/);
    expect(notificationDeliveryService.getMemoryLogs().length).toBe(1);
  });

  it('balapan cron (P2002 duplikat) diperlakukan sebagai sudah tercatat, bukan crash', async () => {
    adminNotificationLog.findUnique
      .mockResolvedValueOnce(null) // cek awal: belum ada
      .mockResolvedValueOnce({ id: 'log-race', status: 'SENT' }); // setelah P2002
    const p2002: any = new Error('Unique constraint failed');
    p2002.code = 'P2002';
    adminNotificationLog.create.mockRejectedValue(p2002);

    const res = await notificationDeliveryService.send({
      tenantId: 'tenant-a',
      channel: 'TELEGRAM',
      recipient: '111',
      type: 'NIGHTLY_WATCHDOG',
      title: 't',
      messageContent: 'm',
      reportDate: '2026-09-27',
      idempotencyKey: 'tenant-a:NIGHTLY_WATCHDOG:2026-09-27',
    });
    expect(res.logId).toBe('log-race');
  });

  it('SYSTEM channel hanya mencatat tanpa panggilan eksternal', async () => {
    const res = await notificationDeliveryService.send({
      tenantId: 'tenant-a',
      channel: 'SYSTEM',
      recipient: 'in-app',
      type: 'DAILY_BRIEFING',
      title: 't',
      messageContent: 'm',
    });
    expect(res.status).toBe('SENT');
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(notifyAlert).not.toHaveBeenCalled();
  });

  it('formatReportDateWib mengembalikan tanggal WIB (bukan UTC)', () => {
    // 2026-09-27T18:30:00Z → 2026-09-28 01:30 WIB
    const d = new Date('2026-09-27T18:30:00Z');
    expect(formatReportDateWib(d)).toBe('2026-09-28');
  });
});

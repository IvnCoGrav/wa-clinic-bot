import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertService, AlertType, AlertSeverity } from '../../src/services/alert.service';
import { WebPushService } from '../../src/services/web-push.service';
import { followUpService } from '../../src/services/follow-up.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('FN-07: Multi-tenant Alert Cooldown Throttling', () => {
  it('does NOT throttle alert from tenant-b when tenant-a was recently alerted', async () => {
    // Kita buat AlertService dengan cooldown 60.000 ms
    const service = new AlertService(60000);

    // Bypass NODE_ENV === 'test' check agar cooldown aktif dalam unit test
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      // Mock emergency file / telegram send agar tidak benar-benar mengirim network
      // (AlertService fallback ke emergency_file jika Telegram tidak dikonfigurasi)
      const alertA1 = await service.notifyAlert({
        type: AlertType.THIRD_PARTY_OUTAGE,
        severity: AlertSeverity.CRITICAL,
        message: 'ORS outage in tenant-a',
        provider: 'ORS',
        tenantId: 'tenant-a',
      });
      expect(alertA1.sent).toBe(true);
      expect(alertA1.throttled).toBe(false);

      // Tenant B mengirim jenis alert yang sama persis
      const alertB1 = await service.notifyAlert({
        type: AlertType.THIRD_PARTY_OUTAGE,
        severity: AlertSeverity.CRITICAL,
        message: 'ORS outage in tenant-b',
        provider: 'ORS',
        tenantId: 'tenant-b',
      });
      // Harusnya TIDAK di-throttle karena tenant-nya berbeda (tenant-b vs tenant-a)
      expect(alertB1.sent).toBe(true);
      expect(alertB1.throttled).toBe(false);

      // Tenant A mengirim lagi dalam window cooldown -> wajib ter-throttle!
      const alertA2 = await service.notifyAlert({
        type: AlertType.THIRD_PARTY_OUTAGE,
        severity: AlertSeverity.CRITICAL,
        message: 'ORS outage in tenant-a again',
        provider: 'ORS',
        tenantId: 'tenant-a',
      });
      expect(alertA2.sent).toBe(false);
      expect(alertA2.throttled).toBe(true);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('cooldown key includes tenant prefix for non-provider alerts', async () => {
    const service = new AlertService(60000);
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const alertA1 = await service.notifyAlert({
        type: AlertType.DATABASE_OFFLINE,
        severity: AlertSeverity.CRITICAL,
        message: 'DB offline for tenant-a',
        tenantId: 'tenant-a',
      });
      expect(alertA1.sent).toBe(true);

      const alertB1 = await service.notifyAlert({
        type: AlertType.DATABASE_OFFLINE,
        severity: AlertSeverity.CRITICAL,
        message: 'DB offline for tenant-b',
        tenantId: 'tenant-b',
      });
      expect(alertB1.sent).toBe(true);
      expect(alertB1.throttled).toBe(false);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

describe('FN-08: VAPID Subject Dynamic Fallback', () => {
  it('does NOT contain hardcoded kala-clinic.com when VAPID_SUBJECT env is empty', () => {
    const origSubject = process.env.VAPID_SUBJECT;
    delete process.env.VAPID_SUBJECT;

    try {
      const webPush = WebPushService.getInstance();
      const subject = (webPush as any).vapidSubject;
      expect(subject).not.toContain('kala-clinic.com');
      expect(subject).toMatch(/^mailto:/);
    } finally {
      if (origSubject) process.env.VAPID_SUBJECT = origSubject;
    }
  });
});

describe('FN-06: FollowUp Tenant Audit Log', () => {
  it('logs debug information when default tenantId fallback is used', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      // Panggil method tanpa argumen tenantId (menggunakan default DEFAULT_TENANT_ID)
      await followUpService.getAllTemplates();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Method 'getAllTemplates' invoked with fallback default tenantId (${DEFAULT_TENANT_ID})`)
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      debugSpy.mockRestore();
    }
  });
});

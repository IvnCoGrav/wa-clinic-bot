import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationDeliveryService } from '../../src/services/notification-delivery.service';
import { WebPushService } from '../../src/services/web-push.service';
import { sharelocReminderService } from '../../src/services/shareloc-reminder.service';
import { getStaffChatNotificationConfig } from '../../src/config/staff-chat-config';
import { prisma } from '../../src/db/client';
import * as factory from '../../src/integrations/whatsapp/factory';

describe('FN-04: Bounded memory on notificationDeliveryService', () => {
  beforeEach(() => {
    notificationDeliveryService.clearMemoryLogs();
  });

  it('limits memoryNotificationLogs to 500 entries using FIFO eviction', async () => {
    // Kirim 510 notifikasi saat DB offline (pola fallback in-memory)
    for (let i = 1; i <= 510; i++) {
      await notificationDeliveryService.send({
        tenantId: 'test-tenant',
        channel: 'SYSTEM',
        recipient: `recip_${i}`,
        type: 'ALERT_URGENT',
        title: `Alert ${i}`,
        messageContent: `Content ${i}`,
      });
    }

    const logs = notificationDeliveryService.getMemoryLogs();
    expect(logs.length).toBe(500);

    // Entri 1-10 harus sudah ter-evict (FIFO). Entri tertua yang tersisa harus title "Alert 11"
    expect(logs[0].title).toBe('Alert 11');
    expect(logs[logs.length - 1].title).toBe('Alert 510');
  });
});

describe('FN-12: Bounded memory on WebPushService subscriptions', () => {
  it('limits memorySubscriptions to MAX_MEMORY_SUBSCRIPTIONS (1000) using FIFO eviction', async () => {
    const webPush = WebPushService.getInstance();
    const map = (webPush as any).memorySubscriptions as Map<string, any>;
    map.clear();

    // Simpan 1020 subscriptions
    for (let i = 1; i <= 1020; i++) {
      await webPush.saveSubscription({
        tenantId: 'test-tenant',
        endpoint: `https://push.example.com/ep_${i}`,
        p256dh: `key_${i}`,
        auth: `auth_${i}`,
      });
    }

    expect(map.size).toBe(1000);
    // Endpoint ep_1 s/d ep_20 harus sudah dibuang
    expect(map.has('https://push.example.com/ep_1')).toBe(false);
    expect(map.has('https://push.example.com/ep_20')).toBe(false);
    expect(map.has('https://push.example.com/ep_21')).toBe(true);
    expect(map.has('https://push.example.com/ep_1020')).toBe(true);
  });
});

describe('FN-10 & FN-09: Atomic transaction & type safety in sharelocReminderService', () => {
  it('uses prisma.$transaction to update conversation session_data and customer preferences atomically', async () => {
    const txSpy = vi.spyOn(prisma, '$transaction').mockImplementation(async (ops: any) => {
      return Array.isArray(ops) ? ops : [];
    });

    const mockGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'wa-msg-1' }),
    };
    vi.spyOn(factory, 'resolveGatewayForTenant').mockResolvedValue(mockGateway as any);

    const origEnv = process.env.ENABLE_SHARELOC_REMINDER_SWEEP;
    process.env.ENABLE_SHARELOC_REMINDER_SWEEP = 'true';

    try {
      // Mock resolveTemplate agar mengembalikan string template
      vi.spyOn(sharelocReminderService, 'resolveTemplate').mockResolvedValue('Halo {name}, mohon shareloc');

      // Mock prisma.reservation.findMany
      const mockCustomer = {
        id: 'cust-1',
        name: 'Bunda Test',
        phone: '081234567890',
        share_location_sent: false,
        lat: null,
        lng: null,
        location_source: null,
        is_internal_staff: false,
        is_sandbox_test: false,
        deleted_at: null,
        preferences: {},
      };

      const fakeNow = new Date('2026-11-10T03:00:00.000Z'); // 10:00 WIB
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([
        {
          id: 'res-1',
          tenant_id: 'default-tenant',
          status: 'confirmed',
          booking_date: new Date(fakeNow.getTime() + 86400000),
          created_at: new Date(fakeNow.getTime() - 4 * 3600 * 1000), // 4 jam lalu (> 3h wait)
          customer: mockCustomer,
        } as any,
      ]);

      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
        id: 'conv-1',
        is_human_handling: false,
        session_data: {},
      } as any);

      vi.spyOn(prisma.adminNotificationLog, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.adminNotificationLog, 'create').mockResolvedValue({ id: 'log-1' } as any);
      vi.spyOn(prisma.adminNotificationLog, 'update').mockResolvedValue({ id: 'log-1' } as any);

      const res = await sharelocReminderService.sweep('default-tenant', fakeNow);

      // Pastikan pesan terkirim dan prisma.$transaction dipanggil (FN-10)
      expect(res.sent).toBe(1);
      expect(txSpy).toHaveBeenCalled();
    } finally {
      process.env.ENABLE_SHARELOC_REMINDER_SWEEP = origEnv;
      txSpy.mockRestore();
    }
  });
});

describe('FN-11: Staff Chat Config Fallback Logging', () => {
  it('logs warn when database query throws error and fallback default is used', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Prisma offline secara default melempar error
    const config = await getStaffChatNotificationConfig(`tenant-err-${Date.now()}`);
    expect(config.enabled).toBe(true);
    expect(config.startHourWib).toBe(7);
    expect(config.endHourWib).toBe(21);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gagal memuat konfigurasi jam staf tenant'),
      expect.anything()
    );

    warnSpy.mockRestore();
  });

  it('logs info when tenant configuration is not found in DB and default hours are used', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);
    vi.spyOn(prisma.clinicPolicy, 'findUnique').mockResolvedValue(null as any);

    const config = await getStaffChatNotificationConfig(`tenant-null-${Date.now()}`);
    expect(config.enabled).toBe(true);
    expect(config.startHourWib).toBe(7);
    expect(config.endHourWib).toBe(21);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('tidak ditemukan di DB; menggunakan fallback default')
    );

    infoSpy.mockRestore();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webPushService } from '../../src/services/web-push.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import webpush from 'web-push';

describe('WebPushService — VAPID Background Push Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getPublicKey: mengembalikan VAPID public key valid', () => {
    const key = webPushService.getPublicKey();
    expect(key).toBeDefined();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(20);
  });

  it('saveSubscription & getSubscriptions: menyimpan dan mengambil subscription offline', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/test_${Date.now()}`;
    const p256dh = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=';
    const auth = 'tBHItJI5svbpez7KI4CCXg==';

    const saved = await webPushService.saveSubscription({
      tenantId: DEFAULT_TENANT_ID,
      endpoint,
      p256dh,
      auth,
      userType: 'ADMIN',
      userId: 'admin_123',
    });

    expect(saved).toBeDefined();
    expect(saved.endpoint).toBe(endpoint);

    const list = await webPushService.getSubscriptions(DEFAULT_TENANT_ID);
    expect(list.some((s) => s.endpoint === endpoint)).toBe(true);
  });

  it('removeSubscription: menghapus endpoint langganan', async () => {
    const endpoint = `https://updates.push.apple.com/test_del_${Date.now()}`;
    await webPushService.saveSubscription({
      tenantId: DEFAULT_TENANT_ID,
      endpoint,
      p256dh: 'dummy_p256dh',
      auth: 'dummy_auth',
      userType: 'STAFF',
    });

    await webPushService.removeSubscription(endpoint);
    const list = await webPushService.getSubscriptions(DEFAULT_TENANT_ID);
    expect(list.some((s) => s.endpoint === endpoint)).toBe(false);
  });

  it('sendPushToTenant: mengirim push payload dan memprune subscription kadaluarsa (410 Gone)', async () => {
    const deadEndpoint = `https://fcm.googleapis.com/fcm/send/dead_${Date.now()}`;
    await webPushService.saveSubscription({
      tenantId: 'tenant-test',
      endpoint: deadEndpoint,
      p256dh: 'dummy_key',
      auth: 'dummy_auth',
    });

    const sendSpy = vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce({
      statusCode: 410,
      message: 'Subscription has expired or is no longer valid',
    });

    const result = await webPushService.sendPushToTenant('tenant-test', {
      title: 'Pesan Baru',
      body: 'Halo admin',
    });

    expect(sendSpy).toHaveBeenCalled();
    expect(result.failed).toBe(1);

    // Endpoint kadaluarsa (410) harus otomatis terhapus dari daftar aktif
    const listAfter = await webPushService.getSubscriptions('tenant-test');
    expect(listAfter.some((s) => s.endpoint === deadEndpoint)).toBe(false);
  });
});

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

  it('saveSubscription: menormalisasi userType (therapist -> STAFF, super_admin -> ADMIN)', async () => {
    const ep1 = `https://fcm.googleapis.com/fcm/send/norm1_${Date.now()}`;
    const ep2 = `https://fcm.googleapis.com/fcm/send/norm2_${Date.now()}`;

    const sub1 = await webPushService.saveSubscription({
      tenantId: 'tenant-norm',
      endpoint: ep1,
      p256dh: 'k1',
      auth: 'a1',
      userType: 'therapist',
      userId: 'staff_abc',
    });
    expect(sub1.user_type).toBe('STAFF');

    const sub2 = await webPushService.saveSubscription({
      tenantId: 'tenant-norm',
      endpoint: ep2,
      p256dh: 'k2',
      auth: 'a2',
      userType: 'super_admin',
      userId: 'admin_xyz',
    });
    expect(sub2.user_type).toBe('ADMIN');
  });

  it('sendPushToStaff: menargetkan perangkat berdasarkan user_id (UUID staff)', async () => {
    const staffId = 'staff_hanifah_123';
    const ep = `https://web.push.apple.com/test_${Date.now()}`;
    await webPushService.saveSubscription({
      tenantId: 'tenant-staff-test',
      endpoint: ep,
      p256dh: 'key_apple',
      auth: 'auth_apple',
      userType: 'STAFF',
      userId: staffId,
    });

    const sendSpy = vi.spyOn(webpush, 'sendNotification').mockResolvedValueOnce({} as any);

    const result = await webPushService.sendPushToStaff(staffId, 'tenant-staff-test', {
      title: 'Tugas Kunjungan Baru',
      body: 'Pasien Bunda Sarah',
    });

    expect(sendSpy).toHaveBeenCalled();
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('getStaffDeviceCounts: mengembalikan jumlah perangkat aktif per staffId', async () => {
    const staffId = `staff_count_${Date.now()}`;
    const ep1 = `https://fcm.googleapis.com/fcm/send/c1_${Date.now()}`;
    const ep2 = `https://fcm.googleapis.com/fcm/send/c2_${Date.now()}`;

    await webPushService.saveSubscription({
      tenantId: 'tenant-counts',
      endpoint: ep1,
      p256dh: 'k1',
      auth: 'a1',
      userType: 'STAFF',
      userId: staffId,
    });
    await webPushService.saveSubscription({
      tenantId: 'tenant-counts',
      endpoint: ep2,
      p256dh: 'k2',
      auth: 'a2',
      userType: 'STAFF',
      userId: staffId,
    });

    const counts = await webPushService.getStaffDeviceCounts('tenant-counts');
    expect(counts[staffId]).toBe(2);
  });

  it('sendPushToRole: mengisolasi pengiriman notifikasi antar peran (ADMIN vs STAFF)', async () => {
    const tenantId = `tenant-iso-${Date.now()}`;
    const epAdmin = `https://fcm.googleapis.com/fcm/send/admin_${Date.now()}`;
    const epStaff = `https://fcm.googleapis.com/fcm/send/staff_${Date.now()}`;

    await webPushService.saveSubscription({
      tenantId,
      endpoint: epAdmin,
      p256dh: 'k_admin',
      auth: 'a_admin',
      userType: 'ADMIN',
    });

    await webPushService.saveSubscription({
      tenantId,
      endpoint: epStaff,
      p256dh: 'k_staff',
      auth: 'a_staff',
      userType: 'STAFF',
      userId: 'staff_1',
    });

    const sentEndpoints: string[] = [];
    vi.spyOn(webpush, 'sendNotification').mockImplementation(async (sub: any) => {
      sentEndpoints.push(sub.endpoint);
      return {} as any;
    });

    // 1. Kirim ke ADMIN -> hanya endpoint admin yang menerima
    sentEndpoints.length = 0;
    const adminResult = await webPushService.sendPushToRole(tenantId, 'ADMIN', {
      title: 'Pesan Admin',
      body: 'Untuk admin saja',
    });
    expect(adminResult.sent).toBe(1);
    expect(sentEndpoints).toContain(epAdmin);
    expect(sentEndpoints).not.toContain(epStaff);

    // 2. Kirim via sendPushToTenant (default ke ADMIN) -> staf tetap terlindungi
    sentEndpoints.length = 0;
    const tenantResult = await webPushService.sendPushToTenant(tenantId, {
      title: 'Broadcast Tenant',
      body: 'Default admin',
    });
    expect(tenantResult.sent).toBe(1);
    expect(sentEndpoints).toContain(epAdmin);
    expect(sentEndpoints).not.toContain(epStaff);

    // 3. Kirim ke STAFF -> hanya endpoint staff yang menerima
    sentEndpoints.length = 0;
    const staffResult = await webPushService.sendPushToRole(tenantId, 'STAFF', {
      title: 'Pesan Staff',
      body: 'Untuk staf saja',
    });
    expect(staffResult.sent).toBe(1);
    expect(sentEndpoints).toContain(epStaff);
    expect(sentEndpoints).not.toContain(epAdmin);
  });
});

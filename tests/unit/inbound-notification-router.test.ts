import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inboundNotificationRouter } from '../../src/services/inbound-notification-router.service';
import { webPushService } from '../../src/services/web-push.service';
import { prisma } from '../../src/db/client';
import * as staffChatConfig from '../../src/config/staff-chat-config';

describe('InboundNotificationRouter — Routing Notifikasi Chat Inbound', () => {
  const tenantId = 'tenant-router-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Customer umum tanpa reservasi: Admin menerima push, Staf menerima 0 push', async () => {
    const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
    const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 0, failed: 0 });

    (prisma.reservation.findFirst as any).mockResolvedValueOnce(null);

    await inboundNotificationRouter.routeInboundMessage({
      tenantId,
      conversationId: 'conv-1',
      customerId: 'cust-no-res',
      senderName: 'Bunda Pelanggan Baru',
      content: 'Halo mau tanya paket pijat bayi',
    });

    expect(adminPushSpy).toHaveBeenCalledWith(
      tenantId,
      'ADMIN',
      expect.objectContaining({
        title: 'Bunda Pelanggan Baru',
        body: 'Halo mau tanya paket pijat bayi',
        url: '/admin/live-chat?conversationId=conv-1',
      })
    );

    expect(staffPushSpy).not.toHaveBeenCalled();
  });

  it('Customer memiliki reservasi MINGGU DEPAN (bukan hari ini): Admin menerima push, Staf menerima 0 push', async () => {
    const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
    const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 0, failed: 0 });

    // Kueri dengan booking_date gte: startOfDay, lte: endOfDay akan mengembalikan null untuk jadwal minggu depan
    (prisma.reservation.findFirst as any).mockResolvedValueOnce(null);

    await inboundNotificationRouter.routeInboundMessage({
      tenantId,
      conversationId: 'conv-2',
      customerId: 'cust-next-week',
      senderName: 'Bunda Sarah',
      content: 'Kak untuk reservasi minggu depan jamnya bisa dimajukan?',
    });

    expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
    expect(staffPushSpy).not.toHaveBeenCalled();
  });

  it('Customer memiliki jadwal HARI INI yang ditugaskan ke Bidan A: Admin & Bidan A menerima push, Bidan B menerima 0 push', async () => {
    const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
    const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });

    // Mock reservasi aktif hari ini ditugaskan ke staff_hanifah
    (prisma.reservation.findFirst as any).mockResolvedValueOnce({
      assigned_staff_id: 'staff_hanifah',
      assigned_staff: {
        id: 'staff_hanifah',
        name: 'Bidan Hanifah',
        active: true,
      },
    });

    // Pastikan berada dalam jam operasional
    vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(true);

    await inboundNotificationRouter.routeInboundMessage({
      tenantId,
      conversationId: 'conv-3',
      customerId: 'cust-today-hanifah',
      senderName: 'Bunda Ivan Noor',
      content: 'Mbak sudah sampai mana ya?',
    });

    // 1. Admin menerima push live-chat
    expect(adminPushSpy).toHaveBeenCalledWith(
      tenantId,
      'ADMIN',
      expect.objectContaining({
        title: 'Bunda Ivan Noor',
        url: '/admin/live-chat?conversationId=conv-3',
      })
    );

    // 2. Bidan Hanifah menerima targeted push portal staf
    expect(staffPushSpy).toHaveBeenCalledTimes(1);
    expect(staffPushSpy).toHaveBeenCalledWith(
      'staff_hanifah',
      tenantId,
      expect.objectContaining({
        title: '💬 Pesan dari Bunda Ivan Noor',
        body: 'Mbak sudah sampai mana ya?',
        url: '/admin/staff/today',
        tag: 'staff_chat_conv-3',
      })
    );
  });

  it('Customer chat di luar jam operasional (misal 23:00 WIB): Admin menerima push, Staf menerima 0 push', async () => {
    const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
    const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 0, failed: 0 });

    (prisma.reservation.findFirst as any).mockResolvedValueOnce({
      assigned_staff_id: 'staff_hanifah',
      assigned_staff: {
        id: 'staff_hanifah',
        name: 'Bidan Hanifah',
        active: true,
      },
    });

    // Mock jam di luar rentang operasional
    vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(false);

    await inboundNotificationRouter.routeInboundMessage({
      tenantId,
      conversationId: 'conv-night',
      customerId: 'cust-today-night',
      senderName: 'Bunda Malam',
      content: 'Mbak besok pagi jangan lupa ya',
    });

    expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
    expect(staffPushSpy).not.toHaveBeenCalled();
  });

  it('Customer ditugaskan ke staf non-aktif (active: false): Staf menerima 0 push', async () => {
    const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
    const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 0, failed: 0 });

    (prisma.reservation.findFirst as any).mockResolvedValueOnce({
      assigned_staff_id: 'staff_inactive',
      assigned_staff: {
        id: 'staff_inactive',
        name: 'Bidan Resign',
        active: false,
      },
    });

    await inboundNotificationRouter.routeInboundMessage({
      tenantId,
      conversationId: 'conv-inactive',
      customerId: 'cust-inactive-staff',
      senderName: 'Bunda Rini',
      content: 'Halo mbak',
    });

    expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
    expect(staffPushSpy).not.toHaveBeenCalled();
  });

  it('DB offline / error: Sistem tidak crash dan menangani secara graceful', async () => {
    const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
    (prisma.reservation.findFirst as any).mockRejectedValueOnce(new Error('Database offline'));

    await expect(
      inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-err',
        customerId: 'cust-err',
        senderName: 'Bunda Error',
        content: 'Tes error DB',
      })
    ).resolves.not.toThrow();

    expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
  });
});

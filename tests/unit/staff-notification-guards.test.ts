import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inboundNotificationRouter } from '../../src/services/inbound-notification-router.service';
import { staffNotificationService } from '../../src/services/staff-notification.service';
import { webPushService } from '../../src/services/web-push.service';
import { telegramService } from '../../src/services/telegram.service';
import { prisma } from '../../src/db/client';
import * as staffChatConfig from '../../src/config/staff-chat-config';
import * as staffNotifConfig from '../../src/config/staff-notification-config';

/**
 * Mandat In-System PWA Only — Gerbang Deterministik Anti-Kebocoran Notifikasi Terapis.
 *
 * Menguji 3 lapis fondasional (bukan pencocokan teks pesan):
 * 1. Router inbound: kanal staf HANYA aktif saat percakapan dipegang manusia (is_human_handling).
 * 2. Kill-switch Telegram eksternal DEFAULT OFF (tenant-aware), dan tetap tunduk pada jendela chat.
 * 3. Fail-closed saat status percakapan tak dapat dipastikan (DB offline) → jangan spam terapis.
 */
describe('Staff Notification Guards — In-System PWA Only', () => {
  const tenantId = 'tenant-guard-test';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockActiveReservation() {
    (prisma.reservation.findFirst as any).mockResolvedValueOnce({
      assigned_staff_id: 'staff-hanifah',
      booking_date: new Date(Date.now() + 60 * 60 * 1000),
      status: 'confirmed',
      purchase_occurred_at: null,
      updated_at: new Date(),
      assigned_staff: { id: 'staff-hanifah', name: 'Bidan Hanifah', active: true },
    });
  }

  describe('InboundNotificationRouter — gate is_human_handling', () => {
    it('Bot AI sedang membalas (is_human_handling=false): Staf menerima 0 push', async () => {
      const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });
      vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(true);

      mockActiveReservation();
      (prisma.conversation.findUnique as any).mockResolvedValueOnce({
        is_human_handling: false,
        current_state: 'ASKING_LOCATION',
      });

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-bot',
        customerId: 'cust-bot',
        senderName: 'Bunda Bot',
        content: 'berapa harganya?',
      });

      expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
      expect(staffPushSpy).not.toHaveBeenCalled();
    });

    it('Percakapan dieskalasi ke manusia: Staf menerima 1 push', async () => {
      vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });
      vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(true);

      mockActiveReservation();
      (prisma.conversation.findUnique as any).mockResolvedValueOnce({
        is_human_handling: true,
        current_state: 'HUMAN_HANDLING',
      });

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-human',
        customerId: 'cust-human',
        senderName: 'Bunda Manusia',
        content: 'mbak saya mau tanya langsung',
      });

      expect(staffPushSpy).toHaveBeenCalledTimes(1);
      expect(staffPushSpy).toHaveBeenCalledWith(
        'staff-hanifah',
        tenantId,
        expect.objectContaining({ url: '/admin/staff/today' })
      );
    });

    it('is_human_handling=false TAPI current_state=HUMAN_HANDLING → tetap dianggap human handling', async () => {
      vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });
      vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(true);

      mockActiveReservation();
      (prisma.conversation.findUnique as any).mockResolvedValueOnce({
        is_human_handling: false,
        current_state: 'HUMAN_HANDLING',
      });

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-state',
        customerId: 'cust-state',
        senderName: 'Bunda State',
        content: 'halo',
      });

      expect(staffPushSpy).toHaveBeenCalledTimes(1);
    });

    it('Status percakapan tak dapat dipastikan (DB offline): fail-closed, Staf 0 push', async () => {
      const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });
      vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(true);

      mockActiveReservation();
      (prisma.conversation.findUnique as any).mockRejectedValueOnce(new Error('Database offline'));

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-offline',
        customerId: 'cust-offline',
        senderName: 'Bunda Offline',
        content: 'tes',
      });

      // Admin tetap dapat (kanal CRM), staf TIDAK (fail-closed: jangan spam saat status tak pasti).
      expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
      expect(staffPushSpy).not.toHaveBeenCalled();
    });

    it('Jadwal selesai & di luar jendela chat: Staf 0 push meski human handling', async () => {
      vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });
      vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(true);

      // Jadwal HARI KEMARIN yang sudah selesai → jendela chat tertutup absolut
      // (PREVIOUS_DAY) → deterministik tanpa bergantung jam eksekusi test.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      (prisma.reservation.findFirst as any).mockResolvedValueOnce({
        assigned_staff_id: 'staff-hanifah',
        booking_date: yesterday,
        status: 'completed',
        purchase_occurred_at: yesterday,
        updated_at: yesterday,
        assigned_staff: { id: 'staff-hanifah', name: 'Bidan Hanifah', active: true },
      });
      (prisma.conversation.findUnique as any).mockResolvedValueOnce({
        is_human_handling: true,
        current_state: 'HUMAN_HANDLING',
      });

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-completed',
        customerId: 'cust-completed',
        senderName: 'Bunda Selesai',
        content: 'terima kasih',
      });

      expect(staffPushSpy).not.toHaveBeenCalled();
    });
  });

  describe('StaffNotificationService — kill-switch Telegram eksternal (tenant-aware)', () => {
    function mockAssignment() {
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'staff-rina',
        name: 'Bidan Rina',
        telegram_chat_id: '99887766',
        tenant_id: 'default-tenant',
      });
      (prisma.reservation.findUnique as any).mockResolvedValue({
        id: 'res-guard',
        treatment_detail: 'Pijat Bayi',
        booking_date: new Date(),
        status: 'confirmed',
        purchase_value: 100000,
        customer: {
          id: 'cust-guard',
          name: 'Bunda Guard',
          phone: '628111111111',
          kelurahan: 'Kebraon',
          preferences: {},
          children: [],
        },
        children: [],
      } as any);
    }

    it('Default OFF (telegramEnabled=false): Telegram TIDAK ditembakkan', async () => {
      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });
      vi.spyOn(staffNotifConfig, 'getStaffNotificationConfig').mockResolvedValue({ telegramEnabled: false });
      mockAssignment();

      const res = await staffNotificationService.sendReservationAssignmentNotification('res-guard', 'staff-rina');

      expect(sendSpy).not.toHaveBeenCalled();
      expect(res.sent).toBe(false);
      expect(res.reason).toContain('disabled');
    });

    it('Diaktifkan eksplisit (telegramEnabled=true): Telegram ditembakkan', async () => {
      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });
      vi.spyOn(staffNotifConfig, 'getStaffNotificationConfig').mockResolvedValue({ telegramEnabled: true });
      mockAssignment();

      const res = await staffNotificationService.sendReservationAssignmentNotification('res-guard', 'staff-rina');

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(res.sent).toBe(true);
    });

    it('Briefing pagi massal: telegramEnabled=false → 0 panggilan Telegram & tidak menyentuh DB staf', async () => {
      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });
      const staffFindManySpy = vi.spyOn(prisma.staff, 'findMany');
      vi.spyOn(staffNotifConfig, 'getStaffNotificationConfig').mockResolvedValue({ telegramEnabled: false });

      const stats = await staffNotificationService.sendAllStaffMorningBriefings('default-tenant');

      expect(sendSpy).not.toHaveBeenCalled();
      expect(staffFindManySpy).not.toHaveBeenCalled();
      expect(stats.totalStaff).toBe(0);
    });

    it('sendStaffDailyBriefing: telegramEnabled=false → tidak kirim meski chat_id terpasang', async () => {
      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });
      (prisma.staff.findUnique as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Siti',
        telegram_chat_id: '123456',
        tenant_id: 'default-tenant',
        active: true,
      });
      vi.spyOn(staffNotifConfig, 'getStaffNotificationConfig').mockResolvedValue({ telegramEnabled: false });

      const res = await staffNotificationService.sendStaffDailyBriefing('staff-1');

      expect(sendSpy).not.toHaveBeenCalled();
      expect(res.sent).toBe(false);
    });
  });
});

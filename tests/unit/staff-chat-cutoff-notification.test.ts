import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StaffReservationService,
  evaluateChatWindowForBooking,
  getWibStartOfDay,
} from '../../src/services/staff-reservation.service';
import { inboundNotificationRouter } from '../../src/services/inbound-notification-router.service';
import { webPushService } from '../../src/services/web-push.service';
import { prisma } from '../../src/db/client';
import * as staffChatConfig from '../../src/config/staff-chat-config';
import { clearStaffChatWindowConfigCache } from '../../src/config/staff-chat-window-config';

const HOUR = 60 * 60 * 1000;

/**
 * Jendela akses chat terapis: H-3 jam sebelum treatment s/d +3 jam setelah selesai,
 * ditutup total saat pergantian hari WIB. Supervisor selalu punya akses.
 *
 * Pengujian memakai waktu ter-inject (deterministik, bebas jam berjalan) untuk
 * kasus batas, plus integrasi service/router untuk memastikan gate benar-benar
 * terpasang di jalur nyata (bukan hanya fungsi murni).
 */
describe('Staff Chat Window Lifecycle (H-3 jam s/d +3 jam, cut ganti hari)', () => {
  // 12:00 WIB (05:00 UTC) — aman dari batas tengah malam.
  const NOW = new Date('2026-09-26T05:00:00.000Z');
  const BOOKING_TODAY = new Date('2026-09-26T05:00:00.000Z'); // 12:00 WIB

  describe('evaluateChatWindowForBooking (fungsi murni, batas deterministik)', () => {
    it('H-5 jam sebelum jadwal -> tertutup (NOT_YET_OPEN)', () => {
      const now = new Date(BOOKING_TODAY.getTime() - 5 * HOUR);
      const s = evaluateChatWindowForBooking(BOOKING_TODAY, { now });
      expect(s.open).toBe(false);
      expect(s.reason).toBe('NOT_YET_OPEN');
    });

    it('tepat H-3 jam sebelum jadwal -> terbuka (batas inklusif)', () => {
      const now = new Date(BOOKING_TODAY.getTime() - 3 * HOUR);
      const s = evaluateChatWindowForBooking(BOOKING_TODAY, { now });
      expect(s.open).toBe(true);
      expect(s.reason).toBe('OPEN');
    });

    it('H-2 jam sebelum jadwal -> terbuka', () => {
      const now = new Date(BOOKING_TODAY.getTime() - 2 * HOUR);
      expect(evaluateChatWindowForBooking(BOOKING_TODAY, { now }).open).toBe(true);
    });

    it('1 jam pasca treatment selesai -> masih terbuka', () => {
      const now = new Date(BOOKING_TODAY.getTime() + 3 * HOUR);
      const completedAt = new Date(now.getTime() - 1 * HOUR);
      const s = evaluateChatWindowForBooking(BOOKING_TODAY, { now, completedAt });
      expect(s.open).toBe(true);
      expect(s.reason).toBe('OPEN');
    });

    it('tepat +3 jam pasca selesai -> masih terbuka (batas inklusif)', () => {
      const now = new Date(BOOKING_TODAY.getTime() + 4 * HOUR);
      const completedAt = new Date(now.getTime() - 3 * HOUR);
      expect(evaluateChatWindowForBooking(BOOKING_TODAY, { now, completedAt }).open).toBe(true);
    });

    it('4 jam pasca treatment selesai -> tertutup (CLOSED_AFTER_COMPLETE)', () => {
      const now = new Date(BOOKING_TODAY.getTime() + 4 * HOUR);
      const completedAt = new Date(now.getTime() - 4 * HOUR);
      const s = evaluateChatWindowForBooking(BOOKING_TODAY, { now, completedAt });
      expect(s.open).toBe(false);
      expect(s.reason).toBe('CLOSED_AFTER_COMPLETE');
    });

    it('jadwal kemarin (ganti hari) -> tertutup total (PREVIOUS_DAY)', () => {
      const yesterdayBooking = new Date(NOW.getTime() - 24 * HOUR);
      const s = evaluateChatWindowForBooking(yesterdayBooking, { now: NOW });
      expect(s.open).toBe(false);
      expect(s.reason).toBe('PREVIOUS_DAY');
    });

    it('cut ganti hari menang atas +3 jam: selesai 23:30 WIB, cek 00:30 WIB -> tertutup', () => {
      // Booking 26 Sep 23:30 WIB = 16:30 UTC; selesai 23:35 WIB; cek 27 Sep 00:30 WIB = 17:30 UTC 26 Sep? gunakan UTC eksplisit
      const booking = new Date('2026-09-26T16:30:00.000Z'); // 23:30 WIB
      const completedAt = new Date('2026-09-26T16:35:00.000Z'); // 23:35 WIB
      const now = new Date('2026-09-26T17:30:00.000Z'); // 00:30 WIB 27 Sep
      const s = evaluateChatWindowForBooking(booking, { now, completedAt });
      expect(s.open).toBe(false);
      expect(s.reason).toBe('PREVIOUS_DAY');
    });

    it('supervisor selalu terbuka walau jadwal kemarin', () => {
      const yesterdayBooking = new Date(NOW.getTime() - 24 * HOUR);
      const s = evaluateChatWindowForBooking(yesterdayBooking, { now: NOW, isSupervisor: true });
      expect(s.open).toBe(true);
      expect(s.reason).toBe('SUPERVISOR');
    });

    it('config tenant-aware mengubah lebar jendela buka (openHoursBefore=1)', () => {
      // 2 jam sebelum jadwal: config 3 jam -> sudah buka; config 1 jam -> belum buka.
      const now = new Date(BOOKING_TODAY.getTime() - 2 * HOUR);
      const openWithThreeHours = evaluateChatWindowForBooking(BOOKING_TODAY, { now, config: { openHoursBefore: 3, closeHoursAfter: 3 } });
      const closedWithOneHour = evaluateChatWindowForBooking(BOOKING_TODAY, { now, config: { openHoursBefore: 1, closeHoursAfter: 3 } });
      expect(openWithThreeHours.open).toBe(true);
      expect(closedWithOneHour.open).toBe(false);
      expect(closedWithOneHour.reason).toBe('NOT_YET_OPEN');
    });

    it('getWibStartOfDay menghasilkan 00:00 WIB sebagai instant UTC yang benar', () => {
      const sod = getWibStartOfDay(new Date('2026-09-26T05:00:00.000Z'));
      expect(sod.toISOString()).toBe('2026-09-25T17:00:00.000Z');
    });
  });

  describe('assertConversationOwnedByStaffToday (integrasi gate)', () => {
    const tenantId = 'tenant-chat-window';

    beforeEach(() => {
      vi.clearAllMocks();
      clearStaffChatWindowConfigCache();
    });

    function mockConversation() {
      (prisma.conversation.findUnique as any).mockResolvedValue({
        customer_id: 'cust-1',
        tenant_id: tenantId,
      });
    }

    it('H-2 jam sebelum jadwal hari ini -> akses chat dibuka (true)', async () => {
      mockConversation();
      const booking = new Date(Date.now() + 2 * HOUR);
      (prisma.reservation.findMany as any).mockResolvedValue([
        { id: 'r-1', booking_date: booking, status: 'confirmed', purchase_occurred_at: null, updated_at: new Date() },
      ]);

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-1', tenantId);
      expect(owned).toBe(true);
    });

    it('jadwal 5 jam lagi (belum H-3) -> akses chat ditutup (false)', async () => {
      mockConversation();
      const booking = new Date(Date.now() + 5 * HOUR);
      (prisma.reservation.findMany as any).mockResolvedValue([
        { id: 'r-1', booking_date: booking, status: 'confirmed', purchase_occurred_at: null, updated_at: new Date() },
      ]);

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-1', tenantId);
      expect(owned).toBe(false);
    });

    it('selesai 1 jam lalu -> akses chat masih dibuka (true)', async () => {
      mockConversation();
      const completedAt = new Date(Date.now() - 1 * HOUR);
      (prisma.reservation.findMany as any).mockResolvedValue([
        { id: 'r-1', booking_date: new Date(Date.now() - 2 * HOUR), status: 'completed', purchase_occurred_at: completedAt, updated_at: completedAt },
      ]);

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-1', tenantId);
      expect(owned).toBe(true);
    });

    it('selesai 4 jam lalu -> akses chat ditutup (false)', async () => {
      mockConversation();
      const completedAt = new Date(Date.now() - 4 * HOUR);
      (prisma.reservation.findMany as any).mockResolvedValue([
        { id: 'r-1', booking_date: new Date(Date.now() - 5 * HOUR), status: 'completed', purchase_occurred_at: completedAt, updated_at: completedAt },
      ]);

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-1', tenantId);
      expect(owned).toBe(false);
    });

    it('jadwal kemarin (ganti hari) -> akses chat ditutup total (false)', async () => {
      mockConversation();
      (prisma.reservation.findMany as any).mockResolvedValue([
        { id: 'r-1', booking_date: new Date(Date.now() - 25 * HOUR), status: 'completed', purchase_occurred_at: new Date(Date.now() - 24 * HOUR), updated_at: new Date() },
      ]);

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-1', tenantId);
      expect(owned).toBe(false);
    });

    it('supervisor -> selalu true walau di luar jendela', async () => {
      (prisma.conversation.findUnique as any).mockResolvedValue({
        customer_id: 'cust-1',
        tenant_id: tenantId,
      });

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'spv-1', tenantId, true);
      expect(owned).toBe(true);
      // Supervisor tidak perlu query kandidat jadwal
      expect(prisma.reservation.findMany).not.toHaveBeenCalled();
    });

    it('tanpa kandidat reservasi -> false', async () => {
      mockConversation();
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday('conv-1', 'staff-1', tenantId);
      expect(owned).toBe(false);
    });
  });

  describe('InboundNotificationRouter — gate jendela chat pada push staf', () => {
    const tenantId = 'tenant-chat-window-router';

    beforeEach(() => {
      vi.clearAllMocks();
      clearStaffChatWindowConfigCache();
      vi.spyOn(staffChatConfig, 'isWithinWibHourRange').mockReturnValue(true);
    });

    it('jadwal 5 jam lagi: push staf dibatalkan, push admin tetap terkirim', async () => {
      const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });

      (prisma.reservation.findFirst as any).mockResolvedValueOnce({
        assigned_staff_id: 'staff-1',
        booking_date: new Date(Date.now() + 5 * HOUR),
        status: 'confirmed',
        purchase_occurred_at: null,
        updated_at: new Date(),
        assigned_staff: { id: 'staff-1', name: 'Bidan A', active: true },
      });

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-early',
        customerId: 'cust-early',
        senderName: 'Bunda Early',
        content: 'Halo, saya mau tanya',
      });

      expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
      expect(staffPushSpy).not.toHaveBeenCalled();
    });

    it('selesai 4 jam lalu: push staf dibatalkan, push admin tetap terkirim', async () => {
      const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });

      const completedAt = new Date(Date.now() - 4 * HOUR);
      (prisma.reservation.findFirst as any).mockResolvedValueOnce({
        assigned_staff_id: 'staff-1',
        booking_date: new Date(Date.now() - 5 * HOUR),
        status: 'completed',
        purchase_occurred_at: completedAt,
        updated_at: completedAt,
        assigned_staff: { id: 'staff-1', name: 'Bidan A', active: true },
      });

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-done',
        customerId: 'cust-done',
        senderName: 'Bunda Done',
        content: 'Terima kasih ya',
      });

      expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
      expect(staffPushSpy).not.toHaveBeenCalled();
    });

    it('H-2 jam sebelum jadwal: push staf terkirim', async () => {
      const adminPushSpy = vi.spyOn(webPushService, 'sendPushToRole').mockResolvedValue({ sent: 1, failed: 0 });
      const staffPushSpy = vi.spyOn(webPushService, 'sendPushToStaff').mockResolvedValue({ sent: 1, failed: 0 });

      (prisma.reservation.findFirst as any).mockResolvedValueOnce({
        assigned_staff_id: 'staff-1',
        booking_date: new Date(Date.now() + 2 * HOUR),
        status: 'confirmed',
        purchase_occurred_at: null,
        updated_at: new Date(),
        assigned_staff: { id: 'staff-1', name: 'Bidan A', active: true },
      });

      await inboundNotificationRouter.routeInboundMessage({
        tenantId,
        conversationId: 'conv-window',
        customerId: 'cust-window',
        senderName: 'Bunda Window',
        content: 'Mbak sudah dekat?',
      });

      expect(adminPushSpy).toHaveBeenCalledWith(tenantId, 'ADMIN', expect.any(Object));
      expect(staffPushSpy).toHaveBeenCalledTimes(1);
    });
  });
});

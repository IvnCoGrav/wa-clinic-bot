import { prisma } from '../db/client';
import { telegramService } from './telegram.service';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { webPushService } from './web-push.service';
import { getLiveChatHub } from './live-chat-hub.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getStaffNotificationConfig } from '../config/staff-notification-config';
import { staffNotificationFormatterService } from './staff-notification-formatter.service';

/**
 * F3.6d — Notifikasi event reservasi (pembatalan & pengalihan staf).
 * Dipisah dari staff-notification.service; facade publik tetap dipertahankan.
 */
export class StaffNotificationEventsService {
  private escapeMarkdown(text: string): string {
    return staffNotificationFormatterService.escapeMarkdown(text);
  }

  async sendReservationCancelledNotification(
    reservationId: string,
    staffId: string,
    reason?: string
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      if (!staffId || !reservationId) return { sent: false, reason: 'staffId/reservationId kosong' };
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, name: true, telegram_chat_id: true, tenant_id: true },
      });
      if (!staff) {
        return { sent: false, reason: 'Staff tidak ditemukan' };
      }
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { customer: { include: { children: true } }, children: true },
      });
      if (!reservation) return { sent: false, reason: 'Reservasi tidak ditemukan' };
      const cust: any = reservation.customer;
      if (cust?.is_sandbox_test || isDummyOrTestContact(cust?.phone, cust?.name, cust?.is_sandbox_test)) {
        return { sent: false, reason: 'Sandbox test reservation (notifikasi dinonaktifkan)' };
      }

      const tenantId = staff.tenant_id || DEFAULT_TENANT_ID;
      const treatmentDetail = this.escapeMarkdown(reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare');
      const custName = this.escapeMarkdown(cust?.name || 'Bunda');

      // 1. In-System Realtime SSE Broadcast
      try {
        getLiveChatHub().publish({
          type: 'staff.task_cancelled',
          tenantId,
          payload: {
            staffId: staff.id,
            reservationId: reservation.id,
            reason: reason || 'Reservasi dibatalkan',
          },
        });
      } catch (hubErr: any) {
        console.warn(`[StaffNotificationService] SSE task_cancelled broadcast error:`, hubErr.message);
      }

      // 2. In-System Web Push PWA
      try {
        await webPushService.sendPushToStaff(staff.id, tenantId, {
          title: 'Jadwal Kunjungan Dibatalkan ❌',
          body: `Jadwal ${custName} (${treatmentDetail}) dibatalkan.${reason ? ' Alasan: ' + reason : ''}`,
          url: '/admin/staff/today',
          tag: `staff_task_cancel_${reservation.id}`,
          icon: '/admin/icon-192.png',
          badge: '/admin/favicon.ico',
          data: {
            reservationId: reservation.id,
            staffId: staff.id,
            url: '/admin/staff/today',
          },
        });
      } catch (pushErr: any) {
        console.warn(`[StaffNotificationService] Web Push task_cancelled error:`, pushErr.message);
      }

      // 3. Optional External Telegram (Mandat In-System PWA Only: DEFAULT OFF, tenant-aware)
      const cancelNotifConfig = await getStaffNotificationConfig(tenantId);
      if (cancelNotifConfig.telegramEnabled && staff.telegram_chat_id) {
        const addressParts: string[] = [];
        if (cust?.kelurahan) addressParts.push(`Kel. ${this.escapeMarkdown(cust.kelurahan)}`);
        if (cust?.kecamatan) addressParts.push(`Kec. ${cust.kecamatan}`);
        if (cust?.kota) addressParts.push(this.escapeMarkdown(cust.kota));
        const addressText = addressParts.join(', ') || 'Alamat belum tercatat lengkap';
        const bookingDate = reservation.booking_date ? new Date(reservation.booking_date) : null;
        const dateStr = bookingDate
          ? bookingDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
          : 'Tanggal belum ditentukan';
        const timeStr = bookingDate
          ? bookingDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
          : '-';
        const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin';
        const portalUrl = `${baseUrl}/staff/today`;
        const messageText = staffNotificationFormatterService.formatCancellationTelegramMessage({
          staffName: staff.name,
          patientName: custName,
          treatmentDetail,
          dateStr,
          timeStr,
          addressText,
          reason,
          portalUrl,
        });

        try {
          await telegramService.sendMessage({ chatId: staff.telegram_chat_id, text: messageText, parseMode: 'Markdown' });
        } catch (tgErr: any) {
          console.warn(`[StaffNotificationService] Telegram cancel notification error:`, tgErr.message);
        }
      }

      return { sent: true };
    } catch (err: any) {
      console.error(`[StaffNotificationService] Failed to send cancelled notification to staff ${staffId}:`, err.message);
      return { sent: false, reason: err.message };
    }
  }

  async sendTaskUnassignedNotification(
    reservationId: string,
    oldStaffId: string,
    newStaffName?: string,
    notifyOldStaff: boolean = true
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      if (!oldStaffId || !reservationId) return { sent: false, reason: 'oldStaffId/reservationId kosong' };
      const staff = await prisma.staff.findUnique({
        where: { id: oldStaffId },
        select: { id: true, name: true, telegram_chat_id: true, tenant_id: true },
      });
      if (!staff) {
        return { sent: false, reason: 'Staff lama tidak ditemukan' };
      }
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { customer: { select: { name: true, phone: true, is_sandbox_test: true } } },
      });
      if (!reservation) return { sent: false, reason: 'Reservasi tidak ditemukan' };
      const cust: any = reservation.customer;
      if (cust?.is_sandbox_test || isDummyOrTestContact(cust?.phone, cust?.name, cust?.is_sandbox_test)) {
        return { sent: false, reason: 'Sandbox test reservation (notifikasi dinonaktifkan)' };
      }

      const tenantId = staff.tenant_id || DEFAULT_TENANT_ID;
      const treatmentDetail = this.escapeMarkdown(reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare');
      const custName = this.escapeMarkdown(cust?.name || 'Bunda');

      // 1. In-System Realtime SSE Broadcast (task_cancelled for old staff so their list refreshes)
      try {
        getLiveChatHub().publish({
          type: 'staff.task_cancelled',
          tenantId,
          payload: {
            staffId: oldStaffId,
            reservationId: reservation.id,
            reason: newStaffName ? `Dialihkan ke ${newStaffName}` : 'Dialihkan ke staf lain',
          },
        });
      } catch (hubErr: any) {
        console.warn(`[StaffNotificationService] SSE task_cancelled broadcast error:`, hubErr.message);
      }

      // 2. In-System Web Push PWA — HANYA bila staf lama benar-benar sudah menerima
      // notifikasi penugasan (state-gated). Reassign di dalam jendela buffer (pending
      // dibatalkan) → senyap total ke staf lama, cukup SSE yang menyegarkan daftar.
      if (notifyOldStaff) {
        try {
          await webPushService.sendPushToStaff(oldStaffId, tenantId, {
            title: 'Jadwal Dialihkan 🔄',
            body: `Jadwal kunjungan ${custName} telah dialihkan${newStaffName ? ' ke ' + newStaffName : ''}.`,
            url: '/admin/staff/today',
            tag: `staff_task_reassign_${reservation.id}`,
            icon: '/admin/icon-192.png',
            badge: '/admin/favicon.ico',
          });
        } catch (pushErr: any) {
          console.warn(`[StaffNotificationService] Web Push task_cancelled error:`, pushErr.message);
        }
      }

      // 3. Optional External Telegram — gate yang sama dengan Web Push.
      // Mandat In-System PWA Only: DEFAULT OFF, tenant-aware.
      const unassignNotifConfig = await getStaffNotificationConfig(tenantId);
      if (notifyOldStaff && unassignNotifConfig.telegramEnabled && staff.telegram_chat_id) {
        const bookingDate = reservation.booking_date ? new Date(reservation.booking_date) : null;
        const dateStr = bookingDate
          ? bookingDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
          : 'Tanggal belum ditentukan';
        const timeStr = bookingDate
          ? bookingDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
          : '-';
        const newStaffLabel = newStaffName ? ` ke *${this.escapeMarkdown(newStaffName)}*` : ' ke rekan terapis lain';
        const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin';
        const portalUrl = `${baseUrl}/#staff-today`;
        const messageText = staffNotificationFormatterService.formatUnassignedTelegramMessage({
          staffName: staff.name,
          newStaffLabel,
          patientName: custName,
          treatmentDetail,
          dateStr,
          timeStr,
          portalUrl,
        });

        try {
          await telegramService.sendMessage({ chatId: staff.telegram_chat_id, text: messageText, parseMode: 'Markdown' });
        } catch (tgErr: any) {
          console.warn(`[StaffNotificationService] Telegram unassigned notification error:`, tgErr.message);
        }
      }

      return { sent: true };
    } catch (err: any) {
      console.error(`[StaffNotificationService] Failed to send unassigned notification to staff ${oldStaffId}:`, err.message);
      return { sent: false, reason: err.message };
    }
  }
}

export const staffNotificationEventsService = new StaffNotificationEventsService();

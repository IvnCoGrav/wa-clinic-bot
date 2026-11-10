import { prisma } from '../db/client';
import { telegramService } from './telegram.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getStaffNotificationConfig } from '../config/staff-notification-config';
import { staffNotificationFormatterService } from './staff-notification-formatter.service';

/**
 * F3.6d — Briefing jadwal harian (teks, rentang hari WIB, pengiriman per staf).
 * Dipisah dari staff-notification.service; facade publik tetap dipertahankan.
 */
export class StaffNotificationBriefingService {
  /** Menyusun pesan Markdown Briefing Jadwal Harian Bidan/Terapis. */
  generateDailyBriefingText(
    staffName: string,
    formattedDate: string,
    reservations: any[]
  ): string {
    return staffNotificationFormatterService.formatDailyBriefingMessage(
      staffName,
      formattedDate,
      reservations
    );
  }

  /** Menghitung rentang waktu 00:00:00 s/d 23:59:59 dalam zona waktu WIB. */
  getWibDayRange(targetDate: Date = new Date()): {
    startOfDay: Date;
    endOfDay: Date;
    dateStr: string;
    formattedDate: string;
  } {
    const wibMs = targetDate.getTime() + 7 * 60 * 60 * 1000;
    const wibDate = new Date(wibMs);
    const year = wibDate.getUTCFullYear();
    const month = wibDate.getUTCMonth();
    const day = wibDate.getUTCDate();

    // 00:00:00.000 WIB dinyatakan dalam UTC adalah -7 jam
    const startOfDay = new Date(Date.UTC(year, month, day, -7, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month, day, 16, 59, 59, 999));

    const formattedDate = targetDate.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });

    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;

    return { startOfDay, endOfDay, dateStr, formattedDate };
  }

  /** Mengirimkan briefing jadwal harian ke 1 staf/bidan spesifik. */
  async sendStaffDailyBriefing(
    staffId: string,
    targetDate: Date = new Date()
  ): Promise<{ sent: boolean; reason?: string; count?: number }> {
    try {
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, name: true, telegram_chat_id: true, tenant_id: true, active: true },
      });

      if (!staff || !staff.telegram_chat_id) {
        return { sent: false, reason: 'Staff belum menghubungkan akun Telegram pribadi', count: 0 };
      }

      if (staff.active === false) {
        return { sent: false, reason: 'Akun staff nonaktif', count: 0 };
      }

      // Mandat In-System PWA Only: briefing Telegram eksternal DEFAULT OFF (tenant-aware).
      const briefingNotifConfig = await getStaffNotificationConfig(staff.tenant_id || DEFAULT_TENANT_ID);
      if (!briefingNotifConfig.telegramEnabled) {
        return { sent: false, reason: 'External Telegram disabled (In-System PWA Mandate)', count: 0 };
      }

      const { startOfDay, endOfDay, formattedDate } = this.getWibDayRange(targetDate);

      const reservations = await prisma.reservation.findMany({
        where: {
          tenant_id: staff.tenant_id,
          assigned_staff_id: staff.id,
          status: { notIn: ['cancelled', 'CANCELLED'] },
          booking_date: {
            gte: startOfDay,
            lte: endOfDay,
          },
          customer: {
            is_sandbox_test: false,
          },
        },
        include: {
          customer: {
            include: {
              children: true,
            },
          },
          children: true,
          customer_address: true,
        },
        orderBy: {
          booking_date: 'asc',
        },
      });

      if (!reservations.length) {
        return { sent: false, reason: 'Tidak ada jadwal kunjungan untuk tanggal ini', count: 0 };
      }

      const messageText = this.generateDailyBriefingText(staff.name, formattedDate, reservations);

      const res = await telegramService.sendMessage({
        chatId: staff.telegram_chat_id,
        text: messageText,
        parseMode: 'Markdown',
      });

      return { sent: res.ok, reason: res.description, count: reservations.length };
    } catch (err: any) {
      console.error(`[StaffNotificationService] Error sending daily briefing to staff ${staffId}:`, err.message);
      return { sent: false, reason: err.message, count: 0 };
    }
  }
}

export const staffNotificationBriefingService = new StaffNotificationBriefingService();

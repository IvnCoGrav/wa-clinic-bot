import { prisma } from '../db/client';
import { telegramService } from './telegram.service';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { webPushService } from './web-push.service';
import { getLiveChatHub } from './live-chat-hub.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getStaffNotificationConfig } from '../config/staff-notification-config';
import { buildMapsUrls, buildEffectiveTaskAddress } from './staff-reservation.service';
import { getPaymentDisplayStatus } from '../domain/reservation-payment';
import crypto from 'crypto';
import { staffNotificationFormatterService } from './staff-notification-formatter.service';
import { staffPreVisitBriefService } from './staff-notification-previsit.service';
import { staffNotificationEventsService } from './staff-notification-events.service';
import { staffNotificationBriefingService } from './staff-notification-briefing.service';
import dotenv from 'dotenv';
dotenv.config();

export interface StaffTelegramPairingInfo {
  staffId: string;
  staffName: string;
  pairingToken: string;
  directLink: string;
  isConnected: boolean;
  telegramChatId: string | null;
  botUsername: string;
}

/**
 * Buffer notifikasi penugasan terapis (menit). Admin dapat mengoreksi salah pilih
 * terapis/jam dalam jendela ini sebelum Telegram benar-benar terkirim ke terapis.
 * TODO(tenant-aware): pindahkan ke konfigurasi per-tenant (mis. TenantNotificationConfig)
 * bila tenant berbeda butuh delay berbeda — lihat docs/SAAS_READINESS_AUDIT.md.
 */
const ASSIGNMENT_NOTIFICATION_DELAY_MINUTES = 5;

export class StaffNotificationService {
  /**
   * Mengambil atau membuat token pairing Telegram unik untuk profil staf/terapis
   */
  async getStaffPairingInfo(staffId: string): Promise<StaffTelegramPairingInfo | null> {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) return null;

    let token = staff.telegram_pairing_token;
    if (!token) {
      token = `staff_PAIR_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      try {
        await prisma.staff.update({
          where: { id: staffId },
          data: { telegram_pairing_token: token },
        });
      } catch (err: any) {
        const fresh = await prisma.staff.findUnique({ where: { id: staffId } });
        token = fresh?.telegram_pairing_token || token;
      }
    }

    const botUsername = (process.env.TELEGRAM_BOT_USERNAME || 'KalaReport_bot').replace(/^@/, '');
    const directLink = `https://t.me/${botUsername}?start=${token}`;

    return {
      staffId: staff.id,
      staffName: staff.name,
      pairingToken: token,
      directLink,
      isConnected: Boolean(staff.telegram_chat_id),
      telegramChatId: staff.telegram_chat_id || null,
      botUsername,
    };
  }

  /**
   * Reset / buat ulang token pairing untuk staf tertentu
   */
  async regenerateStaffPairingToken(staffId: string): Promise<StaffTelegramPairingInfo | null> {
    const newToken = `staff_PAIR_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    await prisma.staff.update({
      where: { id: staffId },
      data: { telegram_pairing_token: newToken },
    });
    return this.getStaffPairingInfo(staffId);
  }

  /**
   * Mengirimkan notifikasi penugasan reservasi ke akun Telegram pribadi terapis/bidan
   * Catatan Privasi: Nomor telepon WhatsApp pasien TIDAK disertakan demi keamanan data perusahaan.
   * Sebagai gantinya disediakan link langsung ke portal staf internal.
   */
  async sendReservationAssignmentNotification(
    reservationId: string,
    staffId: string
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, name: true, telegram_chat_id: true, tenant_id: true },
      });

      if (!staff) {
        return { sent: false, reason: 'Staff tidak ditemukan' };
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: {
            include: {
              children: true,
            },
          },
          children: true,
          customer_address: true,
          items: true,
        },
      });

      if (!reservation) {
        return { sent: false, reason: 'Reservasi tidak ditemukan' };
      }

      const cust = reservation.customer;

      // Jangan kirim notifikasi penugasan jika reservasi berasal dari testing / sandbox
      if (cust?.is_sandbox_test || isDummyOrTestContact(cust?.phone, cust?.name, cust?.is_sandbox_test)) {
        return { sent: false, reason: 'Sandbox test reservation (notifikasi dinonaktifkan)' };
      }

      const tenantId = staff.tenant_id || DEFAULT_TENANT_ID;

      const allChildren = reservation.children?.length ? reservation.children : cust?.children || [];

      // 1. Format Nama Anak & Usia
      const childrenStr = allChildren
        .map((ch) => {
          const age = ch.raw_age_text ? ` (${ch.raw_age_text})` : '';
          return `${ch.name}${age}`;
        })
        .join(', ');

      // 2. Format Alamat Lengkap & Patokan Rumah (Fase 3C: prioritaskan CustomerAddress)
      // Fase 4 (A-005): seam kanonis buildEffectiveTaskAddress — alamat efektif yang
      // sama dipakai semua pembaca (Telegram/Sheets), termasuk prioritas koreksi rumah SAMA.
      const addrEntity = (reservation as any).customer_address;
      const effectiveAddr: any = buildEffectiveTaskAddress(addrEntity, cust) || {};
      const addressParts: string[] = [];
      if (effectiveAddr.address) addressParts.push(effectiveAddr.address);
      if (effectiveAddr.kelurahan) addressParts.push(`Kel. ${effectiveAddr.kelurahan}`);
      if (effectiveAddr.kecamatan) addressParts.push(`Kec. ${effectiveAddr.kecamatan}`);
      if (effectiveAddr.kota) addressParts.push(effectiveAddr.kota);
      const addressText = addressParts.join(', ') || 'Alamat belum tercatat lengkap';

      const landmark = effectiveAddr.landmark || (cust?.preferences as any)?.landmark || null;
      const housePhotoUrl = (cust?.preferences as any)?.house_photo_url || null;

      // 3. Format Waktu & Tanggal (WIB)
      const bookingDate = reservation.booking_date ? new Date(reservation.booking_date) : null;
      const dateStr = bookingDate
        ? bookingDate.toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Jakarta',
          })
        : 'Tanggal belum ditentukan';

      const timeStr = bookingDate
        ? bookingDate.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta',
          })
        : '-';

      // 4. Navigasi Google Maps Motor — REVISI-1 Tahap 3.1: seam kanonis
      // buildMapsUrls (source-aware, bukan template inline). Titik NON-presisi
      // + teks alamat → URL TEKS agar Bidan tidak diarahkan ke titik tengah
      // kelurahan/sawah. gps_pin → byte-identik perilaku lama.
      const lat = effectiveAddr?.lat ?? cust?.lat;
      const lng = effectiveAddr?.lng ?? cust?.lng;
      const hasAddressText = !!addressText && addressText !== 'Alamat belum tercatat lengkap';
      const { navigationUrl: seamNavUrl } = buildMapsUrls(
        lat, lng,
        effectiveAddr?.location_source ?? (cust as any)?.location_source ?? null,
        hasAddressText ? addressText : null
      );
      const navigationUrl =
        seamNavUrl ||
        (hasAddressText
          ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressText)}&travelmode=two-wheeler`
          : 'https://maps.google.com');

      // 5. Jarak Tempuh — Fase 4 (RC-6, KNOWN_ISSUES #138 G5): sumber resmi jarak klinik→pasien
      // adalah deliveryService.calculateDelivery (tenant-aware: ORS + fallback + tier DB), sehingga
      // angka konsisten dengan pipeline chatbot/refresh. Rumus lokal Haversine×1.6 dihapus.
      let distanceKm = addrEntity?.distance_km ?? cust?.distance_km ?? null;
      if (distanceKm == null && typeof lat === 'number' && typeof lng === 'number') {
        try {
          const { deliveryService } = await import('./delivery.service');
          const calc = await deliveryService.calculateDelivery({ lat, lng }, undefined, tenantId);
          distanceKm = calc?.distanceKm ?? null;
        } catch (_) {
          distanceKm = null;
        }
      }
      const distanceStr = distanceKm != null ? `${distanceKm} km` : null;

      // 6. Rincian Biaya & Status Bayar
      const purchaseValue = reservation.purchase_value || 0;
      const ongkir = reservation.delivery_fee ?? addrEntity?.ongkir ?? cust?.ongkir ?? 0;
      const totalFee = purchaseValue || (ongkir > 0 ? ongkir : 0);
      // Seam kanonis: jangan klaim "Transfer" tanpa bukti metode. completed
      // tanpa bayar → "SELESAI — BELUM VERIFIKASI BAYAR", bukan TAGIH.
      const paymentDisplayStatus = getPaymentDisplayStatus(reservation as any);
      const paymentStatusLabel =
        paymentDisplayStatus === 'LUNAS'
          ? 'LUNAS'
          : paymentDisplayStatus === 'SELESAI_BELUM_VERIFIKASI'
          ? 'SELESAI — BELUM VERIFIKASI BAYAR'
          : 'TAGIH DI TEMPAT (Cash/QRIS)';

      // 7. Catatan / Preferensi Pasien
      const notes = (cust?.preferences as any)?.allergies || (cust?.preferences as any)?.notes || null;

      // 8. Tautan Aman ke Portal Terapis (tanpa mengekspos nomor HP)
      const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin';
      const portalUrl = `${baseUrl}/staff/today`;

      // 9. Real-time In-System SSE Broadcast (LiveChatHub)
      try {
        getLiveChatHub().publish({
          type: 'staff.task_assigned',
          tenantId,
          payload: {
            staffId: staff.id,
            staffName: staff.name,
            reservationId: reservation.id,
            patientName: cust?.name || 'Bunda',
            treatmentDetail: reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare',
            bookingDate: reservation.booking_date,
            address: addressText,
          },
        });
      } catch (hubErr: any) {
        console.warn(`[StaffNotificationService] SSE task_assigned broadcast error:`, hubErr.message);
      }

      // Format Layanan terstruktur (Fase 3C)
      const treatmentDetail = (Array.isArray(reservation.items) && reservation.items.length > 0)
        ? reservation.items.map((it: any) => it.custom_name || it.name).filter(Boolean).join(' + ')
        : (reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare');

      // 10. Real-time In-System Web Push PWA (Service Worker)
      try {
        await webPushService.sendPushToStaff(staff.id, tenantId, {
          title: 'Tugas Kunjungan Baru 💆‍♀️',
          body: `${treatmentDetail} untuk ${cust?.name || 'Bunda'} (${dateStr} - ${timeStr} WIB)`,
          url: '/admin/staff/today',
          tag: `staff_task_${reservation.id}`,
          icon: '/admin/icon-192.png',
          badge: '/admin/favicon.ico',
          data: {
            reservationId: reservation.id,
            staffId: staff.id,
            url: '/admin/staff/today',
          },
        });
      } catch (pushErr: any) {
        console.warn(`[StaffNotificationService] Web Push task_assigned error:`, pushErr.message);
      }

      // 11. Optional External Telegram Notification
      // Mandat In-System PWA Only: Telegram ke akun pribadi terapis DEFAULT OFF.
      // Hanya dikirim bila tenant secara eksplisit mengaktifkan (settings.staffNotification.telegramEnabled).
      const notifConfig = await getStaffNotificationConfig(tenantId);
      if (notifConfig.telegramEnabled && staff.telegram_chat_id) {
        const messageText = staffNotificationFormatterService.formatAssignmentTelegramMessage({
          staffName: staff.name,
          patientName: cust?.name || 'Bunda',
          childrenStr,
          treatmentDetail,
          dateStr,
          timeStr,
          addressText,
          landmark,
          distanceStr,
          navigationUrl,
          totalFee,
          paymentStatusLabel,
          notes,
          portalUrl,
        });

        try {
          const res = await telegramService.sendMessage({
            chatId: staff.telegram_chat_id,
            text: messageText,
            parseMode: 'Markdown',
          });
          return { sent: res.ok, reason: res.description };
        } catch (tgErr: any) {
          console.warn(`[StaffNotificationService] Telegram assignment notification error:`, tgErr.message);
          return { sent: false, reason: tgErr.message };
        }
      }

      return { sent: false, reason: notifConfig.telegramEnabled
        ? 'Staff belum menghubungkan akun Telegram pribadi (notifikasi in-system PWA & SSE berhasil dikirim)'
        : 'External Telegram disabled (In-System PWA Mandate); notifikasi in-system PWA & SSE terkirim' };
    } catch (err: any) {
      console.error(`[StaffNotificationService] Failed to notify staff ${staffId}:`, err.message);
      return { sent: false, reason: err.message };
    }
  }

  /** Fase 5r — Trigger same-day Pre-Visit Brief (delegasi ke sub-service). */
  public triggerPreVisitBriefIfImminent(reservationId: string, tenantId: string): void {
    staffPreVisitBriefService.triggerPreVisitBriefIfImminent(reservationId, tenantId);
  }

  /** Fase 5r — Kirim Pre-Visit Brief (delegasi ke sub-service). */
  async sendPreVisitBrief(
    reservationId: string,
    tenantId: string
  ): Promise<{ sent: boolean; reason?: string; alreadySent?: boolean }> {
    return staffPreVisitBriefService.sendPreVisitBrief(reservationId, tenantId);
  }

  /** Fase 5r — Sapuan Pre-Visit Brief (delegasi ke sub-service). */
  async sweepPreVisitBriefs(tenantId: string): Promise<number> {
    return staffPreVisitBriefService.sweepPreVisitBriefs(tenantId);
  }

  /**
   * Buffer notifikasi penugasan: jadwalkan pengiriman notifikasi ke terapis setelah
   * `ASSIGNMENT_NOTIFICATION_DELAY_MINUTES`. Idempoten terhadap perubahan beruntun —
   * pemanggilan ulang untuk reservasi sama menimpa staff & waktu pending.
   */
  async scheduleReservationAssignmentNotification(reservationId: string, staffId: string): Promise<void> {
    if (!reservationId || !staffId) return;
    const runAt = new Date(Date.now() + ASSIGNMENT_NOTIFICATION_DELAY_MINUTES * 60 * 1000);
    try {
      await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          assignment_pending_staff_id: staffId,
          assignment_pending_at: runAt,
          assignment_notified_at: null,
        },
      });
    } catch (err: any) {
      console.warn(`[StaffNotificationService] scheduleReservationAssignmentNotification error:`, err.message);
    }
  }

  /** Batalkan notifikasi penugasan yang masih pending (belum terkirim ke terapis). */
  async cancelPendingAssignmentNotification(reservationId: string): Promise<void> {
    if (!reservationId) return;
    try {
      await prisma.reservation.update({
        where: { id: reservationId },
        data: { assignment_pending_staff_id: null, assignment_pending_at: null },
      });
    } catch (err: any) {
      console.warn(`[StaffNotificationService] cancelPendingAssignmentNotification error:`, err.message);
    }
  }

  /**
   * Sapuan notifikasi penugasan yang sudah melewati jendela buffer. Persisten:
   * dipanggil cron berkala, aman lintas restart/multi-instance. Idempoten via
   * `assignment_notified_at`.
   */
  async sweepPendingAssignmentNotifications(tenantId: string): Promise<number> {
    let sent = 0;
    try {
      const now = new Date();
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assignment_pending_staff_id: { not: null },
          assignment_pending_at: { lte: now },
          assignment_notified_at: null,
        },
        select: { id: true, assignment_pending_staff_id: true },
        take: 50,
      });
      for (const r of rows) {
        const staffId = r.assignment_pending_staff_id;
        if (!staffId) continue;
        // Tandai notified lebih dulu (anti dobel kirim lintas instance) lalu kirim.
        const claimed = await prisma.reservation.updateMany({
          where: { id: r.id, assignment_notified_at: null, assignment_pending_staff_id: staffId },
          data: { assignment_notified_at: new Date(), assignment_pending_staff_id: null, assignment_pending_at: null },
        });
        if (claimed.count === 0) continue;
        const res = await this.sendReservationAssignmentNotification(r.id, staffId);
        if (res.sent) sent++;
      }
    } catch (err: any) {
      console.warn(`[StaffNotificationService] sweepPendingAssignmentNotifications error:`, err.message);
    }
    return sent;
  }

  async sendReservationCancelledNotification(
    reservationId: string,
    staffId: string,
    reason?: string
  ): Promise<{ sent: boolean; reason?: string }> {
    return staffNotificationEventsService.sendReservationCancelledNotification(reservationId, staffId, reason);
  }

  async sendTaskUnassignedNotification(
    reservationId: string,
    oldStaffId: string,
    newStaffName?: string,
    notifyOldStaff: boolean = true
  ): Promise<{ sent: boolean; reason?: string }> {
    return staffNotificationEventsService.sendTaskUnassignedNotification(
      reservationId,
      oldStaffId,
      newStaffName,
      notifyOldStaff
    );
  }

  /** Menyusun pesan Markdown Briefing Jadwal Harian Bidan/Terapis. */
  generateDailyBriefingText(staffName: string, formattedDate: string, reservations: any[]): string {
    return staffNotificationBriefingService.generateDailyBriefingText(staffName, formattedDate, reservations);
  }

  /** Menghitung rentang waktu 00:00:00 s/d 23:59:59 dalam zona waktu WIB. */
  getWibDayRange(targetDate: Date = new Date()): {
    startOfDay: Date;
    endOfDay: Date;
    dateStr: string;
    formattedDate: string;
  } {
    return staffNotificationBriefingService.getWibDayRange(targetDate);
  }

  /** Mengirimkan briefing jadwal harian ke 1 staf/bidan spesifik. */
  async sendStaffDailyBriefing(
    staffId: string,
    targetDate: Date = new Date()
  ): Promise<{ sent: boolean; reason?: string; count?: number }> {
    return staffNotificationBriefingService.sendStaffDailyBriefing(staffId, targetDate);
  }

  /**
   * Mengirimkan briefing pagi harian ke seluruh Bidan/Terapis aktif yang memiliki jadwal
   */
  async sendAllStaffMorningBriefings(
    tenantId: string = 'default-tenant',
    targetDate: Date = new Date()
  ): Promise<{ totalStaff: number; briefedStaff: number; totalReservations: number }> {
    try {
      // Mandat In-System PWA Only: briefing pagi Telegram eksternal DEFAULT OFF (tenant-aware).
      const morningNotifConfig = await getStaffNotificationConfig(tenantId);
      if (!morningNotifConfig.telegramEnabled) {
        return { totalStaff: 0, briefedStaff: 0, totalReservations: 0 };
      }

      const activeStaffList = await prisma.staff.findMany({
        where: {
          tenant_id: tenantId,
          active: true,
          telegram_chat_id: { not: null },
        },
        select: { id: true, name: true },
      });

      let briefedStaff = 0;
      let totalReservations = 0;

      for (const staff of activeStaffList) {
        const res = await this.sendStaffDailyBriefing(staff.id, targetDate);
        if (res.sent) {
          briefedStaff++;
          totalReservations += res.count || 0;
        }
      }

      console.log(
        `[StaffNotificationService] Morning Briefing selesai dikirim ke ${briefedStaff}/${activeStaffList.length} staf (${totalReservations} total jadwal).`
      );

      return {
        totalStaff: activeStaffList.length,
        briefedStaff,
        totalReservations,
      };
    } catch (err: any) {
      console.error('[StaffNotificationService] Error sending morning briefings to all staff:', err.message);
      return { totalStaff: 0, briefedStaff: 0, totalReservations: 0 };
    }
  }
}

export const staffNotificationService = new StaffNotificationService();

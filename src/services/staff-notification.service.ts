import { prisma } from '../db/client';
import { telegramService } from './telegram.service';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { webPushService } from './web-push.service';
import { getLiveChatHub } from './live-chat-hub.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getStaffNotificationConfig } from '../config/staff-notification-config';
import crypto from 'crypto';
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

      // 2. Format Alamat Lengkap & Patokan Rumah
      const addressParts: string[] = [];
      if (cust?.kelurahan) addressParts.push(`Kel. ${cust.kelurahan}`);
      if (cust?.kecamatan) addressParts.push(`Kec. ${cust.kecamatan}`);
      if (cust?.kota) addressParts.push(cust.kota);
      const addressText = addressParts.join(', ') || 'Alamat belum tercatat lengkap';

      const landmark = (cust?.preferences as any)?.landmark || null;
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

      // 4. Navigasi Google Maps Motor
      const lat = cust?.lat;
      const lng = cust?.lng;
      const navigationUrl =
        lat && lng
          ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`
          : 'https://maps.google.com';

      // 5. Jarak Tempuh — Fase 4 (RC-6, KNOWN_ISSUES #138 G5): sumber resmi jarak klinik→pasien
      // adalah deliveryService.calculateDelivery (tenant-aware: ORS + fallback + tier DB), sehingga
      // angka konsisten dengan pipeline chatbot/refresh. Rumus lokal Haversine×1.6 dihapus.
      let distanceKm = cust?.distance_km ?? null;
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
      const ongkir = cust?.ongkir || 0;
      const totalFee = purchaseValue || (ongkir > 0 ? ongkir : 0);
      const isLunas = reservation.status === 'CONFIRMED' || reservation.status === 'COMPLETED';
      const paymentStatusLabel = isLunas ? 'LUNAS (Transfer)' : 'TAGIH DI TEMPAT (Cash/QRIS)';

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

      // 10. Real-time In-System Web Push PWA (Service Worker)
      try {
        await webPushService.sendPushToStaff(staff.id, tenantId, {
          title: 'Tugas Kunjungan Baru 💆‍♀️',
          body: `${reservation.treatment_detail || 'Treatment'} untuk ${cust?.name || 'Bunda'} (${dateStr} - ${timeStr} WIB)`,
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
        const messageText = `🔔 *TUGAS RESERVASI BARU DITUGASKAN!*
Halo *${staff.name}*, Anda memiliki jadwal kunjungan pasien baru:

👤 *Pasien:* ${cust?.name || 'Bunda'}
👶 *Anak:* ${childrenStr || 'Belum diisi'}
💆‍♀️ *Layanan:* ${reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare'}
📅 *Waktu:* ${dateStr} — *Pukul ${timeStr} WIB*

📍 *Alamat:* ${addressText}
${landmark ? `🏠 *Patokan Rumah:* _${landmark}_\n` : ''}${distanceStr ? `🏍️ *Estimasi Jarak:* ${distanceStr}\n` : ''}🗺️ *Rute Navigasi Motor:* [Buka Google Maps](${navigationUrl})

💰 *Total Biaya:* Rp ${totalFee.toLocaleString('id-ID')} _(${paymentStatusLabel})_
${notes ? `📝 *Catatan Pasien:* _${notes}_\n` : ''}
🔒 *Komunikasi & Tugas:*
👉 [Buka Tugas & Chat Pasien di Portal Terapis](${portalUrl})

_Semoga lancar dan berikan pelayanan terbaik ya! ✨_`;

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

  /**
   * Fase 5r — Trigger same-day: bila reservasi confirmed mulai dalam <=35 menit
   * (mis. booking dadakan H-15), kirim Pre-Visit Brief segera tanpa menunggu cron.
   * Idempoten via `pre_visit_brief_sent_at`. Fire-and-forget; tidak memblokir alur.
   */
  public triggerPreVisitBriefIfImminent(reservationId: string, tenantId: string): void {
    void (async () => {
      try {
        const r = await prisma.reservation.findUnique({
          where: { id: reservationId },
          select: { status: true, booking_date: true, pre_visit_brief_sent_at: true, assigned_staff_id: true },
        });
        if (!r || r.status !== 'confirmed' || !r.booking_date || r.pre_visit_brief_sent_at || !r.assigned_staff_id) return;
        const msUntil = new Date(r.booking_date).getTime() - Date.now();
        if (msUntil > 0 && msUntil <= 35 * 60 * 1000) {
          await this.sendPreVisitBrief(reservationId, tenantId);
        }
      } catch (err: any) {
        console.warn(`[StaffNotificationService] triggerPreVisitBriefIfImminent error:`, err.message);
      }
    })();
  }

  /**
   * Helper pembersih karakter markdown berbahaya
   */
  private escapeMarkdown(text: string): string {
    return (text || '').replace(/[*_`\[\]]/g, ' ').trim();
  }

  /**
   * Fase 5r — Pre-Visit Brief: kartu ringkasan pasien H-30 menit ke bidan.
   *
   * Keputusan G2=B (minimal, privasi): TIDAK menyertakan nomor HP pasien maupun
   * alamat lengkap di Telegram pribadi — hanya jam, nama pasien + usia anak, layanan,
   * terapis sesi lalu, dan catatan karakter (admin_notes). Alamat/GPS penuh hanya di
   * portal terapis (butuh login).
   *
   * Idempoten: `pre_visit_brief_sent_at` mencegah kirim ganda (cron + trigger same-day).
   */
  async sendPreVisitBrief(
    reservationId: string,
    tenantId: string
  ): Promise<{ sent: boolean; reason?: string; alreadySent?: boolean }> {
    try {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: { include: { children: true } },
          children: true,
          assigned_staff: { select: { id: true, name: true, telegram_chat_id: true } },
        },
      });
      if (!reservation) return { sent: false, reason: 'Reservasi tidak ditemukan' };
      if (reservation.pre_visit_brief_sent_at) {
        return { sent: false, alreadySent: true, reason: 'Brief sudah pernah dikirim' };
      }
      const staff: any = reservation.assigned_staff;
      if (!staff) return { sent: false, reason: 'Belum ada bidan yang ditugaskan' };
      const cust: any = reservation.customer;
      if (cust?.is_sandbox_test || isDummyOrTestContact(cust?.phone, cust?.name, cust?.is_sandbox_test)) {
        return { sent: false, reason: 'Sandbox test (notifikasi dinonaktifkan)' };
      }

      // Usia anak riil via childService (reuse, fallback graceful bila birth_date null).
      const allChildren = reservation.children?.length ? reservation.children : cust?.children || [];
      const child = allChildren[0];
      let childLine = '';
      if (child) {
        try {
          const { childService } = await import('./child.service');
          const enriched = await childService.getChildrenWithCurrentAge(cust?.id);
          const match = enriched?.find((c: any) => c.id === child.id) || enriched?.[0];
          const ageText = match?.current_age || child.raw_age_text || 'Usia belum tercatat';
          childLine = `${child.name} (${ageText})`;
        } catch {
          childLine = `${child.name} (${child.raw_age_text || 'Usia belum tercatat'})`;
        }
      }

      const bookingDate = reservation.booking_date ? new Date(reservation.booking_date) : null;
      const timeStr = bookingDate
        ? bookingDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
        : '-';

      // Kunjungan sebelumnya (reuse, tenant-aware).
      let lastVisitLine = 'Kunjungan pertama';
      try {
        const prev = await prisma.reservation.findFirst({
          where: {
            tenant_id: tenantId,
            customer_id: reservation.customer_id,
            id: { not: reservation.id },
            status: { in: ['confirmed', 'en_route', 'completed'] },
            booking_date: { lt: reservation.booking_date || new Date() },
          },
          include: { assigned_staff: { select: { name: true } } },
          orderBy: { booking_date: 'desc' },
        });
        if (prev) {
          const prevTreatment = prev.treatment_detail || prev.treatment_category || 'Treatment';
          lastVisitLine = `Sesi lalu: ${prevTreatment}${prev.assigned_staff?.name ? ` (Bidan ${prev.assigned_staff.name})` : ''}`;
        }
      } catch {
        // best-effort
      }

      const adminNotes = cust?.admin_notes || null;
      const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000';
      const portalUrl = `${baseUrl}/admin/staff/today`;

      const messageText = `📋 [RINGKASAN PASIEN SEBELUM KUNJUNGAN]
⏰ Jam: ${timeStr} WIB
👤 Pasien: ${this.escapeMarkdown(cust?.name || 'Bunda')}${childLine ? `\n👶 Anak: ${this.escapeMarkdown(childLine)}` : ''}
🔄 ${this.escapeMarkdown(lastVisitLine)}
🎯 Layanan: ${this.escapeMarkdown(reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare')}${adminNotes ? `\n💡 Catatan Khusus:\n${this.escapeMarkdown(adminNotes)}` : ''}

📍 Alamat lengkap & rute tersedia di portal (login):
👉 [Buka Tugas di Portal Terapis](${portalUrl})`;

      // Distribusi Telegram pribadi (G2=B). Web Push in-system tetap dikirim sebagai kanal cadangan.
      let pushSent = 0;
      try {
        const pushRes = await webPushService.sendPushToStaff(staff.id, tenantId, {
          title: '📋 Ringkasan Pasien Sebelum Kunjungan',
          body: `${cust?.name || 'Bunda'} — ${timeStr} WIB. Cek detail di portal.`,
          url: '/admin/staff/today',
          tag: `pre_visit_brief_${reservation.id}`,
          icon: '/admin/icon-192.png',
          badge: '/admin/favicon.ico',
          data: { reservationId: reservation.id, staffId: staff.id, url: '/admin/staff/today' },
        });
        pushSent = pushRes?.sent ?? 0;
      } catch (pushErr: any) {
        console.warn(`[StaffNotificationService] Web Push pre-visit brief error:`, pushErr.message);
      }

      let telegramSent = false;
      // Mandat In-System PWA Only: Telegram eksternal DEFAULT OFF (tenant-aware).
      const preVisitNotifConfig = await getStaffNotificationConfig(tenantId);
      if (preVisitNotifConfig.telegramEnabled && staff.telegram_chat_id) {
        try {
          const res = await telegramService.sendMessage({
            chatId: staff.telegram_chat_id,
            text: messageText,
            parseMode: 'Markdown',
          });
          telegramSent = res.ok;
        } catch (tgErr: any) {
          console.warn(`[StaffNotificationService] Telegram pre-visit brief error:`, tgErr.message);
        }
      }

      // Idempotensi HANYA bila minimal satu kanal benar-benar mengirim. Bila tidak ada
      // kanal aktif (staf belum pairing Telegram & belum subscribe Web Push), JANGAN
      // tandai terkirim — biarkan sweep retry saat kanal tersedia (mis. staf pairing
      // Telegram beberapa menit kemudian). Konsekuensi: sweep berulang tiap interval
      // selama kanal belum aktif (disengaja, dicatat di KNOWN_ISSUES).
      const deliverySuccess = telegramSent || pushSent > 0;
      if (deliverySuccess) {
        await prisma.reservation
          .update({ where: { id: reservationId }, data: { pre_visit_brief_sent_at: new Date() } })
          .catch(() => {});
      } else {
        // #157f: observabilitas deterministik. Staf tanpa kanal aktif (belum pairing
        // Telegram & belum subscribe Web Push) TIDAK ditandai terkirim → sweep retry
        // saat kanal tersedia. Baris terstruktur ini membuat kondisi "no channel"
        // bisa di-forensik dari log (sebelumnya hanya console.log bebas).
        console.log(
          `[PRE_VISIT_BRIEF_NO_CHANNEL] ${JSON.stringify({
            event: 'PRE_VISIT_BRIEF_NO_CHANNEL',
            reservationId,
            tenantId,
            staffId: staff.id,
            hasTelegram: Boolean(staff.telegram_chat_id),
            pushSent,
            telegramSent,
            ts: new Date().toISOString(),
          })}`
        );
      }

      return {
        sent: deliverySuccess,
        reason: deliverySuccess ? undefined : 'no_channel',
      };
    } catch (err: any) {
      console.error(`[StaffNotificationService] Failed to send pre-visit brief for ${reservationId}:`, err.message);
      return { sent: false, reason: err.message };
    }
  }

  /**
   * Fase 5r — Sapuan pre-visit brief: reservasi confirmed yang mulai dalam
   * 20-35 menit ke depan (belum pernah dikirim). Idempoten via pre_visit_brief_sent_at.
   */
  async sweepPreVisitBriefs(tenantId: string): Promise<number> {
    const now = Date.now();
    const from = new Date(now + 20 * 60 * 1000);
    const to = new Date(now + 35 * 60 * 1000);
    let count = 0;
    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          status: 'confirmed',
          pre_visit_brief_sent_at: null,
          booking_date: { gte: from, lte: to },
        },
        select: { id: true },
        take: 50,
      });
      for (const r of rows) {
        const res = await this.sendPreVisitBrief(r.id, tenantId);
        if (res.sent) count++;
      }
    } catch (err: any) {
      console.warn(`[StaffNotificationService] sweepPreVisitBriefs error:`, err.message);
    }
    return count;
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
        const reasonLine = reason ? `Alasan: _${this.escapeMarkdown(reason)}_\n` : '';
        const messageText = `JADWAL KUNJUNGAN DIBATALKAN\nHalo *${this.escapeMarkdown(staff.name)}*, jadwal kunjungan berikut telah dibatalkan:\n\nPasien: ${custName}\nLayanan: ${treatmentDetail}\nWaktu: ${dateStr} — Pukul ${timeStr} WIB\nAlamat: ${addressText}\n${reasonLine}\nCatatan: Anda tidak perlu menuju ke lokasi pasien untuk jadwal ini.\n\n[Buka Portal Terapis](${portalUrl})`;

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
        const messageText = `JADWAL DIALIHKAN\nHalo *${this.escapeMarkdown(staff.name)}*, jadwal kunjungan berikut telah dialihkan${newStaffLabel} oleh supervisor:\n\nPasien: ${custName}\nLayanan: ${treatmentDetail}\nWaktu: ${dateStr} — Pukul ${timeStr} WIB\n\nAnda tidak perlu menuju ke lokasi untuk jadwal ini. Terima kasih.\n\n[Buka Portal Terapis](${portalUrl})`;

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

  /**
   * Menyusun pesan Markdown Briefing Jadwal Harian Bidan/Terapis
   */
  generateDailyBriefingText(
    staffName: string,
    formattedDate: string,
    reservations: any[]
  ): string {
    const cleanStaffName = this.escapeMarkdown(staffName);
    const count = reservations.length;

    const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const itemsText = reservations
      .map((reservation, idx) => {
        const numEmoji = emojiNumbers[idx] || `${idx + 1}️⃣`;
        const cust = reservation.customer;
        const allChildren = reservation.children?.length ? reservation.children : cust?.children || [];

        // 1. Data Anak / Pasien
        let patientDetail = '';
        if (allChildren.length > 0) {
          const chStr = allChildren
            .map((ch: any) => {
              const name = this.escapeMarkdown(ch.name);
              const age = ch.raw_age_text ? `, ${this.escapeMarkdown(ch.raw_age_text)}` : '';
              return `${name}${age}`;
            })
            .join(', ');
          patientDetail = `👶 ${chStr}`;
        } else {
          const category = String(reservation.treatment_category || '').toUpperCase();
          const detail = String(reservation.treatment_detail || '').toLowerCase();
          if (category === 'PREGNANCY' || detail.includes('hamil') || detail.includes('prenatal') || detail.includes('postpartum')) {
            patientDetail = 'Ibu Hamil';
          } else {
            patientDetail = 'Moms';
          }
        }

        const custName = this.escapeMarkdown(cust?.name || 'Bunda');

        // 2. Format Jam WIB
        const bookingDate = reservation.booking_date ? new Date(reservation.booking_date) : null;
        let timeStr = '-';
        if (bookingDate) {
          const wibDate = new Date(bookingDate.getTime() + 7 * 60 * 60 * 1000);
          const hours = String(wibDate.getUTCHours()).padStart(2, '0');
          const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');
          timeStr = `${hours}:${minutes}`;
        }

        // 3. Layanan
        const treatmentName = this.escapeMarkdown(
          reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare'
        );

        // 4. Alamat & Google Maps
        const addressParts: string[] = [];
        if (cust?.kelurahan) addressParts.push(`Kel. ${this.escapeMarkdown(cust.kelurahan)}`);
        if (cust?.kecamatan) addressParts.push(`Kec. ${this.escapeMarkdown(cust.kecamatan)}`);
        if (cust?.kota) addressParts.push(this.escapeMarkdown(cust.kota));
        const addressText = addressParts.join(', ') || 'Alamat tercatat di sistem';

        const lat = cust?.lat;
        const lng = cust?.lng;
        const navigationUrl =
          lat && lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`
            : `https://maps.google.com/?q=${encodeURIComponent(addressText)}`;

        // 5. Total Biaya
        const purchaseValue = reservation.purchase_value || 0;
        const ongkir = cust?.ongkir || 0;
        const totalFee = purchaseValue || (ongkir > 0 ? ongkir : 0);
        let totalFeeStr = '';
        if (totalFee > 0) {
          if (totalFee >= 1000 && totalFee % 1000 === 0) {
            totalFeeStr = `${totalFee / 1000}k`;
          } else {
            totalFeeStr = `Rp ${totalFee.toLocaleString('id-ID')}`;
          }
        }

        const lines: string[] = [
          `${numEmoji} *${timeStr} WIB* — *${custName}* (${patientDetail})`,
          `• *Layanan:* ${treatmentName}`,
          `• *Alamat:* ${addressText} ([Buka Maps](${navigationUrl}))`,
        ];

        if (totalFeeStr) {
          lines.push(`• *Total :* ${totalFeeStr}`);
        }

        return lines.join('\n');
      })
      .join('\n\n');

    const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin';
    const portalUrl = `${baseUrl}/#staff-today`;

    return `🌅 *BRIEFING JADWAL HARI INI — ${cleanStaffName}*
📅 *${formattedDate}*

Halo ${cleanStaffName}, hari ini Anda memiliki *${count} Jadwal Kunjungan*:

${itemsText}

🔗 [Buka Detail di Portal Petugas](${portalUrl})

_Semangat melayani Bunda & Buah Hati hari ini! ✨_`;
  }

  /**
   * Menghitung rentang waktu 00:00:00 s/d 23:59:59 dalam zona waktu WIB
   */
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

  /**
   * Mengirimkan briefing jadwal harian ke 1 staf/bidan spesifik
   */
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

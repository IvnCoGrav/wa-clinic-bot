import { prisma } from '../db/client';
import { telegramService } from './telegram.service';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { webPushService } from './web-push.service';
import { getStaffNotificationConfig } from '../config/staff-notification-config';
import { buildEffectiveTaskAddress } from './staff-reservation.service';
import { staffNotificationFormatterService } from './staff-notification-formatter.service';

/**
 * F3.2/F3.6d — Pre-Visit Brief (kartu ringkasan pasien H-30 menit).
 * Dipisah dari staff-notification.service agar file induk di bawah 600 baris.
 * Publik dipanggil lewat facade `staffNotificationService` (backward-compatible).
 */
export class StaffPreVisitBriefService {
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
   * Fase 5r — Pre-Visit Brief: kartu ringkasan pasien H-30 menit ke bidan.
   *
   * Keputusan G2=B (minimal, privasi): TIDAK menyertakan nomor HP pasien maupun
   * alamat lengkap di Telegram pribadi — hanya jam, nama pasien + usia anak, layanan,
   * AREA ringkas (kelurahan/kecamatan atau nama perumahan), terapis sesi lalu, dan
   * catatan karakter (admin_notes). Alamat/GPS penuh hanya di portal terapis (login).
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
          customer_address: true,
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

      // Fase 4 (A-008): baris AREA ringkas (kelurahan/kecamatan) via seam kanonis.
      // HANYA ringkas area — DILARANG menaruh alamat lengkap/no HP.
      // A-012 (audit): fallback alamat jalan (`address.split(',')[0]`) DIHAPUS —
      // alamat tanpa koma bocorkan jalan + no rumah ke Telegram (kontrak G2=B).
      // Bila area tak diketahui → baris tidak ditampilkan (bukan diisi teks jalan).
      const effectiveAddrBrief: any = buildEffectiveTaskAddress((reservation as any).customer_address, cust) || {};
      const areaParts = [effectiveAddrBrief.kelurahan, effectiveAddrBrief.kecamatan].filter(Boolean).map((s: any) => String(s).trim());
      const areaLine = areaParts.join(', ');

      const messageText = staffNotificationFormatterService.formatPreVisitBriefMessage({
        staffName: staff.name,
        timeStr,
        patientName: cust?.name || 'Bunda',
        childLine,
        lastVisitLine,
        treatmentName: reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare',
        areaLine,
        adminNotes,
        portalUrl,
      });

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
}

export const staffPreVisitBriefService = new StaffPreVisitBriefService();

/**
 * staff-departure-watchdog.service.ts
 * Service untuk Departure Watchdog: deteksi potensi keterlambatan bidan dan eskalasi notifikasi ke nomor admin.
 *
 * Menerapkan:
 * - Query optimal anti-N+1 untuk reservasi hari ini.
 * - Resolusi leg sekuensial per bidan menggunakan domain `resolveLegOrigin`.
 * - Prediksi keterlambatan kanonis dari `predictTaskDelay` dan `etaMinutesTo`.
 * - Notifikasi ke nomor WhatsApp admin resmi klinik (tanpa memaparkan no HP pasien ke bidan).
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getClinicLocationAsync } from '../config/clinic-location';
import { getDelayWatchdogSettings } from '../config/delay-watchdog-config';
import { isStaffTherapistRole } from '../domain/staff-role';
import {
  computeItineraryDelays,
  resolveLegOrigin,
  predictTaskDelay,
  etaMinutesTo,
  type OriginSource,
} from '../domain/delay-watchdog';
import { StaffReservationService } from './staff-reservation.service';
import { getGateway } from '../integrations/whatsapp';
import { normalizePhoneID } from '../utils/phone-normalizer';
import { auditService } from './audit.service';
import { type DelayLevel } from './staff-trip-tracking.service';

/**
 * Deteksi penolakan WABA karena jendela layanan 24 jam sudah lewat.
 * Driver WABA mengembalikan kode numerik Meta (mis. `131047`), bukan string
 * `OUTSIDE_24H_WINDOW`; string lama tetap diterima untuk kompatibilitas.
 */
function isWabaWindowClosed(result: {
  provider?: string | null;
  error?: { code?: string | null } | null;
}): boolean {
  if (result?.provider !== 'WABA' || !result?.error) return false;
  const code = String(result.error.code || '');
  return code === '131047' || code === 'OUTSIDE_24H_WINDOW';
}

export interface DelayAlertItem {
  reservationId: string;
  staffId: string | null;
  staffName: string;
  patientName: string;
  bookingDate: Date | null;
  etaMinutes: number | null;
  delayMinutes: number;
  level: DelayLevel;
  estimatedArrivalWib: string;
  missedDeparture: boolean;
  originSource: OriginSource;
  originName: string;
  delayText: string;
  /** Kapan admin terakhir otomatis/manual diberi tahu (anti-spam auto-send). */
  delayNotifiedAt: Date | null;
}

export interface NotifyDelayToAdminParams {
  reservationId: string;
  staffId: string;
  tenantId: string;
  isSupervisor?: boolean;
  force?: boolean;
}

export interface NotifyDelayToAdminResult {
  success: boolean;
  code?: string;
  error?: string;
  recipientCount?: number;
}

export interface TestDelayNotificationResult {
  success: boolean;
  error?: string;
  recipientCount?: number;
}

export class StaffDepartureWatchdogService {
  /**
   * Mengambil daftar peringatan keterlambatan (delay alerts) untuk seluruh bidan hari ini.
   * Dipanggil oleh endpoint admin CS dan background cron watchdog.
   */
  async listTodayDelayAlerts(
    tenantId: string = DEFAULT_TENANT_ID,
    now: Date = new Date()
  ): Promise<DelayAlertItem[]> {
    const watchdogSettings = await getDelayWatchdogSettings(tenantId);
    const clinicLoc = await getClinicLocationAsync(tenantId);

    const { startOfDay, endOfDay } = StaffReservationService.getWibDateRange();

    let rows: any[] = [];
    try {
      rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          booking_date: { gte: startOfDay, lte: endOfDay },
          status: { notIn: ['cancelled', 'rejected'] },
          customer: { is_sandbox_test: false },
          assigned_staff_id: { not: null },
        },
        include: {
          assigned_staff: {
            select: {
              id: true,
              name: true,
              role: true,
              base_lat: true,
              base_lng: true,
              base_address: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              lat: true,
              lng: true,
            },
          },
          customer_address: {
            select: {
              id: true,
              lat: true,
              lng: true,
              address: true,
            },
          },
        },
        orderBy: { booking_date: 'asc' },
      });
    } catch (err: any) {
      console.warn(`[DELAY_WATCHDOG] Gagal mengambil reservasi hari ini: ${err.message}`);
      return [];
    }

    if (rows.length === 0) return [];

    // Departure Watchdog dikhususkan eksklusif untuk Staff Terapis.
    // Abaikan jadwal staf peran non-terapis (Admin CS, SPV, Advertiser, dll).
    const therapistRows = rows.filter((r) => isStaffTherapistRole(r.assigned_staff?.role));
    if (therapistRows.length === 0) return [];

    // Satu seam domain (sama dengan kartu tugas staf) — anti-divergensi angka.
    const predictions = computeItineraryDelays({
      tasks: therapistRows.map((r) => ({
        id: r.id,
        staffId: r.assigned_staff?.id || null,
        staffBase: r.assigned_staff
          ? {
              lat: r.assigned_staff.base_lat,
              lng: r.assigned_staff.base_lng,
              address: r.assigned_staff.base_address,
            }
          : null,
        customerLat: r.customer_address?.lat ?? r.customer?.lat ?? null,
        customerLng: r.customer_address?.lng ?? r.customer?.lng ?? null,
        address: r.customer_address?.address || null,
        patientName: r.customer?.name || null,
        bookingDate: r.booking_date,
        durationMinutes: r.duration_minutes,
        status: r.status,
        arrivedAt: r.arrived_at,
        hasDeparted: Boolean(r.otw_sent_at),
        hasArrived: Boolean(r.arrived_at),
      })),
      clinicLocation: clinicLoc,
      now,
      toleranceMinutes: watchdogSettings.toleranceMinutes,
      criticalExtraMinutes: watchdogSettings.criticalExtraMinutes,
      maxPrevOriginGapHours: watchdogSettings.maxPrevOriginGapHours,
    });

    const alerts: DelayAlertItem[] = [];

    for (const r of therapistRows) {
      const snapshot = predictions.get(r.id);
      if (!snapshot) continue;

      const isCompleted = r.status === 'completed';
      const hasArrived = Boolean(r.arrived_at);

      // Jika task sudah tiba atau sudah selesai, jangan munculkan sebagai delay alert aktif
      if (hasArrived || isCompleted) continue;

      // Alert hanya untuk task yang terlambat atau missed departure
      if (snapshot.level === 'none' && !snapshot.missedDeparture) continue;

      let delayText = '';
      try {
        delayText = await StaffReservationService.getTripDelayMessageText(tenantId, {
          patientName: r.customer?.name || 'Pasien',
          delayMinutes: snapshot.delayMinutes,
          arrivalTime: snapshot.estimatedArrivalWib,
          variantKey: r.id,
        });
      } catch {
        delayText = `Halo Bunda, kami ingin menginformasikan estimasi kedatangan Bidan sekitar pukul ${snapshot.estimatedArrivalWib}.`;
      }

      alerts.push({
        reservationId: r.id,
        staffId: r.assigned_staff?.id || null,
        staffName: r.assigned_staff?.name || 'Belum Ditugaskan',
        patientName: r.customer?.name || 'Pasien',
        bookingDate: r.booking_date,
        etaMinutes: snapshot.etaMinutes,
        delayMinutes: snapshot.delayMinutes,
        level: snapshot.level,
        estimatedArrivalWib: snapshot.estimatedArrivalWib,
        missedDeparture: snapshot.missedDeparture,
        originSource: snapshot.originSource,
        originName: snapshot.originName,
        delayText,
        delayNotifiedAt: (r as any).delay_notified_at ?? null,
      });
    }

    return alerts;
  }

  /**
   * Audit kegagalan pengiriman notifikasi (fail-soft, tanpa nomor HP).
   * Tanpa ini, kegagalan kirim tidak terlihat di audit trail.
   */
  private async recordNotifyFailure(
    tenantId: string,
    staffId: string,
    reservationId: string,
    code: string
  ): Promise<void> {
    try {
      await auditService.logAdminAction({
        action: 'STAFF_DELAY_NOTIFY_FAILED',
        adminIdentity: `staff:${staffId}`,
        tenantId,
        payload: { reservationId, code },
      });
    } catch {
      /* audit gagal tidak boleh menggagalkan respons */
    }
  }

  /**
   * Mengirimkan pesan uji ke seluruh nomor admin terdaftar.
   * Dipakai route setelan tenant; route tidak boleh mengimpor integrasi langsung.
   */
  async sendTestNotification(tenantId: string): Promise<TestDelayNotificationResult> {
    const watchdogSettings = await getDelayWatchdogSettings(tenantId);
    const recipients = watchdogSettings.adminRecipients || [];
    if (recipients.length === 0) {
      return {
        success: false,
        error: 'Belum ada nomor admin yang tersimpan di setelan Delay Watchdog.',
      };
    }

    const gateway = getGateway(tenantId);
    const text =
      '🧪 *Tes Peringatan Keterlambatan (Departure Watchdog)*\n\nNomor ini terdaftar sebagai penerima notifikasi keterlambatan bidan. Sistem berfungsi normal!';

    let sentCount = 0;
    for (const phone of recipients) {
      try {
        const res = await gateway.sendTextMessage(phone, text);
        if (res.success) sentCount++;
      } catch (err: any) {
        console.warn(`[TEST_NOTIFY] Gagal kirim pesan tes: ${err?.message}`);
      }
    }

    if (sentCount === 0) {
      return { success: false, error: 'Gagal mengirim pesan tes melalui gateway WhatsApp.' };
    }

    return { success: true, recipientCount: sentCount };
  }

  /**
   * Mengirimkan notifikasi keterlambatan dari bidan ke nomor admin resmi via WhatsApp.
   * Melindungi kerahasiaan nomor HP pasien (SOP no-HP).
   */
  async notifyDelayToAdmin(params: NotifyDelayToAdminParams): Promise<NotifyDelayToAdminResult> {
    const { reservationId, staffId, tenantId, isSupervisor, force } = params;

    let reservation: any;
    try {
      reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: { select: { id: true, name: true, lat: true, lng: true } },
          customer_address: { select: { lat: true, lng: true } },
          assigned_staff: {
            select: {
              id: true,
              name: true,
              role: true,
              base_lat: true,
              base_lng: true,
              base_address: true,
            },
          },
        },
      });
    } catch (err: any) {
      return { success: false, code: 'DB_ERROR', error: 'Gagal memuat reservasi dari basis data.' };
    }

    if (!reservation || reservation.tenant_id !== tenantId) {
      return { success: false, code: 'RESERVATION_NOT_FOUND', error: 'Reservasi tidak ditemukan.' };
    }

    if (!isSupervisor && reservation.assigned_staff_id !== staffId) {
      return {
        success: false,
        code: 'FORBIDDEN',
        error: 'Anda bukan bidan yang ditugaskan untuk jadwal ini.',
      };
    }

    // Guard status & tanggal: notifikasi hanya sah untuk jadwal HARI INI yang
    // masih berjalan. Mencegah eskalasi palsu untuk kunjungan selesai/batal.
    const statusLower = String(reservation.status || '').toLowerCase();
    if (['completed', 'cancelled', 'rejected'].includes(statusLower)) {
      await this.recordNotifyFailure(tenantId, staffId, reservationId, 'RESERVATION_CLOSED');
      return {
        success: false,
        code: 'RESERVATION_CLOSED',
        error: `Notifikasi tidak dapat dikirim untuk jadwal berstatus "${reservation.status}".`,
      };
    }

    const bookingMs = reservation.booking_date
      ? new Date(reservation.booking_date).getTime()
      : NaN;
    if (!Number.isFinite(bookingMs)) {
      await this.recordNotifyFailure(tenantId, staffId, reservationId, 'NO_SCHEDULE');
      return {
        success: false,
        code: 'NO_SCHEDULE',
        error: 'Jadwal reservasi belum memiliki waktu yang valid.',
      };
    }

    const { startOfDay, endOfDay } = StaffReservationService.getWibDateRange('today');
    if (bookingMs < startOfDay.getTime() || bookingMs > endOfDay.getTime()) {
      await this.recordNotifyFailure(tenantId, staffId, reservationId, 'NOT_TODAY');
      return {
        success: false,
        code: 'NOT_TODAY',
        error: 'Notifikasi keterlambatan hanya dapat dikirim untuk jadwal hari ini.',
      };
    }

    // Guard peran: notifikasi keterlambatan hanya sah untuk staf terapis lapangan
    if (!reservation.assigned_staff || !isStaffTherapistRole(reservation.assigned_staff.role)) {
      await this.recordNotifyFailure(tenantId, staffId, reservationId, 'NOT_A_THERAPIST');
      return {
        success: false,
        code: 'NOT_A_THERAPIST',
        error: 'Notifikasi keterlambatan hanya dapat dikirim untuk staf terapis.',
      };
    }

    // Idempotensi / anti-spam: tolak jika notifikasi dikirim kurang dari 10 menit yang lalu
    if (!force && reservation.delay_notified_at) {
      const elapsedMs = Date.now() - new Date(reservation.delay_notified_at).getTime();
      if (elapsedMs < 10 * 60 * 1000) {
        return {
          success: false,
          code: 'ALREADY_NOTIFIED',
          error: 'Pemberitahuan keterlambatan sudah dikirimkan kurang dari 10 menit yang lalu.',
        };
      }
    }

    const watchdogSettings = await getDelayWatchdogSettings(tenantId);
    const recipients = watchdogSettings.adminRecipients || [];
    if (recipients.length === 0) {
      await this.recordNotifyFailure(tenantId, staffId, reservationId, 'ADMIN_RECIPIENTS_EMPTY');
      return {
        success: false,
        code: 'ADMIN_RECIPIENTS_EMPTY',
        error: 'Nomor WhatsApp admin belum dikonfigurasi di Setelan Klinik.',
      };
    }

    // Draf pesan memakai angka telat & ETA nyata (bukan "beberapa menit").
    const now = new Date();
    let delayMinutesForText: number | null = null;
    let arrivalTimeForText: string | null = null;
    try {
      const clinicLocation = await getClinicLocationAsync(tenantId);
      const staffBase = reservation.assigned_staff
        ? {
            lat: reservation.assigned_staff.base_lat,
            lng: reservation.assigned_staff.base_lng,
            address: reservation.assigned_staff.base_address,
          }
        : null;
      const customerLat =
        (reservation as any).customer_address?.lat ?? reservation.customer?.lat ?? null;
      const customerLng =
        (reservation as any).customer_address?.lng ?? reservation.customer?.lng ?? null;
      const origin = resolveLegOrigin({
        staffBase,
        clinicLocation,
        previousTask: null,
        now,
        maxPrevOriginGapHours: watchdogSettings.maxPrevOriginGapHours,
      });
      const progress =
        origin && customerLat != null && customerLng != null
          ? etaMinutesTo(origin, { lat: customerLat, lng: customerLng })
          : null;
      const prediction = predictTaskDelay({
        bookingDate: reservation.booking_date,
        etaMinutes: progress?.etaMinutes ?? null,
        now,
        toleranceMinutes: watchdogSettings.toleranceMinutes,
        criticalExtraMinutes: watchdogSettings.criticalExtraMinutes,
        hasDeparted: Boolean(reservation.otw_sent_at),
        hasArrived: Boolean(reservation.arrived_at),
      });
      delayMinutesForText = prediction.delayMinutes > 0 ? prediction.delayMinutes : null;
      arrivalTimeForText = prediction.formattedArrivalWib || null;
    } catch {
      delayMinutesForText = null;
      arrivalTimeForText = null;
    }

    let delayText = '';
    try {
      delayText = await StaffReservationService.getTripDelayMessageText(tenantId, {
        patientName: reservation.customer?.name || 'Pasien',
        delayMinutes: delayMinutesForText,
        arrivalTime: arrivalTimeForText,
        variantKey: reservation.id,
      });
    } catch {
      delayText = `Halo Bunda, kami mohon maaf atas keterlambatan kedatangan Bidan.`;
    }

    const staffName = reservation.assigned_staff?.name || 'Bidan';
    const patientName = reservation.customer?.name || 'Pasien';
    const notificationText = `⚠️ *Peringatan Keterlambatan Bidan*\nBidan: ${staffName}\nPasien: Bunda ${patientName}\n\n*Draf pesan untuk customer:*\n"${delayText}"\n\n_Mohon Admin/CS dapat berkoordinasi dengan customer melalui Live Chat._`;

    const gateway = getGateway(tenantId);
    let sentCount = 0;
    let wabaTemplateRequired = false;

    for (const phone of recipients) {
      try {
        const normalized = normalizePhoneID(phone);
        const res = await gateway.sendTextMessage(normalized, notificationText);
        if (res.success) {
          sentCount++;
        } else if (isWabaWindowClosed(res as any)) {
          wabaTemplateRequired = true;
        }
      } catch (err: any) {
        console.warn(`[DELAY_NOTIFY] Gagal kirim WA ke admin: ${err?.message}`);
      }
    }

    if (wabaTemplateRequired && sentCount === 0) {
      await this.recordNotifyFailure(tenantId, staffId, reservation.id, 'WA_TEMPLATE_REQUIRED');
      return {
        success: false,
        code: 'WA_TEMPLATE_REQUIRED',
        error: 'Pesan ke nomor admin di luar jendela 24 jam WhatsApp Business API.',
      };
    }

    if (sentCount === 0) {
      await this.recordNotifyFailure(tenantId, staffId, reservation.id, 'SEND_FAILED');
      return {
        success: false,
        code: 'SEND_FAILED',
        error: 'Gagal mengirim pesan ke seluruh nomor WhatsApp admin yang terdaftar.',
      };
    }

    try {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { delay_notified_at: new Date() },
      });
    } catch (err: any) {
      console.warn(`[DELAY_NOTIFY] Gagal update delay_notified_at: ${err?.message}`);
    }

    await auditService.logAdminAction({
      action: 'STAFF_DELAY_NOTIFY',
      adminIdentity: `staff:${staffId}`,
      tenantId,
      payload: {
        reservationId: reservation.id,
        recipientCount: sentCount,
      },
    });

    return {
      success: true,
      recipientCount: sentCount,
    };
  }
}

export const staffDepartureWatchdogService = new StaffDepartureWatchdogService();

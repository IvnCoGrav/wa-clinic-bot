/**
 * shareloc-signal.service.ts — Evaluator murni sinyal kebutuhan shareloc (GPS pin).
 *
 * Nol DB di dalam file ini; murni fungsi matematis berbasis state sesi & reservasi.
 * Selaras dengan prinsip repo: anti-regex, anti-hardcode teks, data-driven,
 * dan mudah diuji secara adversarial.
 */

import { CONFIRMED_FAMILY_STATUSES, isHoldActive, isTreatmentWithinActiveWindow } from '../domain/reservation-status';
import { getWibNow, formatWibDateYYYYMMDD } from '../utils/wib-time';

export interface SharelocSignalInput {
  locationSource: string | null;      // customers.location_source
  shareLocationSent: boolean;         // customers.share_location_sent
  lat: number | null;
  lng: number | null;
  reservationStatus: string | null;   // hold/confirmed/en_route/pending/null
  reservationBookingDate: Date | string | null;
  reservationCreatedAt: Date | string | null;
  sharelocRequestedAt: Date | string | null; // dari Conversation.session_data / Customer.preferences
  now?: Date;
}

/**
 * Cek apakah koordinat pelanggan sudah termasuk kategori presisi (pin GPS langsung / link koordinat).
 * Samakan dengan CustomerService.isPreciseGps dan geoUtils: gps_pin, bidan_shareloc, customer_shareloc, url_coords
 * ATAU (shareLocationSent=true dengan lat/lng valid).
 */
export function isPreciseGpsLike(i: SharelocSignalInput): boolean {
  const src = (i.locationSource || '').toLowerCase().trim();
  if (src === 'gps_pin' || src === 'bidan_shareloc' || src === 'customer_shareloc' || src === 'url_coords') {
    return true;
  }
  return !!i.shareLocationSent && Number.isFinite(Number(i.lat)) && Number.isFinite(Number(i.lng));
}

/**
 * Jam ramah pengiriman otomatis (WIB): pukul 08:00 sampai 19:59 WIB.
 * Menggunakan getWibNow(now).getUTCHours() untuk konsistensi zona waktu WIB terlepas dari OS/server time.
 */
export function isFriendlyHoursWib(now: Date = new Date()): boolean {
  const h = getWibNow(now).getUTCHours();
  return h >= 8 && h < 20;
}

/**
 * Evaluasi status apakah pelanggan butuh diminta shareloc (pin GPS).
 * Output deterministik: { needed: boolean; urgent: boolean; reason: string }.
 */
export function computeSharelocSignal(i: SharelocSignalInput): { needed: boolean; urgent: boolean; reason: string } {
  if (!i.reservationStatus) {
    return { needed: false, urgent: false, reason: 'no_reservation' };
  }

  const st = i.reservationStatus.toLowerCase().trim();
  const isHold = st === 'hold';
  const isConfirmedFam = CONFIRMED_FAMILY_STATUSES.includes(st);

  if (!isHold && !isConfirmedFam) {
    return { needed: false, urgent: false, reason: 'status_not_active' };
  }

  const nowMs = (i.now || new Date()).getTime();

  if (isHold && !isHoldActive(i.reservationBookingDate, nowMs)) {
    return { needed: false, urgent: false, reason: 'hold_expired' };
  }

  if (isConfirmedFam && !isTreatmentWithinActiveWindow(i.reservationBookingDate, nowMs)) {
    return { needed: false, urgent: false, reason: 'outside_window' };
  }

  if (isPreciseGpsLike(i)) {
    return { needed: false, urgent: false, reason: 'already_precise' };
  }

  if (i.sharelocRequestedAt) {
    const reqMs = new Date(i.sharelocRequestedAt).getTime();
    if (!Number.isNaN(reqMs)) {
      const ageH = (nowMs - reqMs) / 3_600_000;
      if (ageH < 6) {
        return { needed: false, urgent: false, reason: 'cooldown_6h' };
      }
    }
  }

  const isSameDay = i.reservationBookingDate
    ? formatWibDateYYYYMMDD(new Date(i.reservationBookingDate)) === formatWibDateYYYYMMDD(new Date(nowMs))
    : false;

  const createdMs = i.reservationCreatedAt ? new Date(i.reservationCreatedAt).getTime() : nowMs;
  const ageResH = (nowMs - createdMs) / 3_600_000;

  if (isSameDay) {
    return { needed: true, urgent: true, reason: 'same_day' };
  }

  if (ageResH < 3) {
    return { needed: false, urgent: false, reason: 'advance_wait_3h' };
  }

  return { needed: true, urgent: false, reason: 'advance_due' };
}

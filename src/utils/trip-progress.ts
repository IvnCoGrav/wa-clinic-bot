/**
 * trip-progress.ts
 *
 * Rumus murni (tanpa I/O) untuk jarak, ETA, dan prediksi keterlambatan perjalanan
 * terapis. Dipindah dari `staff-trip-tracking.service.ts` agar layer domain
 * (`src/domain/**`) dapat memakainya tanpa melanggar batas arsitektur
 * (domain dilarang mengimpor service).
 *
 * Modul ini TIDAK menyentuh Prisma/Redis/network.
 */

import { haversineKm } from './gazetteer';

/** Ambang keterlambatan bawaan: warning (menit). */
export const DELAY_WARN_MIN = 20;
/** Ambang keterlambatan bawaan: critical (menit). */
export const DELAY_CRITICAL_MIN = 30;

export type DelayLevel = 'none' | 'warning' | 'critical';

export interface DelayStatusResult {
  isDelayed: boolean;
  level: DelayLevel;
  /** Estimasi tiba (menit) relatif terhadap jadwal. Positif = terlambat. */
  delayMinutes: number;
  estimatedArrivalIso: string;
  formattedArrivalWib: string;
  reason: 'OK' | 'NO_SCHEDULE' | 'NO_ETA';
}

export interface TripProgress {
  remainingKm: number;
  etaMinutes: number;
}

export const WIB_TIME_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Sisa jarak + ETA motor. Faktor 1.25x untuk rute jalan vs garis lurus,
 * kecepatan rerata 25 km/jam urban. Clamp 1-120 menit.
 */
export function calculateTripProgress(
  therapistLat: number,
  therapistLng: number,
  customerLat: number,
  customerLng: number
): TripProgress | null {
  if (!isValidCoord(therapistLat, therapistLng)) return null;
  if (!isValidCoord(customerLat, customerLng)) return null;
  try {
    const raw = haversineKm(therapistLat, therapistLng, customerLat, customerLng);
    if (!Number.isFinite(raw) || raw < 0) return null;
    const remainingKm = Math.round(raw * 1.25 * 10) / 10;
    const etaMinutes = Math.min(120, Math.max(1, Math.round((remainingKm / 25) * 60)));
    return { remainingKm, etaMinutes };
  } catch {
    return null;
  }
}

/**
 * Prediksi keterlambatan terapis vs jadwal reservasi. Murni deterministik (tanpa I/O).
 *
 * `delayMinutes` = estimasiTiba - jadwal (BUKAN minus toleransi). `level`:
 * `none` (< warn), `warning` (>= warn), `critical` (>= critical).
 * Fail-open: jadwal/ETA tidak diketahui -> `none` (jangan menuduh telat tanpa dasar).
 */
export function calculateDelayStatus(
  bookingDate: Date | null | undefined,
  etaMinutes: number | null | undefined,
  now: Date = new Date(),
  opts?: { warnMin?: number; criticalMin?: number }
): DelayStatusResult {
  const empty = (reason: DelayStatusResult['reason']): DelayStatusResult => ({
    isDelayed: false,
    level: 'none',
    delayMinutes: 0,
    estimatedArrivalIso: '',
    formattedArrivalWib: '',
    reason,
  });

  const bookingMs = bookingDate instanceof Date ? bookingDate.getTime() : NaN;
  if (!Number.isFinite(bookingMs)) return empty('NO_SCHEDULE');
  if (etaMinutes == null || !Number.isFinite(Number(etaMinutes))) return empty('NO_ETA');

  const eta = Math.max(0, Number(etaMinutes));
  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const arrivalMs = nowMs + eta * 60 * 1000;
  const delayMinutes = Math.round((arrivalMs - bookingMs) / 60000);

  const warnMin = opts?.warnMin != null && Number.isFinite(opts.warnMin) ? opts.warnMin : DELAY_WARN_MIN;
  const criticalMin =
    opts?.criticalMin != null && Number.isFinite(opts.criticalMin) ? opts.criticalMin : DELAY_CRITICAL_MIN;

  let level: DelayLevel = 'none';
  if (delayMinutes >= criticalMin) level = 'critical';
  else if (delayMinutes >= warnMin) level = 'warning';

  const arrivalDate = new Date(arrivalMs);
  return {
    isDelayed: level !== 'none',
    level,
    delayMinutes,
    estimatedArrivalIso: arrivalDate.toISOString(),
    formattedArrivalWib: WIB_TIME_FORMATTER.format(arrivalDate),
    reason: 'OK',
  };
}

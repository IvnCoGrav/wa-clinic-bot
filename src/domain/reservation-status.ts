/**
 * reservation-status.ts — Single Source of Truth domain status reservasi.
 *
 * Modul daun (zero import) agar dapat dipakai lintas service (conversation,
 * copilot, follow-up) tanpa memicu circular dependency. Nilai status di sini
 * adalah KONTRAK DOMAIN, bukan katalog bisnis — katalog/tarif tetap di DB.
 */

/** Status reservasi yang dihitung sebagai "jadwal aktif" (menjadwalkan pasien). */
export const ACTIVE_RESERVATION_STATUSES: string[] = ['confirmed', 'pending', 'hold'];

export type ActiveReservationStatus = 'confirmed' | 'pending' | 'hold';

/** Jendela validitas hold: hold kedaluwarsa bila booking_date lewat > 2 jam. */
export const ACTIVE_HOLD_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Batas bawah booking_date agar sebuah `hold` masih dianggap aktif.
 * Dipakai untuk membangun kondisi Prisma (`booking_date: { gte: cutoff }`).
 */
export function activeHoldCutoff(nowMs: number = Date.now()): Date {
  return new Date(nowMs - ACTIVE_HOLD_WINDOW_MS);
}

/**
 * Apakah sebuah reservasi (row apa pun) termasuk reservasi aktif.
 * Paritas persis dengan LiveChatMonitor.hasActiveHold/hasPendingBooking/
 * hasUpcomingBooking: confirmed (kapan pun) | pending (kapan pun) |
 * hold (hanya bila booking_date dalam jendela 2 jam).
 */
export function isActiveReservation(
  reservation: { status?: string | null; booking_date?: Date | string | null } | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!reservation || !reservation.status) return false;
  if (reservation.status === 'confirmed' || reservation.status === 'pending') return true;
  if (reservation.status === 'hold') return isHoldActive(reservation.booking_date, nowMs);
  return false;
}

/** Apakah hold masih aktif (booking_date belum lewat > 2 jam). */
export function isHoldActive(
  bookingDate: Date | string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!bookingDate) return false;
  const t = new Date(bookingDate).getTime();
  if (Number.isNaN(t)) return false;
  return t >= nowMs - ACTIVE_HOLD_WINDOW_MS;
}

/**
 * reservation-status.ts — Single Source of Truth domain status reservasi.
 *
 * Modul daun (zero import) agar dapat dipakai lintas service (conversation,
 * copilot, follow-up) tanpa memicu circular dependency. Nilai status di sini
 * adalah KONTRAK DOMAIN, bukan katalog bisnis — katalog/tarif tetap di DB.
 */

/** Status reservasi yang dihitung sebagai "jadwal aktif" (menjadwalkan pasien). */
export const ACTIVE_RESERVATION_STATUSES: string[] = ['confirmed', 'en_route', 'pending', 'hold'];

export type ActiveReservationStatus = 'confirmed' | 'en_route' | 'pending' | 'hold';

/**
 * `en_route` — Bidan sudah berangkat menuju lokasi pasien (dipicu dari tombol
 * Navigasi/OTW). Secara semantik = `confirmed` yang sedang berlangsung: tetap
 * menempati slot, tetap dihitung sebagai kunjungan aktif, dan tetap dianggap
 * kunjungan sah saat dihitung sebagai riwayat.
 */
export const EN_ROUTE_STATUS = 'en_route';

/** True bila status termasuk "jadwal aktif" (occupied slot). */
export function isActiveReservationStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ACTIVE_RESERVATION_STATUSES.includes(status);
}

/** Status yang setara `confirmed` untuk perhitungan riwayat (termasuk en_route). */
export const CONFIRMED_FAMILY_STATUSES: string[] = ['confirmed', 'en_route'];

/** Jendela validitas hold: hold kedaluwarsa bila booking_date lewat > 2 jam. */
export const ACTIVE_HOLD_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Jendela toleransi keterlambatan treatment (jam janji temu) untuk semua status
 * aktif. Sama dengan jendela hold: reservasi yang jam treatment-nya sudah lewat
 * >2 jam TIDAK lagi dianggap aktif (tidak muncul di tab Reservasi Aktif).
 */
export const ACTIVE_TREATMENT_WINDOW_MS = ACTIVE_HOLD_WINDOW_MS;

/**
 * Batas bawah booking_date agar sebuah `hold` masih dianggap aktif.
 * Dipakai untuk membangun kondisi Prisma (`booking_date: { gte: cutoff }`).
 */
export function activeHoldCutoff(nowMs: number = Date.now()): Date {
  return new Date(nowMs - ACTIVE_HOLD_WINDOW_MS);
}

/** Batas bawah booking_date agar treatment masih dalam jendela aktif (alias hold). */
export function activeTreatmentCutoff(nowMs: number = Date.now()): Date {
  return new Date(nowMs - ACTIVE_TREATMENT_WINDOW_MS);
}

/**
 * Apakah booking_date sebuah treatment masih dalam jendela aktif
 * (`booking_date >= now - 2 jam`). Reservasi TANPA booking_date (mis. pending
 * baru yang belum memilih jadwal) tetap dianggap aktif agar pasien tidak
 * hilang dari pandangan admin. Tanggal korup juga fail-open (lebih aman
 * menampilkan pasien daripada menyembunyikannya).
 */
export function isTreatmentWithinActiveWindow(
  bookingDate: Date | string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (bookingDate === null || bookingDate === undefined) return true;
  const t = new Date(bookingDate).getTime();
  if (Number.isNaN(t)) return true;
  return t >= nowMs - ACTIVE_TREATMENT_WINDOW_MS;
}

/**
 * Membangun klausa Prisma `reservations.some` untuk reservasi aktif:
 *   confirmed | en_route | pending → booking_date null ATAU dalam jendela 2 jam;
 *   hold                          → booking_date dalam jendela 2 jam.
 * Paritas dengan `isActiveReservation` + `isTreatmentWithinActiveWindow`.
 */
export function activeReservationWhere(nowMs: number = Date.now()): { OR: any[] } {
  const cutoff = activeTreatmentCutoff(nowMs);
  const scheduledStatuses = ['confirmed', 'en_route', 'pending'];
  return {
    OR: [
      { status: { in: scheduledStatuses }, booking_date: null },
      { status: { in: scheduledStatuses }, booking_date: { gte: cutoff } },
      { status: 'hold', booking_date: { gte: cutoff } },
    ],
  };
}

/**
 * Apakah sebuah reservasi (row apa pun) termasuk reservasi aktif.
 * Paritas dengan LiveChatMonitor.hasActiveHold/hasPendingBooking/
 * hasUpcomingBooking: confirmed/en_route/pending hanya bila booking_date masih
 * dalam jendela 2 jam (atau null); hold hanya bila dalam jendela 2 jam.
 */
export function isActiveReservation(
  reservation: { status?: string | null; booking_date?: Date | string | null } | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!reservation || !reservation.status) return false;
  if (reservation.status === 'confirmed' || reservation.status === 'en_route' || reservation.status === 'pending') {
    return isTreatmentWithinActiveWindow(reservation.booking_date, nowMs);
  }
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

/** Hold aktif berbasis created_at (untuk slot masa depan: hold H+7 tetap expired 2 jam setelah dibuat). */
export function isHoldActiveByCreated(
  createdAt: Date | string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t <= ACTIVE_HOLD_WINDOW_MS;
}

/** Buffer slot tunggal (menit) — ganti semua +15/+20 tersebar. */
export const SLOT_BUFFER_MIN = 20;

/** Matriks transisi status legal (deterministik, tanpa tebak). */
export function canTransition(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!from || !to || from === to) return false;
  const f = String(from);
  const t = String(to);
  if (t === 'hold') return f === 'pending';
  if (f === 'hold') return t === 'confirmed' || t === 'pending' || t === 'cancelled';
  if (f === 'pending') return t === 'confirmed' || t === 'cancelled' || t === 'hold';
  if (f === 'confirmed' || f === 'en_route') return t === 'completed' || t === 'cancelled';
  return false;
}

/**
 * Guard "premature completion": reservasi TIDAK BOLEH ditandai `completed`
 * sebelum tanggal kunjungan tiba. Booking hari-H (same-day) tetap sah
 * diselesaikan kapan saja pada hari itu, sehingga hanya booking lebih dari
 * 24 jam ke depan yang ditolak. Deterministik berbasis `booking_date`
 * (bukan teks), tanpa dependency tambahan.
 */
export const PREMATURE_COMPLETION_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export function isPrematureCompletion(
  bookingDate: Date | string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!bookingDate) return false;
  const t = new Date(bookingDate).getTime();
  if (Number.isNaN(t)) return false;
  return t > nowMs + PREMATURE_COMPLETION_TOLERANCE_MS;
}

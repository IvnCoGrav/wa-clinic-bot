import { formatWibDateYYYYMMDD, formatWibTime } from '../utils/wib-time';

/**
 * reservation-intake.ts — Otoritas tunggal kontrak intake reservasi KANAL CUSTOMER
 * (form WA via state machine + V3 tool `save_reservation`). #157a.
 *
 * Akar masalah (audit #157a): jalur form WA memanggil `saveReservation` dengan
 * `status:'confirmed'` TANPA requestId. Akibatnya:
 *  1. Permintaan same-day lolos menjadi `confirmed` tanpa awareness admin
 *     (V3 tool memakai `pending` + penanda `[SAME_DAY_REQUEST]` → KB-2).
 *  2. Double-submit / redelivery menghasilkan baris duplikat (tanpa idempotency key).
 *
 * Seam ini menyatukan logika tersebut (sebelumnya inline di `save-reservation.tool.ts`)
 * agar SEMUA jalur customer memakai kontrak yang sama. Murni tanpa I/O.
 */

/** Penanda same-day yang dikenali `reservation-core.service.ts` (KB-2). */
export const SAME_DAY_REQUEST_TAG = '[SAME_DAY_REQUEST] Perlu cek rute terapis hari ini';

/** True bila dua Date jatuh pada hari kalender WIB (UTC+7) yang sama. Murni. */
export function isSameWibCalendarDay(d1: Date, d2: Date): boolean {
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const w1 = new Date(d1.getTime() + WIB_OFFSET_MS);
  const w2 = new Date(d2.getTime() + WIB_OFFSET_MS);
  return (
    w1.getUTCFullYear() === w2.getUTCFullYear() &&
    w1.getUTCMonth() === w2.getUTCMonth() &&
    w1.getUTCDate() === w2.getUTCDate()
  );
}

export interface SameDayInput {
  /** Sinyal teks eksplisit ("sekarang"/"hari ini") dari jalur pemanggil. */
  sameDayText?: boolean;
}

/**
 * True bila booking tergolong same-day: sinyal teks eksplisit ATAU tanggal parsed
 * jatuh pada hari WIB yang sama dengan sekarang. `now` dapat diinjeksi untuk uji.
 */
export function isSameDayBooking(
  bookingDate: Date | null | undefined,
  opts: SameDayInput = {},
  now: Date = new Date()
): boolean {
  if (opts.sameDayText) return true;
  if (!bookingDate || isNaN(bookingDate.getTime())) return false;
  return isSameWibCalendarDay(bookingDate, now);
}

export interface CustomerReservationIntakeInput {
  tenantId: string;
  customerId: string;
  treatmentDetail: string;
  bookingDate: Date | null | undefined;
  /** Sinyal teks same-day dari pemanggil (mis. deteksi "hari ini"/"sekarang"). */
  sameDayText?: boolean;
  /** Injeksi waktu untuk uji deterministik. */
  now?: Date;
}

export interface CustomerReservationIntakeMeta {
  isSameDay: boolean;
  /** Status awal kanonis untuk kanal customer. */
  status: 'pending' | 'confirmed';
  /** Penanda same-day untuk raw_text ('' bila bukan same-day). */
  sameDayTag: string;
  /** Idempotency key kanonis (tenant:customer:tanggalWIB:jamWIB:treatment). */
  requestId: string;
}

/**
 * Bangun metadata intake kanonis untuk reservasi kanal customer.
 * - same-day → status `pending` + tag `[SAME_DAY_REQUEST]` (awareness admin / KB-2).
 * - requestId stabil memuat jam WIB (173f: booking pagi & sore tak saling timpa).
 */
export function buildCustomerReservationIntake(
  input: CustomerReservationIntakeInput
): CustomerReservationIntakeMeta {
  const { tenantId, customerId, treatmentDetail, bookingDate, sameDayText } = input;
  const sameDay = isSameDayBooking(bookingDate, { sameDayText }, input.now);
  const requestId = `${tenantId}:${customerId}:${formatWibDateYYYYMMDD(
    bookingDate || new Date()
  )}:${formatWibTime(bookingDate || new Date())}:${treatmentDetail}`;
  return {
    isSameDay: sameDay,
    status: sameDay ? 'pending' : 'confirmed',
    sameDayTag: sameDay ? SAME_DAY_REQUEST_TAG : '',
    requestId,
  };
}

import { resolveReservationPaymentEvaluation } from '../../../services/reservation-core.service';

/**
 * Menyematkan hasil evaluasi pembayaran kanonis (`paymentEvaluation`) ke dalam payload respons reservasi admin.
 * Fungsi ini murni presentational (response wrapper) di layer route, tidak memutasi objek asli.
 */
export function withPaymentEvaluation<T extends Record<string, any>>(r: T | null | undefined) {
  if (!r) return r;
  return { ...r, paymentEvaluation: resolveReservationPaymentEvaluation(r) };
}

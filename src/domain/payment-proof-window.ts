/**
 * payment-proof-window.ts
 *
 * Batas validasi jendela pencocokan bukti pembayaran (murni, tanpa I/O).
 * Dipakai route settings agar angka dari klien tidak bisa mematikan otomasi (0)
 * atau membuka pencocokan hampir tanpa batas (mis. 9999).
 */

export const PAYMENT_PROOF_WINDOW_MIN_DAYS = 1;
export const PAYMENT_PROOF_WINDOW_MAX_DAYS = 30;
export const PAYMENT_PROOF_WINDOW_DEFAULT_DAYS = 7;

/**
 * Membulatkan dan menjepit nilai jendela ke rentang 1..30 hari.
 * Nilai bukan angka (undefined, null, string, NaN) dikembalikan ke `fallback`.
 */
export function clampPaymentProofWindowDays(
  value: unknown,
  fallback: number = PAYMENT_PROOF_WINDOW_DEFAULT_DAYS
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(
    PAYMENT_PROOF_WINDOW_MAX_DAYS,
    Math.max(PAYMENT_PROOF_WINDOW_MIN_DAYS, Math.round(value))
  );
}

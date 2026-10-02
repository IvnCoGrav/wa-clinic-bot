/**
 * reservation-payment.ts — Seam kanonis status finansial (Fase 0).
 * Lunas = murni `purchase_occurred_at` ada. Status operasional
 * (confirmed/completed) BUKAN bukti bayar. Zero-import agar reusable.
 */
export function isReservationPaid(r: { purchase_occurred_at?: Date | string | null } | null | undefined): boolean {
  return Boolean(r?.purchase_occurred_at);
}

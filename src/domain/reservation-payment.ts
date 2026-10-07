/**
 * reservation-payment.ts — Seam kanonis status finansial (Fase 0).
 * Lunas = murni `purchase_occurred_at` ada. Status operasional
 * (confirmed/completed) BUKAN bukti bayar. Zero-import agar reusable.
 */
export function isReservationPaid(r: { purchase_occurred_at?: Date | string | null } | null | undefined): boolean {
  return Boolean(r?.purchase_occurred_at);
}

/**
 * Status finansial tampilan (tri-state) — memisahkan "selesai dikerjakan"
 * dari "uang sudah diterima". Dipakai reader (ledger admin, notifikasi) agar
 * reservasi `completed` yang belum diverifikasi bayar TIDAK salah dilabeli
 * "Tagih di Tempat" (yang mengesankan kunjungan belum terjadi).
 *
 * - LUNAS                    : ada catatan pembayaran (purchase_occurred_at).
 * - SELESAI_BELUM_VERIFIKASI : kunjungan selesai, pembayaran belum tercatat.
 * - TAGIH_DI_TEMPAT          : belum selesai / belum bayar (menunggu kunjungan).
 */
export type PaymentDisplayStatus = 'LUNAS' | 'SELESAI_BELUM_VERIFIKASI' | 'TAGIH_DI_TEMPAT';

export function getPaymentDisplayStatus(
  r: { status?: string | null; purchase_occurred_at?: Date | string | null } | null | undefined
): PaymentDisplayStatus {
  if (isReservationPaid(r)) return 'LUNAS';
  const status = r?.status ? String(r.status).toLowerCase() : '';
  if (status === 'completed') return 'SELESAI_BELUM_VERIFIKASI';
  return 'TAGIH_DI_TEMPAT';
}

export function getPaymentDisplayLabel(status: PaymentDisplayStatus): string {
  switch (status) {
    case 'LUNAS':
      return 'Lunas';
    case 'SELESAI_BELUM_VERIFIKASI':
      return 'Selesai — verifikasi bayar';
    default:
      return 'Tagih di Tempat';
  }
}

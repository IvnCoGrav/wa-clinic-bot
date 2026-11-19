/**
 * reservationCommercialPayload.ts
 * Kontrak komersial kanonis untuk payload reservasi (single & series).
 *
 * `purchaseValue` WAJIB GROSS (harga layanan sebelum diskon) dan diskon dikirim
 * terpisah lewat `discountAmount`. Server (dan invoice) menghitung net sebagai
 * `gross - diskon`, sehingga mengirim NET di `purchaseValue` membuat diskon
 * terpotong DUA KALI (bug jalur multi-sesi sebelum 2026-11-19).
 *
 * Meta CAPI juga memakai `purchase_value` sebagai nilai GROSS (D4).
 */

export interface ReservationCommercialPayload {
  /** Harga layanan sebelum diskon (GROSS). */
  purchaseValue: number;
  /** Diskon terpisah, sudah dijepit ke rentang 0..gross. */
  discountAmount: number;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Bangun field komersial payload reservasi dari subtotal layanan + diskon.
 * Murni (tanpa efek samping) agar mudah diuji adversarial.
 */
export function buildReservationCommercialPayload(
  subtotalTreatments: number | string | null | undefined,
  discount: number | string | null | undefined
): ReservationCommercialPayload {
  const gross = Math.max(0, toNumber(subtotalTreatments));
  const discountAmount = Math.min(gross, Math.max(0, toNumber(discount)));

  return {
    purchaseValue: gross,
    discountAmount,
  };
}

/**
 * Gerbang kesiapan invoice Live Chat (audit #316 / K-02).
 *
 * Invoice TIDAK BOLEH dibuat dari angka atau layanan karangan. Sebelumnya
 * `handleGenerateAndInsertInvoice` memakai fallback 3,0 km / ongkir 0 /
 * "Pijat Ceria" / "12.00-12.30" sehingga tagihan bisa salah secara finansial.
 *
 * Fungsi murni ini dipakai UI dan diuji adversarial (termasuk 0 sebagai nilai sah).
 */

export type InvoiceReadinessReason =
  | 'INVALID_SCHEDULE'
  | 'MISSING_TREATMENT'
  | 'MISSING_DISTANCE'
  | 'INVALID_NUMBER';

export type InvoiceReadinessResult =
  | {
      ok: true;
      bookingDate: Date;
      treatmentName: string;
      distanceKm: number;
      ongkir: number;
    }
  | { ok: false; reason: InvoiceReadinessReason };

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function validateInvoiceReadiness(input: {
  bookingDate?: string | Date | null;
  treatmentName?: string | null;
  distanceKm?: number | string | null;
  ongkir?: number | string | null;
}): InvoiceReadinessResult {
  const bookingDate = input.bookingDate ? new Date(input.bookingDate) : null;
  if (!bookingDate || Number.isNaN(bookingDate.getTime())) {
    return { ok: false, reason: 'INVALID_SCHEDULE' };
  }

  const treatmentName = String(input.treatmentName || '').trim();
  if (!treatmentName) {
    return { ok: false, reason: 'MISSING_TREATMENT' };
  }

  // Penting: 0 adalah nilai SAH (mis. ongkir gratis / ambil sendiri).
  // Yang memblokir adalah null/undefined/string kosong, bukan nol.
  if (isBlank(input.distanceKm) || isBlank(input.ongkir)) {
    return { ok: false, reason: 'MISSING_DISTANCE' };
  }

  const distanceKm = Number(input.distanceKm);
  const ongkir = Number(input.ongkir);
  if (
    !Number.isFinite(distanceKm) ||
    !Number.isFinite(ongkir) ||
    distanceKm < 0 ||
    ongkir < 0
  ) {
    return { ok: false, reason: 'INVALID_NUMBER' };
  }

  return { ok: true, bookingDate, treatmentName, distanceKm, ongkir };
}

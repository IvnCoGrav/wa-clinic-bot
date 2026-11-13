import { DEFAULT_TENANT_ID } from '../config/tenant';
import { resolveDeliveryFeeSnapshot } from './reservation-core.service';
import { resolveTreatmentValue } from './capi.service';

/**
 * Seam kanonis nilai tagihan reservasi.
 *
 * Sebelumnya formula ini hidup inline di `FinancialAnalyticsService` (dan
 * menyalinnya ke modul lain berisiko menghasilkan angka berbeda untuk reservasi
 * yang sama). Prioritas nilai layanan:
 *   1. `purchase_value` (snapshot harga saat booking)
 *   2. jumlah `items[].price` (tabel relasional reservation_items)
 *   3. harga katalog via `resolveTreatmentValue` (fallback baris lama)
 *
 * Ongkir memakai `resolveDeliveryFeeSnapshot` (snapshot `delivery_fee`, fallback
 * `Customer.ongkir` untuk baris pra-migrasi).
 */
export interface ReservationBilling {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  /** Jumlah item layanan pada reservasi (0 bila tidak ada data). */
  itemCount: number;
}

/** Cache resolusi katalog per-batch agar 1 treatment_detail tidak di-query berulang. */
export type CatalogPriceCache = Map<string, Promise<number | undefined>>;

function toNonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sumItemPrices(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc: number, it: any) => acc + toNonNegativeNumber(it?.price), 0);
}

function countItems(items: unknown): number {
  return Array.isArray(items) ? items.length : 0;
}

function catalogCacheKey(tenantId: string, treatmentDetail: string): string {
  return `${tenantId}|${treatmentDetail.trim().toLowerCase()}`;
}

/**
 * Hitung nilai tagihan satu reservasi. Async karena fallback katalog membaca
 * service katalog (in-memory) — tidak menyentuh DB langsung.
 *
 * `cache` opsional dipakai pemanggil batch (mis. analitik bulanan) supaya
 * treatment_detail yang sama tidak di-resolve berkali-kali.
 */
export async function resolveReservationBilling(
  reservation: any,
  tenantId: string = DEFAULT_TENANT_ID,
  cache?: CatalogPriceCache
): Promise<ReservationBilling> {
  const treatmentDetail: string | null =
    typeof reservation?.treatment_detail === 'string' ? reservation.treatment_detail : null;

  let treatmentFee = toNonNegativeNumber(reservation?.purchase_value);
  if (treatmentFee <= 0) {
    treatmentFee = sumItemPrices(reservation?.items);
  }
  if (treatmentFee <= 0 && treatmentDetail) {
    const key = catalogCacheKey(tenantId, treatmentDetail);
    let pending = cache?.get(key);
    if (!pending) {
      pending = resolveTreatmentValue(treatmentDetail, tenantId).catch(() => undefined);
      cache?.set(key, pending);
    }
    const resolved = await pending;
    if (resolved && resolved > 0) treatmentFee = resolved;
  }

  const deliveryFee = toNonNegativeNumber(resolveDeliveryFeeSnapshot(reservation));
  const totalFee = treatmentFee + deliveryFee;
  const itemCount = countItems(reservation?.items) || (treatmentDetail ? 1 : 0);

  return { treatmentFee, deliveryFee, totalFee, itemCount };
}

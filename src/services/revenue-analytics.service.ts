import { resolveReservationBilling, type CatalogPriceCache } from './reservation-billing.service';
import { isReservationPaid } from '../domain/reservation-payment';
import type { RevenueAmounts, RevenueQuery } from '../domain/analytics-contract';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Seam kanonis agregasi nilai revenue dan status pembayaran reservasi.
 * Menghubungkan resolusi billing (layanan, diskon, ongkir) dengan status pembayaran riil.
 */
export async function resolveRevenueAmounts(
  reservation: any,
  tenantId: string = DEFAULT_TENANT_ID,
  query: Pick<RevenueQuery, 'includeDeliveryFee'> = { includeDeliveryFee: true },
  cache?: CatalogPriceCache
): Promise<RevenueAmounts> {
  const billing = await resolveReservationBilling(reservation, tenantId, cache);
  const deliveryFee = query.includeDeliveryFee ? billing.deliveryFee : 0;
  const bookingValue = billing.netFee + deliveryFee;
  const isPaid = isReservationPaid(reservation);
  return {
    treatmentGross: billing.treatmentFee,
    discount: billing.discount,
    treatmentNet: billing.netFee,
    deliveryFee,
    bookingValue,
    paidAmount: isPaid ? bookingValue : 0,
    pendingAmount: isPaid ? 0 : bookingValue,
    isPaid,
  };
}

export function createRevenueAccumulator(): RevenueAmounts {
  return {
    treatmentGross: 0,
    discount: 0,
    treatmentNet: 0,
    deliveryFee: 0,
    bookingValue: 0,
    paidAmount: 0,
    pendingAmount: 0,
    isPaid: false,
  };
}

export function addRevenueAmounts(target: RevenueAmounts, amount: RevenueAmounts): void {
  target.treatmentGross += amount.treatmentGross;
  target.discount += amount.discount;
  target.treatmentNet += amount.treatmentNet;
  target.deliveryFee += amount.deliveryFee;
  target.bookingValue += amount.bookingValue;
  target.paidAmount += amount.paidAmount;
  target.pendingAmount += amount.pendingAmount;
  target.isPaid = target.pendingAmount === 0 && target.bookingValue > 0;
}

/**
 * analytics-contract.ts — Kontrak kanonis revenue dan analitik dashboard.
 *
 * Mendefinisikan tipe, query standar, dan helper deterministik untuk
 * penyelarasan multi-basis finansial seluruh dashboard klinik.
 */

export type RevenueBasis = 'booking_date' | 'created_at';

export type RevenueStatusFilter =
  | 'all_non_cancelled'
  | 'completed_only'
  | 'confirmed_and_completed'
  | 'confirmed_only';

export interface RevenueQuery {
  basis: RevenueBasis;
  statusFilter: RevenueStatusFilter;
  includeDeliveryFee: boolean;
  includePending: boolean;
  includeUpcoming: boolean;
}

export interface RevenueAmounts {
  treatmentGross: number;
  discount: number;
  treatmentNet: number;
  deliveryFee: number;
  bookingValue: number; // treatmentNet + deliveryFee
  paidAmount: number;
  pendingAmount: number;
  isPaid: boolean;
}

export interface RevenueBasisMeta extends RevenueQuery {
  discountApplied: boolean;
  label: string;
}

export const DEFAULT_REVENUE_QUERY: RevenueQuery = {
  basis: 'booking_date',
  statusFilter: 'all_non_cancelled',
  includeDeliveryFee: true,
  includePending: true,
  includeUpcoming: true,
};

export function isRevenueStatusIncluded(
  status: string | null | undefined,
  filter: RevenueStatusFilter
): boolean {
  const s = String(status ?? '').toLowerCase().trim();
  if (s === 'cancelled' || s === 'rejected') return false;
  switch (filter) {
    case 'completed_only':
      return s === 'completed';
    case 'confirmed_and_completed':
      return s === 'completed' || s === 'confirmed';
    case 'confirmed_only':
      return s === 'confirmed';
    case 'all_non_cancelled':
    default:
      return true;
  }
}

export function describeRevenueBasis(query: RevenueQuery): string {
  const basis = query.basis === 'booking_date' ? 'tanggal treatment' : 'tanggal booking dibuat';
  const statusLabels: Record<RevenueStatusFilter, string> = {
    all_non_cancelled: 'semua non-cancelled',
    completed_only: 'hanya selesai',
    confirmed_and_completed: 'confirmed + selesai',
    confirmed_only: 'hanya confirmed',
  };
  const status = statusLabels[query.statusFilter] ?? 'semua non-cancelled';
  return [
    `Basis ${basis}`,
    status,
    query.includePending ? 'termasuk tagihan' : 'hanya lunas',
    query.includeUpcoming ? 'termasuk jadwal mendatang' : 'tanpa jadwal mendatang',
    query.includeDeliveryFee ? 'termasuk ongkir' : 'tanpa ongkir',
  ].join('; ');
}

export function buildRevenueBasisMeta(query: RevenueQuery): RevenueBasisMeta {
  return { ...query, discountApplied: true, label: describeRevenueBasis(query) };
}

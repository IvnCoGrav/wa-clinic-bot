/**
 * Kontrak kanonik tunggal: status review CAPI TIDAK BOLEH turun dari 'approved'
 * sekali pun event Purchase sudah pernah terkirim ke Meta (audit integritas state).
 */
export const PURCHASE_REVIEW_NOT_APPLICABLE = 'not_applicable' as const;

export const CAPI_QUEUE_EXCLUDED_RESERVATION_STATUSES = [
  'cancelled',
  'rejected',
  'hold',
] as const;

export type PurchaseReviewStatus =
  | 'pending'
  | 'approved'
  | 'ignored_outlier'
  | typeof PURCHASE_REVIEW_NOT_APPLICABLE;

export function isPurchaseAlreadyApproved(r: {
  purchase_review_status?: string | null;
  purchase_event_sent_at?: Date | string | null;
} | null | undefined): boolean {
  if (!r) return false;
  return r.purchase_review_status === 'approved' || Boolean(r.purchase_event_sent_at);
}

export function resolveNextPurchaseReviewStatus(
  r: { purchase_review_status?: string | null; purchase_event_sent_at?: Date | string | null } | null | undefined,
  fallback: PurchaseReviewStatus = 'pending'
): string {
  if (isPurchaseAlreadyApproved(r)) return 'approved';
  const current = r?.purchase_review_status;
  if (!current || current === PURCHASE_REVIEW_NOT_APPLICABLE) return fallback;
  return current;
}

/**
 * Saat reservasi dikonfirmasi: pertahankan keputusan moderasi yang sudah final,
 * selain itu masuk antrean CAPI sebagai pending.
 */
export function resolvePurchaseReviewOnConfirm(
  r: { purchase_review_status?: string | null; purchase_event_sent_at?: Date | string | null } | null | undefined
): 'pending' | 'approved' | 'ignored_outlier' {
  if (isPurchaseAlreadyApproved(r)) return 'approved';
  if (r?.purchase_review_status === 'ignored_outlier') return 'ignored_outlier';
  return 'pending';
}


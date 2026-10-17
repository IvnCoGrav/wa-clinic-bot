/**
 * Kontrak kanonik tunggal: status review CAPI TIDAK BOLEH turun dari 'approved'
 * sekali pun event Purchase sudah pernah terkirim ke Meta (audit integritas state).
 */
export type PurchaseReviewStatus = 'pending' | 'approved' | 'ignored_outlier';

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
  return r?.purchase_review_status || fallback;
}

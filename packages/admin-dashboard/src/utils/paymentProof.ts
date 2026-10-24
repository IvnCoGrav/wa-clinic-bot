export interface PaymentProofEvaluation {
  hasProof: boolean;
  totalExpected: number;
  receiptAmount: number | null;
  isMismatch: boolean;
  isUnderpaid: boolean;
  isOverpaid: boolean;
  difference: number;
  badgeVariant: 'mismatch_red' | 'match_green' | 'unverified_gray';
  badgeLabel: string;
  description: string;
}

/**
 * Mengevaluasi kecocokan nilai antara bukti bayar (struk/QRIS) dengan tagihan resmi (Layanan + Ongkir).
 * Sesuai arahan: jika tidak sesuai (underpaid / overpaid), mengembalikan variant 'mismatch_red'.
 */
export function evaluatePaymentProof(reservation?: {
  purchase_value?: number | null;
  delivery_fee?: number | null;
  receipt_amount?: number | null;
  proof_url?: string | null;
  payment_method?: string | null;
  raw_text?: string | null;
} | null): PaymentProofEvaluation {
  if (!reservation || !reservation.proof_url) {
    return {
      hasProof: false,
      totalExpected: 0,
      receiptAmount: null,
      isMismatch: false,
      isUnderpaid: false,
      isOverpaid: false,
      difference: 0,
      badgeVariant: 'unverified_gray',
      badgeLabel: 'Tidak Ada Bukti',
      description: 'Belum ada bukti transfer terlampir.',
    };
  }

  const purchaseValue = Number(reservation.purchase_value) || 0;
  const deliveryFee = Number(reservation.delivery_fee) || 0;
  const totalExpected = purchaseValue + deliveryFee;

  let receiptAmount: number | null = null;
  if (reservation.receipt_amount !== undefined && reservation.receipt_amount !== null) {
    const parsed = Number(reservation.receipt_amount);
    if (!isNaN(parsed) && parsed > 0) {
      receiptAmount = parsed;
    }
  }

  // Fallback parsing dari raw_text bila receipt_amount belum terisi di state lokal
  if (receiptAmount === null && reservation.raw_text) {
    const match = reservation.raw_text.match(/\[RECEIPT_AMOUNT:(\d+)\]/);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        receiptAmount = parsed;
      }
    }
  }

  if (receiptAmount === null) {
    return {
      hasProof: true,
      totalExpected,
      receiptAmount: null,
      isMismatch: false,
      isUnderpaid: false,
      isOverpaid: false,
      difference: 0,
      badgeVariant: 'unverified_gray',
      badgeLabel: 'Nominal Struk Perlu Dicek',
      description: totalExpected > 0
        ? `Tagihan: Rp ${totalExpected.toLocaleString('id-ID')} • Nominal di struk perlu dicek manual`
        : 'Nominal di struk perlu dicek manual',
    };
  }

  const difference = receiptAmount - totalExpected;
  const isMismatch = totalExpected > 0 && receiptAmount !== totalExpected;
  const isUnderpaid = totalExpected > 0 && receiptAmount < totalExpected;
  const isOverpaid = totalExpected > 0 && receiptAmount > totalExpected;

  if (isMismatch) {
    const absDiff = Math.abs(difference);
    const diffText = isUnderpaid
      ? `Kurang Rp ${absDiff.toLocaleString('id-ID')}`
      : `Lebih Rp ${absDiff.toLocaleString('id-ID')}`;

    return {
      hasProof: true,
      totalExpected,
      receiptAmount,
      isMismatch: true,
      isUnderpaid,
      isOverpaid,
      difference,
      badgeVariant: 'mismatch_red',
      badgeLabel: diffText,
      description: `Ditransfer: Rp ${receiptAmount.toLocaleString('id-ID')} • Tagihan: Rp ${totalExpected.toLocaleString('id-ID')} (${diffText})`,
    };
  }

  return {
    hasProof: true,
    totalExpected,
    receiptAmount,
    isMismatch: false,
    isUnderpaid: false,
    isOverpaid: false,
    difference: 0,
    badgeVariant: 'match_green',
    badgeLabel: 'Nominal Sesuai',
    description: `Ditransfer: Rp ${receiptAmount.toLocaleString('id-ID')} (Sesuai Tagihan)`,
  };
}

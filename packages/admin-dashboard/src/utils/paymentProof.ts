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

type ReservationLike = {
  proof_url?: string | null;
  paymentEvaluation?: {
    expected: number;
    receiptAmount: number | null;
    status: 'UNVERIFIED' | 'EXACT' | 'UNDERPAID' | 'OVERPAID';
    isMismatch: boolean;
    isUnderpaid: boolean;
    isOverpaid: boolean;
    difference: number;
  } | null;
};

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export function evaluatePaymentProof(reservation?: ReservationLike | null): PaymentProofEvaluation {
  if (!reservation?.proof_url) {
    return {
      hasProof: false, totalExpected: 0, receiptAmount: null,
      isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
      badgeVariant: 'unverified_gray', badgeLabel: 'Tidak Ada Bukti',
      description: 'Belum ada bukti transfer terlampir.',
    };
  }

  const p = reservation.paymentEvaluation;
  if (!p) {
    return {
      hasProof: true, totalExpected: 0, receiptAmount: null,
      isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
      badgeVariant: 'unverified_gray', badgeLabel: 'Evaluasi Belum Tersedia',
      description: 'Muat ulang data reservasi untuk menampilkan evaluasi tagihan.',
    };
  }

  if (p.receiptAmount === null || p.status === 'UNVERIFIED') {
    return {
      hasProof: true, totalExpected: p.expected, receiptAmount: p.receiptAmount,
      isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
      badgeVariant: 'unverified_gray', badgeLabel: 'Nominal Struk Perlu Dicek',
      description: `Tagihan: ${rp(p.expected)} — nominal struk perlu dicek manual.`,
    };
  }

  if (p.isMismatch) {
    const diffText = p.isUnderpaid
      ? `Kurang ${rp(Math.abs(p.difference))}`
      : `Lebih ${rp(Math.abs(p.difference))}`;
    return {
      hasProof: true, totalExpected: p.expected, receiptAmount: p.receiptAmount,
      isMismatch: true, isUnderpaid: p.isUnderpaid, isOverpaid: p.isOverpaid, difference: p.difference,
      badgeVariant: 'mismatch_red', badgeLabel: diffText,
      description: `Ditransfer: ${rp(p.receiptAmount)} — Tagihan: ${rp(p.expected)} (${diffText}).`,
    };
  }

  return {
    hasProof: true, totalExpected: p.expected, receiptAmount: p.receiptAmount,
    isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
    badgeVariant: 'match_green', badgeLabel: 'Nominal Sesuai',
    description: `Ditransfer: ${rp(p.receiptAmount)} (sesuai tagihan).`,
  };
}

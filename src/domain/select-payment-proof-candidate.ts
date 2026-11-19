/**
 * select-payment-proof-candidate.ts
 *
 * Domain murni (tanpa I/O / DB) untuk memilih satu reservasi paling tepat
 * dari daftar kandidat yang tersedia, secara deterministik dan adil.
 */

import { TERMINAL_RESERVATION_STATUSES } from './reservation-status';

const TERMINAL_STATUS_SET = new Set(
  TERMINAL_RESERVATION_STATUSES.map((status) => status.toLowerCase())
);

export interface CandidateReservation {
  id: string;
  tenant_id?: string;
  customer_id?: string;
  status: string;
  booking_date: Date | string | null;
  created_at: Date | string;
  expectedTotal: number;
  purchase_occurred_at?: Date | string | null;
  proof_url?: string | null;
  [key: string]: any;
}

export interface CandidateSelectionParams {
  candidates: CandidateReservation[];
  signalAmount?: number | null;
  transferDate?: Date | null;
  now?: Date;
}

export interface CandidateSelectionResult {
  candidate: CandidateReservation | null;
  isExactAmountMatch: boolean;
  scoreExplanation: string | null;
}

/**
 * Memilih satu kandidat reservasi terbaik dari daftar kandidat.
 * Mengikuti aturan deterministik:
 * 1. Filter: singkirkan yang sudah lunas (purchase_occurred_at) atau sudah berbukti (proof_url).
 * 2. Prioritas 1: Exact Match Nominal (selisih tagihan vs bukti = 0).
 * 3. Prioritas 2: Selisih tanggal terkecil |transferDate - booking_date| (fallback |now - booking_date|).
 *    (Reservasi tanpa booking_date selalu di bawah yang memiliki booking_date).
 * 4. Prioritas 3: created_at terbaru.
 * 5. Prioritas 4 (Tie-Break): id ascending.
 */
export function selectPaymentProofCandidate(
  params: CandidateSelectionParams
): CandidateSelectionResult {
  const { candidates, signalAmount, transferDate, now = new Date() } = params;

  if (!candidates || candidates.length === 0) {
    return { candidate: null, isExactAmountMatch: false, scoreExplanation: 'NO_CANDIDATES' };
  }

  // 1. Filter: Reservasi yang belum lunas dan belum memiliki bukti bayar
  const eligible = candidates.filter((c) => {
    if (TERMINAL_STATUS_SET.has(String(c.status || '').toLowerCase())) return false;
    if (c.purchase_occurred_at) return false;
    if (c.proof_url && c.proof_url.trim()) return false;
    return true;
  });

  if (eligible.length === 0) {
    return { candidate: null, isExactAmountMatch: false, scoreExplanation: 'ALL_ALREADY_PAID_OR_PROVEN' };
  }

  const refTime = transferDate && !isNaN(transferDate.getTime()) ? transferDate : now;
  const hasSignalAmount = typeof signalAmount === 'number' && Number.isFinite(signalAmount) && signalAmount > 0;

  // 2. Beri skor & urutkan
  const sorted = [...eligible].sort((a, b) => {
    const aExpected = Math.round(Number(a.expectedTotal) || 0);
    const bExpected = Math.round(Number(b.expectedTotal) || 0);

    // Kriteria 1: Exact nominal match
    if (hasSignalAmount) {
      const aExact = aExpected === Math.round(signalAmount);
      const bExact = bExpected === Math.round(signalAmount);
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // Jika sama-sama mismatch, utamakan yang selisih nominalnya lebih kecil
      if (!aExact && !bExact) {
        const aDiff = Math.abs(aExpected - signalAmount);
        const bDiff = Math.abs(bExpected - signalAmount);
        if (aDiff !== bDiff) return aDiff - bDiff;
      }
    }

    // Kriteria 2: Selisih waktu booking_date terhadap refTime
    const aDate = a.booking_date ? new Date(a.booking_date) : null;
    const bDate = b.booking_date ? new Date(b.booking_date) : null;
    const aHasDate = aDate && !isNaN(aDate.getTime());
    const bHasDate = bDate && !isNaN(bDate.getTime());

    if (aHasDate && !bHasDate) return -1;
    if (!aHasDate && bHasDate) return 1;

    if (aHasDate && bHasDate) {
      const aTimeDiff = Math.abs(aDate!.getTime() - refTime.getTime());
      const bTimeDiff = Math.abs(bDate!.getTime() - refTime.getTime());
      if (aTimeDiff !== bTimeDiff) return aTimeDiff - bTimeDiff;
    }

    // Kriteria 3: created_at terbaru (desc)
    const aCreated = new Date(a.created_at).getTime() || 0;
    const bCreated = new Date(b.created_at).getTime() || 0;
    if (aCreated !== bCreated) return bCreated - aCreated;

    // Kriteria 4: id ascending (tie-break final mutlak)
    return String(a.id).localeCompare(String(b.id));
  });

  const best = sorted[0];
  const isExact = hasSignalAmount && Math.round(Number(best.expectedTotal) || 0) === Math.round(signalAmount);

  return {
    candidate: best,
    isExactAmountMatch: isExact,
    scoreExplanation: `SELECTED_${best.id}`,
  };
}

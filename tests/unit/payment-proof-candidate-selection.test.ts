import { describe, it, expect } from 'vitest';
import {
  selectPaymentProofCandidate,
  type CandidateReservation,
} from '../../src/domain/select-payment-proof-candidate';

describe('selectPaymentProofCandidate (Domain Murni — Candidate Selection Engine)', () => {
  const baseNow = new Date('2026-11-16T12:00:00.000Z');

  it('1. +26 jam (Kasus Bunda Nida): Booking date 26 jam ke depan & nominal pas 155.000 -> terpilih', () => {
    const bookingDate = new Date(baseNow.getTime() + 26.3 * 3600 * 1000); // +26.3 jam
    const candidateNida: CandidateReservation = {
      id: 'res-nida-0975',
      status: 'confirmed',
      booking_date: bookingDate,
      created_at: new Date('2026-11-16T02:56:58.000Z'),
      expectedTotal: 155000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidateNida],
      signalAmount: 155000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate).not.toBeNull();
    expect(result.candidate?.id).toBe('res-nida-0975');
    expect(result.isExactAmountMatch).toBe(true);
  });

  it('2. +72 jam: Booking date 3 hari ke depan dipilih dalam rentang policy', () => {
    const candidate72h: CandidateReservation = {
      id: 'res-72h',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 72 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 250000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidate72h],
      signalAmount: 250000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate?.id).toBe('res-72h');
    expect(result.isExactAmountMatch).toBe(true);
  });

  it('3. +120 jam: Booking date 5 hari ke depan dipilih dalam rentang policy', () => {
    const candidate120h: CandidateReservation = {
      id: 'res-120h',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 120 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 140000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidate120h],
      signalAmount: 140000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate?.id).toBe('res-120h');
  });

  it('4. completed 3 jam lalu: Pelunasan pasca visit (status completed, belum ada bukti) -> terpilih', () => {
    const candidateCompleted: CandidateReservation = {
      id: 'res-completed-3h',
      status: 'completed',
      booking_date: new Date(baseNow.getTime() - 3 * 3600 * 1000),
      created_at: new Date(baseNow.getTime() - 24 * 3600 * 1000),
      expectedTotal: 200000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidateCompleted],
      signalAmount: 200000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate?.id).toBe('res-completed-3h');
  });

  it('5. completed tapi sudah lunas: Ditolak dan tidak dipilih', () => {
    const candidateAlreadyPaid: CandidateReservation = {
      id: 'res-already-paid',
      status: 'completed',
      booking_date: new Date(baseNow.getTime() - 3 * 3600 * 1000),
      created_at: new Date(baseNow.getTime() - 24 * 3600 * 1000),
      expectedTotal: 200000,
      purchase_occurred_at: new Date(baseNow.getTime() - 2 * 3600 * 1000), // sudah lunas
      proof_url: '/media/payment-proofs/sample.jpg',
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidateAlreadyPaid],
      signalAmount: 200000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate).toBeNull();
    expect(result.scoreExplanation).toBe('ALL_ALREADY_PAID_OR_PROVEN');
  });

  it('6. Nominal kembar: Dua reservasi nominal sama -> pilih yang jadwalnya paling dekat dari tanggal transfer', () => {
    const candidateFar: CandidateReservation = {
      id: 'res-far',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 100 * 3600 * 1000), // +100 jam
      created_at: baseNow,
      expectedTotal: 250000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const candidateNear: CandidateReservation = {
      id: 'res-near',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 10 * 3600 * 1000), // +10 jam (lebih dekat)
      created_at: baseNow,
      expectedTotal: 250000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidateFar, candidateNear],
      signalAmount: 250000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate?.id).toBe('res-near');
  });

  it('7. Nominal cocok di kandidat ke-3: Prioritaskan kandidat yang nominalnya cocok eksak', () => {
    const candidate1Mismatch: CandidateReservation = {
      id: 'res-1',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 5 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 100000, // mismatch
      purchase_occurred_at: null,
      proof_url: null,
    };

    const candidate2Mismatch: CandidateReservation = {
      id: 'res-2',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 10 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 120000, // mismatch
      purchase_occurred_at: null,
      proof_url: null,
    };

    const candidate3ExactMatch: CandidateReservation = {
      id: 'res-3',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 20 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 250000, // EXACT MATCH
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidate1Mismatch, candidate2Mismatch, candidate3ExactMatch],
      signalAmount: 250000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate?.id).toBe('res-3');
    expect(result.isExactAmountMatch).toBe(true);
  });

  it('8. Fallback tanpa booking_date: Kandidat bertanggal selalu diutamakan dibanding yang tanggalnya null', () => {
    const candidateNoDate: CandidateReservation = {
      id: 'res-nodate',
      status: 'pending',
      booking_date: null,
      created_at: baseNow,
      expectedTotal: 250000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const candidateWithDate: CandidateReservation = {
      id: 'res-withdate',
      status: 'confirmed',
      booking_date: new Date(baseNow.getTime() + 48 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 250000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidateNoDate, candidateWithDate],
      signalAmount: 250000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate?.id).toBe('res-withdate');
  });

  it('9. Pending tanpa tanggal terpilih bila satu-satunya kandidat', () => {
    const candidateNoDateOnly: CandidateReservation = {
      id: 'res-nodate-only',
      status: 'pending',
      booking_date: null,
      created_at: baseNow,
      expectedTotal: 175000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [candidateNoDateOnly],
      signalAmount: 175000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate?.id).toBe('res-nodate-only');
  });

  it('10. Daftar kandidat kosong -> mengembalikan null', () => {
    const result = selectPaymentProofCandidate({
      candidates: [],
      signalAmount: 250000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate).toBeNull();
    expect(result.scoreExplanation).toBe('NO_CANDIDATES');
  });

  it('11. Status terminal (cancelled/rejected) tidak pernah dipilih', () => {
    const cancelled: CandidateReservation = {
      id: 'res-cancelled',
      status: 'cancelled',
      booking_date: new Date(baseNow.getTime() + 2 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 250000,
      purchase_occurred_at: null,
      proof_url: null,
    };
    const rejected: CandidateReservation = {
      ...cancelled,
      id: 'res-rejected',
      status: 'rejected',
    };

    const result = selectPaymentProofCandidate({
      candidates: [cancelled, rejected],
      signalAmount: 250000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate).toBeNull();
    expect(result.scoreExplanation).toBe('ALL_ALREADY_PAID_OR_PROVEN');
  });

  it('12. Status terminal huruf besar (CANCELLED) tetap ditolak', () => {
    const cancelledUpper: CandidateReservation = {
      id: 'res-cancelled-upper',
      status: 'CANCELLED',
      booking_date: new Date(baseNow.getTime() + 2 * 3600 * 1000),
      created_at: baseNow,
      expectedTotal: 250000,
      purchase_occurred_at: null,
      proof_url: null,
    };

    const result = selectPaymentProofCandidate({
      candidates: [cancelledUpper],
      signalAmount: 250000,
      transferDate: baseNow,
      now: baseNow,
    });

    expect(result.candidate).toBeNull();
  });
});

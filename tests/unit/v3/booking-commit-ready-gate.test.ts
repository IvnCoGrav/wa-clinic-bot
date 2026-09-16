import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';

/**
 * Fase 3' — isBookingCommitReady fail-closed (lapis State Machine).
 * Giliran bertanda tanya BUKAN komitmen booking → DILARANG memaksa
 * save_reservation via tool_choice deterministik.
 */
const sessionWithTreatment: any = {
  genderGreeting: 'Bunda',
  selectedTreatment: 'Pijat Kids Ceria (Usia 2-4 th)',
  booking: {},
};

describe('isBookingCommitReady fail-closed (Fase 3)', () => {
  it('false untuk pertanyaan ketersediaan slot (Turn 7)', () => {
    expect(ContextGrounder.isBookingCommitReady(
      sessionWithTreatment, 'Bisa hari selasa depan? Tgl 18 agustus?', []
    )).toBe(false);
  });

  it('true untuk pernyataan tegas + treatment disepakati', () => {
    expect(ContextGrounder.isBookingCommitReady(
      sessionWithTreatment, 'Baik saya ambil hari selasa', []
    )).toBe(true);
  });

  it('pengecualian same-day: pertanyaan "siang ini bisa?" tetap commit-ready (pending)', () => {
    expect(ContextGrounder.isBookingCommitReady(
      sessionWithTreatment, 'kalau siang ini bisa?', []
    )).toBe(true);
  });

  it('false bila treatment belum disepakati', () => {
    expect(ContextGrounder.isBookingCommitReady(
      { genderGreeting: 'Bunda', booking: {} } as any, 'Baik saya ambil hari selasa', []
    )).toBe(false);
  });

  it('false bila reservasi sudah tercatat (anti dobel-kunci)', () => {
    expect(ContextGrounder.isBookingCommitReady(
      { ...sessionWithTreatment, booking: { reservationId: 'r-1' } } as any,
      'Baik saya ambil hari selasa', []
    )).toBe(false);
  });
});

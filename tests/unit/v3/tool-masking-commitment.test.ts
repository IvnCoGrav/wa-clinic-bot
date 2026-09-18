import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateToolMasking } from '../../../src/v3/tools/tool-masker';
import { __clearMemorySessions } from '../../../src/v3/state/goal-tracker';
import type { CustomerGoalSession } from '../../../src/v3/domain/types';

/**
 * Rule 5 — Active User Commitment Gate (sticky).
 *
 * Kontrak: save_reservation DICABUT FISIK ketika customer baru menyampaikan
 * preferensi hari/jam tentatif sebagai jawaban atas pertanyaan asisten, dan
 * HANYA dibuka bila ada verba komitmen booking eksplisit yang tersimpan lengket
 * di session (bookingCommitConfirmed). Pengujian memakai parafrase nyata
 * (bukan kalimat hafalan) sesuai mandat adversarial & multi-phrasing.
 */
describe('tool-masker — Rule 5 Active User Commitment Gate', () => {
  const baseSession = (over: Partial<CustomerGoalSession> = {}): CustomerGoalSession => ({
    genderGreeting: 'Bunda',
    selectedTreatment: 'Oksitosin Massage Fullbody',
    location: { rawText: 'Tenggilis', kelurahan: 'Tenggilis Mejoyo', kota: 'Surabaya' },
    ...over,
  });

  const isAllowed = (text: string, session: CustomerGoalSession): boolean =>
    evaluateToolMasking(undefined as any, session, text, []).isSaveReservationAllowed;

  const reason = (text: string, session: CustomerGoalSession): string =>
    evaluateToolMasking(undefined as any, session, text, []).reason;

  beforeEach(() => {
    __clearMemorySessions();
  });

  it('HARI TENTATIF tanpa komitmen → save_reservation DIMASKING (multi-phrasing)', () => {
    const phrases = [
      'Besok, tpi bisanya siang diatas jam 1 ma',
      'Hari ini aja',
      'Selasa bu, tgl 18 agt',
      'kayaknya sabtu deh',
      'minggu pagi bisa gak',
    ];
    for (const p of phrases) {
      const session = baseSession(); // bookingCommitConfirmed belum diset
      expect(isAllowed(p, session), `"${p}" harus DIMASKING`).toBe(false);
      expect(reason(p, session)).toContain('BOOKING_COMMIT_PENDING');
    }
  });

  it('KOMITMEN eksplisit (sticky flag) → save_reservation DIIZINKAN saat hari sudah disebut', () => {
    const session = baseSession({ bookingCommitConfirmed: true });
    expect(isAllowed('Selasa bu, tgl 18 agt', session)).toBe(true);
    expect(reason('Selasa bu, tgl 18 agt', session)).toContain('ALL_PRECONDITIONS_MET');
  });

  it('KOMITMEN sticky tetap berlaku saat customer menjawab hari di turn TERPISAH (kasus regresi utama)', () => {
    // Turn A: komitmen diset (via latch di produksi) — teks di bawah hanya
    // simulasi pesan terakhir; flag sudah tersimpan sebelumnya.
    const session = baseSession({ bookingCommitConfirmed: true });
    // Turn B: customer hanya menyebut hari, tanpa verba komitmen.
    expect(isAllowed('bisa dihari sabtu ya', session)).toBe(true);
  });

  it('komitmen tanpa kejelasan hari → tetap DIMASKING (DATE_NOT_CONFIRMED)', () => {
    const session = baseSession({ bookingCommitConfirmed: true });
    expect(isAllowed('oke deal', session)).toBe(false);
    expect(reason('oke deal', session)).toContain('DATE_NOT_CONFIRMED');
  });

  it('tanpa treatment → DIMASKING meski komitmen & hari ada', () => {
    const session = baseSession({ selectedTreatment: undefined, bookingCommitConfirmed: true });
    expect(isAllowed('sabtu ya', session)).toBe(false);
    expect(reason('sabtu ya', session)).toContain('TREATMENT_EMPTY');
  });
});

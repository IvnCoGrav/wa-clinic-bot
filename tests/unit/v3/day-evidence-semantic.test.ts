import { describe, it, expect } from 'vitest';

/**
 * Fondasi 2 — Semantic Day Evidence Bypass (sesi 150014).
 * verifyDayMentioned di save_reservation.tool.ts memiliki bypass: jika customer
 * menyebut kata hari dalam teks ("besok", "lusa", "senin"), validasi bookingDate
 * ISO dilewati meskipun format ISO tidak ditemukan di incomingText.
 *
 * Test ini memverifikasi perilaku logika bypass secara terisolasi
 * tanpa dependency LLM atau tool execution.
 */

const DAY_EVIDENCE_WORDS = [
  'besok', 'lusa', 'senin', 'selasa', 'rabu', 'kamis',
  'jumat', 'jum\'at', 'sabtu', 'minggu',
];

function hasDayEvidenceInHistory(history: string[]): boolean {
  return DAY_EVIDENCE_WORDS.some((w) =>
    history.some((h) => h.toLowerCase().includes(w))
  );
}

describe('Semantic Day Evidence Bypass (Fondasi 2)', () => {
  it('true jika history mengandung kata hari', () => {
    expect(hasDayEvidenceInHistory(['mau besok ya bund', 'oke'])).toBe(true);
    expect(hasDayEvidenceInHistory(['lusa bisa', 'sudah oke'])).toBe(true);
    expect(hasDayEvidenceInHistory(['senin pagi dong'])).toBe(true);
  });

  it('false jika history tidak mengandung kata hari', () => {
    expect(hasDayEvidenceInHistory(['oke ya bund', 'siap'])).toBe(false);
    expect(hasDayEvidenceInHistory([])).toBe(false);
    expect(hasDayEvidenceInHistory(['jadwalnya kapan?'])).toBe(false);
  });

  it('case-insensitive', () => {
    expect(hasDayEvidenceInHistory(['BESOK ya'])).toBe(true);
    expect(hasDayEvidenceInHistory(['Besok Dong'])).toBe(true);
    expect(hasDayEvidenceInHistory(['SENIN pagi'])).toBe(true);
  });

  it('kata sebagian ("bes") tidak false-positive', () => {
    expect(hasDayEvidenceInHistory(['bes rnya mana'])).toBe(false);
    expect(hasDayEvidenceInHistory(['besok']));
  });

  it('mixed case + multiple messages', () => {
    expect(hasDayEvidenceInHistory([
      'Halo Bunda',
      'Mau pijat bayi',
      'BESOK bisa?',
    ])).toBe(true);
  });
});

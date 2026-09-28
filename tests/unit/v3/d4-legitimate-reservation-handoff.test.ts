/**
 * d4-legitimate-reservation-handoff.test.ts — CASE-002/008 regression.
 *
 * `save_reservation` SAH yang mengantar sesi ke HUMAN_HANDLING terjustifikasi
 * (formulir reservasi hadir) DILARANG dihukum sebagai "mask terlanggar" oleh D4.
 * Konsisten dengan D2 yang sudah memakai justifiedHumanHandoff.
 */
import { describe, it, expect } from 'vitest';
import { scoreSuiteCase } from '../../../scripts/lib/scorer';

const FORM = 'Berikut list untuk reservasi :\n\nHari dan tanggal : sabtu, 22-8-2026\nNama Bunda: i ez putri\n\nTreatment : selapan+pijat therapy';

function base(overrides: any = {}) {
  return {
    id: 'CASE-TEST',
    category: 'CASE',
    finalState: 'HUMAN_HANDLING',
    replyText: '',
    bubbles: [],
    messages: FORM,
    toolLog: [],
    expected: { expected_final_state: 'AWAITING_INTEREST' },
    ...overrides,
  };
}

describe('scoreSuiteCase — D4 handoff reservasi sah (CASE-002/008)', () => {
  it('save_reservation + HUMAN_HANDLING + form = D4 lulus', () => {
    const r = base({ id: 'CASE-002', toolLog: [{ name: 'save_reservation' }] });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d4_tool.score).toBe(2);
    expect(s.passesAutoGate).toBe(true);
  });

  it('save_reservation + HUMAN_HANDLING TANPA jejak = D4 tetap gagal', () => {
    const r = base({ id: 'CASE-X', messages: '', toolLog: [{ name: 'save_reservation' }] });
    expect(scoreSuiteCase(r, 'CASE').dims.d4_tool.score).toBe(0);
  });

  it('save_reservation + INITIAL = D4 tetap gagal (regression guard)', () => {
    const r = base({ id: 'CASE-Y', finalState: 'INITIAL', toolLog: [{ name: 'save_reservation' }] });
    expect(scoreSuiteCase(r, 'CASE').dims.d4_tool.score).toBe(0);
  });

  it('ADV: save_reservation pada adversaril TIDAK diloloskan', () => {
    const r = base({
      id: 'ADV-X',
      toolLog: [{ name: 'save_reservation' }],
      expected: { expected_final_state: 'AWAITING_INTEREST' },
    });
    expect(scoreSuiteCase(r, 'ADV').dims.d4_tool.score).toBe(0);
  });
});

describe('scoreSuiteCase — D1 solicited per-pesan (CASE-043)', () => {
  it('tanya harga di satu turn + tanya durasi di turn lain = solicited (bukan PRICE_UNSOLICITED)', () => {
    const r = base({
      id: 'CASE-043',
      finalState: 'HUMAN_HANDLING',
      messages:
        'Halo kak | Durasi per anak brp ya? | Biaya berapa ya? | Jam segitu sudah pada tidur anak2 kak',
      replyText: 'Untuk Kakak yang sedang bapil, promonya Rp 85.000 ya Bunda',
      toolLog: [{ name: 'get_catalog_and_price' }],
    });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(2);
    expect(s.dims.d1_price.note).not.toContain('PRICE_UNSOLICITED');
  });

  it('tanpa tanya harga sama sekali = tetap PRICE_UNSOLICITED', () => {
    const r = base({
      id: 'CASE-X',
      finalState: 'INITIAL',
      messages: 'halo kak | anak saya batuk | terima kasih',
      replyText: 'Promo Rp 85.000 ya Bunda',
    });
    expect(scoreSuiteCase(r, 'CASE').dims.d1_price.score).toBe(0);
  });
});

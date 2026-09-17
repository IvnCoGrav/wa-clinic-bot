import { describe, it, expect } from 'vitest';
import { validateFactualClaims } from '../../../src/v3/guardrails/factual-claim-validator';

/**
 * Fase 6 K2 (Issue #74) — Structural Refusal & Escalation Tagging.
 * Seam: validateFactualClaims(reply, tools, chunks, { isRefusalOrEscalation }).
 * Kontrak: tag struktural melewatkan D3 secara deterministik TANPA bergantung
 * pada frasa regex REFUSAL_FRAME_RE; aturan lain (D5) tetap berlaku.
 */
const REFUSAL_WITHOUT_FRAME_WORDS =
  'Kondisi tersebut sebaiknya tidak dipijat hari ini. ' +
  'Bidan kami akan membantu memeriksa jadwal ulang setelah si kecil pulih. ' +
  'Mohon beri tahu kami perkembangannya ya Bunda.';

describe('Structural Refusal Tagging (Issue #74)', () => {
  it('tanpa tag: anjuran tanpa landasan TETAP melanggar D3 (regex tak menolong)', () => {
    const out = validateFactualClaims(REFUSAL_WITHOUT_FRAME_WORDS, [], [], { locationKnown: true });
    expect(out.isValid).toBe(false);
    expect(out.violations.join(' ')).toMatch(/tanpa landasan/i);
  });

  it('dengan tag: penolakan/eskalasi lolos D3 deterministik', () => {
    const out = validateFactualClaims(REFUSAL_WITHOUT_FRAME_WORDS, [], [], {
      locationKnown: true,
      isRefusalOrEscalation: true,
    });
    expect(out.isValid).toBe(true);
    expect(out.violations).toEqual([]);
  });

  it('tag BUKAN pemutih global: klaim absolut D5 tetap ditolak', () => {
    const out = validateFactualClaims(
      'Perawatan ini pasti sembuh total dalam sehari. ' +
        'Bidan kami akan membantu memeriksa jadwal ulang setelah si kecil pulih ya Bunda.',
      [],
      [],
      { locationKnown: true, isRefusalOrEscalation: true }
    );
    expect(out.isValid).toBe(false);
    expect(out.violations.join(' ')).toMatch(/absolut/i);
  });

  it('eskalasi tool + advisory tetap lolos via tag walau tanpa grounding', () => {
    const out = validateFactualClaims(
      'Kami wajib memastikan keamanan si kecil dulu ya Bunda. ' +
        'Bidan kami akan membantu memeriksa dan meneruskan ke tim medis. ' +
        'Mohon tunggu kabar selanjutnya dari kami ya Bunda.',
      [{ name: 'escalate_to_human', result: { success: true, escalated: true } }],
      [],
      { locationKnown: false, isRefusalOrEscalation: true }
    );
    expect(out.isValid).toBe(true);
  });
});

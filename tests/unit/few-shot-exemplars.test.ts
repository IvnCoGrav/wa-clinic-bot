import { describe, it, expect } from 'vitest';
import { FewShotExemplarBank } from '../../src/v3/agent/few-shot-exemplars';

/**
 * Regression: `Cannot read properties of undefined (reading 'symptoms')`.
 * Objek ekstraksi parsial (tanpa array symptoms/intents) DILARANG menjatuhkan engine.
 */
describe('FewShotExemplarBank — safe navigation ekstraksi parsial', () => {
  it('tidak crash saat symptoms undefined', () => {
    const partial = {
      intents: ['chitchat'],
      symptoms: undefined,
    } as any;
    expect(() =>
      FewShotExemplarBank.selectRelevantExemplars(partial, undefined, 'halo')
    ).not.toThrow();
  });

  it('tidak crash saat intents dan symptoms keduanya undefined', () => {
    const partial = {
      intents: undefined,
      symptoms: undefined,
    } as any;
    const result = FewShotExemplarBank.selectRelevantExemplars(partial, undefined, 'pagi');
    expect(Array.isArray(result)).toBe(true);
  });

  it('tetap memberi skor saat symptoms terisi normal', () => {
    const full = {
      intents: ['consult_symptom'],
      symptoms: ['batuk'],
    } as any;
    const result = FewShotExemplarBank.selectRelevantExemplars(full, undefined, 'anak batuk');
    expect(Array.isArray(result)).toBe(true);
  });

  // Rule 2 — exemplar price scrubbing (mode konsultasi).
  it('formatExemplarsForPrompt(hidePrices=true) meredam nominal rupiah', () => {
    const exemplars = [{
      id: 'x',
      scenario: 'contoh',
      tags: [],
      customerMessage: 'Saya di Candi Sidoarjo kak',
      idealResponse: 'Jaraknya 23 km dengan ongkir promo Rp 25.000 yaa. Rencana mau ambil perawatan apa Bunda?',
      isActive: true,
      sortOrder: 0,
    }] as any;
    const hidden = FewShotExemplarBank.formatExemplarsForPrompt(exemplars, true);
    expect(hidden).not.toMatch(/Rp\s*25\.000/);
    expect(hidden).toContain('Rencana mau ambil perawatan apa');
  });

  it('formatExemplarsForPrompt(hidePrices=false) mempertahankan nominal (mode transaksional)', () => {
    const exemplars = [{
      id: 'x',
      scenario: 'contoh',
      tags: [],
      customerMessage: 'Berapa ongkirnya?',
      idealResponse: 'Ongkir promo Rp 25.000 yaa Bunda.',
      isActive: true,
      sortOrder: 0,
    }] as any;
    const shown = FewShotExemplarBank.formatExemplarsForPrompt(exemplars, false);
    expect(shown).toMatch(/Rp\s*25\.000/);
  });
});

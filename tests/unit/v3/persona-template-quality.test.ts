import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../../src/config/persona';

/**
 * Audit 868-bubble: template minta-kelurahan mengandung tautologi
 * ("Kelurahan X di kelurahan mana"), typo "cek an", dan "bunda" lowercase.
 * Kuota sapaan: gabungan penerimaan reservasi + shareNote ≤ 2 sebutan.
 */
describe('TEMPLATES — kualitas bahasa deterministik (audit bubble)', () => {
  it('askKelurahanRetry tidak tautologis & bebas typo', () => {
    const out = TEMPLATES.askKelurahanRetry({ textLocation: 'Kelurahan DR Sutomo', currentAttempts: 2 });
    expect(out).not.toMatch(/kelurahan[^?]*di kelurahan/i);
    expect(out).not.toMatch(/cek an ongkir/i);
    expect(out).not.toMatch(/\bbunda\b/); // lowercase "bunda" terlarang
    expect(out).toMatch(/Bunda/);
    expect(out).toMatch(/kelurahan\/desa|lokasi/i);
  });

  it('askShareLocation bebas sapaan Bunda berulang + typo', () => {
    const out = TEMPLATES.askShareLocation();
    const bundaCount = (out.match(/bunda|bund/gi) || []).length;
    expect(bundaCount).toBe(0);
    expect(out).not.toMatch(/cek an ongkir/i);
  });
});

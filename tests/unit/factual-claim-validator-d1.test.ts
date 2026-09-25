import { describe, it, expect } from 'vitest';
import { validateFactualClaims } from '../../src/v3/guardrails/factual-claim-validator';

const catalog = (names: string[]) => [{
  name: 'get_catalog_and_price',
  args: {},
  result: { success: true, treatments: names.map(n => ({ name: n, durationMinutes: 40 })) },
}];

describe('D1 toleran deskriptor (parens + GENERIC)', () => {
  it('Pijat Bayi Ceria (Rileksasi) valid terhadap Kala Baby – Pijat Ceria', () => {
    const tools = catalog(['Kala Baby – Pijat Ceria', 'Kala Baby – Pijat Lahap']);
    const ok = validateFactualClaims('Untuk *Pijat Bayi Ceria (Rileksasi)* durasinya 40 menit ya Bunda', tools);
    expect(ok.isValid).toBe(true);
  });
  it('Pijat Lahap Juara valid terhadap Kala Baby – Pijat Lahap', () => {
    const tools = catalog(['Kala Baby – Pijat Lahap']);
    const ok = validateFactualClaims('Untuk *Pijat Lahap Juara* durasinya 40 menit ya Bunda', tools);
    expect(ok.isValid).toBe(true);
  });
  it('Pijat Laktasi Premium tetap invalid (safety boundary)', () => {
    const tools = catalog(['Kala Baby – Pijat Ceria']);
    const bad = validateFactualClaims('Coba *Pijat Laktasi Premium* ya Bunda', tools);
    expect(bad.isValid).toBe(false);
  });
  it('Multi-treatment durasi 40 menit dengan nama ternormalisasi kurung lolos tanpa reprompt', () => {
    const tools = catalog(['Kala Baby – Pijat Ceria', 'Kala Baby – Pijat Lahap']);
    const ok = validateFactualClaims('Untuk *Pijat Bayi Ceria (Rileksasi)* maupun *Pijat Lahap Juara*, durasinya 40 menit ya Bunda', tools);
    expect(ok.isValid).toBe(true);
  });
});

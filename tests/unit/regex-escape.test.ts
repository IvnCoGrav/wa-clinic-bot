import { describe, it, expect } from 'vitest';
import { escapeRegex } from '../../src/utils/regex-escape';

describe('escapeRegex Utility (Fase 4-6)', () => {
  it('meng-escape seluruh karakter metakarakter regex standar', () => {
    const specials = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(specials);
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');

    // Validasi saat dievaluasi oleh RegExp engine
    const re = new RegExp(`^${escaped}$`);
    expect(re.test(specials)).toBe(true);
    expect(re.test('anything else')).toBe(false);
  });

  it('mengembalikan string kosong untuk input falsy / non-string', () => {
    expect(escapeRegex('')).toBe('');
    expect(escapeRegex(null as any)).toBe('');
    expect(escapeRegex(undefined as any)).toBe('');
  });

  it('tidak mengubah teks alfanumerik biasa', () => {
    const plain = 'Halo Bidan Ayu 123';
    expect(escapeRegex(plain)).toBe('Halo Bidan Ayu 123');
  });

  it('mempertahankan karakter unicode dan emoji', () => {
    const unicode = 'Bidan Siti 🐣❤️ (Surabaya)';
    const escaped = escapeRegex(unicode);
    expect(escaped).toBe('Bidan Siti 🐣❤️ \\(Surabaya\\)');
    const re = new RegExp(escaped);
    expect(re.test(unicode)).toBe(true);
  });

  it('aman digunakan di dalam RegExp dinamis dengan string kompleks', () => {
    const tricky = '[PROMO] Diskon 50% + Cashback $5? (S&K Berlaku)';
    const re = new RegExp(`^${escapeRegex(tricky)}$`);
    expect(re.test(tricky)).toBe(true);
    expect(re.test('[PROMO] Diskon 50% + Cashback $5?')).toBe(false);
  });
});

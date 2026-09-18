import { describe, it, expect } from 'vitest';
import { parseSearchQuery, matchesParsedContent } from '../../src/utils/searchQueryParser';

describe('searchQueryParser — boundary presisi & ReDoS-proof', () => {
  it('7km cocok "jarak 7km" dan "7 km" tetapi menolak "17km"', () => {
    const parsed = parseSearchQuery('7km');
    expect(parsed.kind).toBe('unit_boundary');
    expect(matchesParsedContent(parsed, 'Bunda jarak 7km dari klinik')).toBe(true);
    expect(matchesParsedContent(parsed, 'jarak 7 km ya')).toBe(true);
    expect(matchesParsedContent(parsed, 'jarak 17km dari sini')).toBe(false);
    expect(matchesParsedContent(parsed, '70km jauh')).toBe(false);
  });

  it('kata umum memakai word boundary: "spa" tidak cocok "spasi"', () => {
    const parsed = parseSearchQuery('spa');
    expect(parsed.kind).toBe('word_boundary');
    expect(matchesParsedContent(parsed, 'baby spa jam 10')).toBe(true);
    expect(matchesParsedContent(parsed, 'spasi antar kata')).toBe(false);
  });

  it('karakter regex khusus tidak crash: dr. +62 [booking] ( ?', () => {
    for (const q of ['dr.', '+62', '[booking]', '(test', 'a+b', 'c?d', 'x\\y']) {
      const parsed = parseSearchQuery(q);
      // phone_digits untuk +62 tetap aman; lainnya word_boundary
      expect(() => matchesParsedContent(parsed, 'pesan dr. Yusi +62 [booking] (test')).not.toThrow();
    }
    const dot = parseSearchQuery('dr.');
    expect(matchesParsedContent(dot, 'konsul dr. Yusi')).toBe(true);
    expect(matchesParsedContent(dot, 'kondreksi')).toBe(false);
  });

  it('nomor telepon murni terdeteksi sebagai phone_digits', () => {
    const parsed = parseSearchQuery('0812 345 678');
    expect(parsed.kind).toBe('phone_digits');
    if (parsed.kind === 'phone_digits') {
      expect(parsed.cleanDigits).toBe('0812345678');
    }
    expect(matchesParsedContent(parsed, 'hubungi 0812345678 ya')).toBe(true);
    expect(matchesParsedContent(parsed, 'telp 999')).toBe(false);
  });

  it('query kosong → kind empty dan selalu match (tanpa filter)', () => {
    expect(parseSearchQuery('').kind).toBe('empty');
    expect(parseSearchQuery('   ').kind).toBe('empty');
    expect(matchesParsedContent(parseSearchQuery(''), 'apapun')).toBe(true);
  });
});

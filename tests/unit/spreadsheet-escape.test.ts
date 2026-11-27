import { describe, it, expect } from 'vitest';
import { escapeCsvCell, escapeSheetCell, neutralizeFormula } from '../../src/utils/spreadsheet-escape';

describe('spreadsheet-escape seam', () => {
  describe('CSV', () => {
    it('menetralkan awalan formula lalu membungkus kutip', () => {
      expect(escapeCsvCell('=cmd|calc')).toBe(`"'=cmd|calc"`);
      expect(escapeCsvCell('+SUM(A1)')).toBe(`"'+SUM(A1)"`);
      expect(escapeCsvCell('-2+3')).toBe(`"'-2+3"`);
      expect(escapeCsvCell('@import')).toBe(`"'@import"`);
      expect(escapeCsvCell('\tx')).toBe(`"'\tx"`);
    });

    it('teks aman hanya dibungkus kutip', () => {
      expect(escapeCsvCell('Bunda Sari')).toBe(`"Bunda Sari"`);
      expect(escapeCsvCell('Dinda "D"')).toBe(`"Dinda ""D"""`);
      expect(escapeCsvCell(150000)).toBe(`"150000"`);
    });
  });

  describe('Google Sheets (USER_ENTERED)', () => {
    it('memberi prefix apostrof pada awalan formula', () => {
      const cases: Array<[string, string]> = [
        ['=IMPORTXML("http://evil","//x")', `'=IMPORTXML("http://evil","//x")`],
        ['+1+1', `'+1+1`],
        ['-1', `'-1`],
        ['@SUM(1)', `'@SUM(1)`],
        ['\tx', `'\tx`],
        ['\rx', `'\rx`],
      ];
      for (const [input, expected] of cases) {
        expect(escapeSheetCell(input)).toBe(expected);
      }
    });

    it('tidak mengubah teks biasa dan tidak menggandakan apostrof', () => {
      expect(escapeSheetCell('Bunda Sari')).toBe('Bunda Sari');
      expect(escapeSheetCell(`'=sudah`)).toBe(`'=sudah`);
      expect(escapeSheetCell(null)).toBe('');
      expect(escapeSheetCell(42)).toBe('42');
    });
  });

  it('neutralizeFormula adalah primitif tunggal untuk kedua encoder', () => {
    expect(neutralizeFormula('=x')).toBe(`'=x`);
    expect(neutralizeFormula('x')).toBe('x');
  });
});

import { describe, it, expect } from 'vitest';
import { parseIndonesianDate } from '../../src/utils/conversation-transaction-extractor';

describe('UTL-01: Conversation Transaction Extractor Date Parser (Anti-July-Default)', () => {
  it('MUST return null when input only specifies time without any date/month', () => {
    expect(parseIndonesianDate('jam 10.00')).toBeNull();
    expect(parseIndonesianDate('jam 14:30 WIB')).toBeNull();
    expect(parseIndonesianDate('pukul 09.00')).toBeNull();
  });

  it('MUST return null when input only specifies day-of-week and time without month', () => {
    expect(parseIndonesianDate('Rabu jam 12.30')).toBeNull();
    expect(parseIndonesianDate('Senin pukul 10.00')).toBeNull();
  });

  it('MUST return null when input specifies relative terms without explicit calendar date', () => {
    expect(parseIndonesianDate('besok jam 10 pagi')).toBeNull();
    expect(parseIndonesianDate('lusa sore jam 15.00')).toBeNull();
  });

  it('MUST return null when input specifies day number without month', () => {
    expect(parseIndonesianDate('tgl 15')).toBeNull();
    expect(parseIndonesianDate('tanggal 20 jam 10')).toBeNull();
  });

  it('MUST return valid Date when explicit day, month, and year are provided', () => {
    const d1 = parseIndonesianDate('12 Agustus 2026 jam 12.30');
    expect(d1).not.toBeNull();
    expect(d1?.getUTCFullYear()).toBe(2026);
    expect(d1?.getUTCMonth()).toBe(7); // August (0-indexed)
    expect(d1?.getUTCDate()).toBe(12);

    const d2 = parseIndonesianDate('15/09/2026');
    expect(d2).not.toBeNull();
    expect(d2?.getUTCFullYear()).toBe(2026);
    expect(d2?.getUTCMonth()).toBe(8); // September
    expect(d2?.getUTCDate()).toBe(15);
  });

  it('MUST return valid Date when explicit month name and day are provided (defaulting to current year)', () => {
    const currentYear = new Date().getFullYear();
    const d = parseIndonesianDate('5 Mei jam 10.00');
    expect(d).not.toBeNull();
    expect(d?.getUTCFullYear()).toBe(currentYear);
    expect(d?.getUTCMonth()).toBe(4); // May
    expect(d?.getUTCDate()).toBe(5);
  });
});

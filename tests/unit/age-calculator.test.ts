import { describe, it, expect } from 'vitest';
import {
  parseAgeTextToBirthDate,
  monthsBetween,
  daysBetween,
  formatAgeFromMonths,
  computeCurrentAge,
} from '../../src/utils/age-calculator';

const REF = new Date('2026-08-02T00:00:00.000Z');

function daysBetweenDates(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

describe('Age Calculator — parseAgeTextToBirthDate', () => {
  it('"6 bulan" → -182 hari (±1 hari toleransi)', () => {
    const birth = parseAgeTextToBirthDate('6 bulan', REF)!;
    const diff = daysBetweenDates(REF, birth);
    expect(diff).toBeGreaterThanOrEqual(181);
    expect(diff).toBeLessThanOrEqual(183);
  });

  it('"1 tahun 2 bulan" → sekitar -425 hari', () => {
    const birth = parseAgeTextToBirthDate('1 tahun 2 bulan', REF)!;
    const diff = daysBetweenDates(REF, birth);
    expect(diff).toBeGreaterThanOrEqual(423);
    expect(diff).toBeLessThanOrEqual(427);
  });

  it('"3 minggu" → -21 hari', () => {
    const birth = parseAgeTextToBirthDate('3 minggu', REF)!;
    expect(daysBetweenDates(REF, birth)).toBe(21);
  });

  it('"10 hari" → -10 hari', () => {
    const birth = parseAgeTextToBirthDate('10 hari', REF)!;
    expect(daysBetweenDates(REF, birth)).toBe(10);
  });

  it('"6 bulan 2 hari" → sekitar -184 hari', () => {
    const birth = parseAgeTextToBirthDate('6 bulan 2 hari', REF)!;
    const diff = daysBetweenDates(REF, birth);
    expect(diff).toBeGreaterThanOrEqual(183);
    expect(diff).toBeLessThanOrEqual(185);
  });

  it('"1 bulan 2 hari" → sekitar -32 hari', () => {
    const birth = parseAgeTextToBirthDate('1 bulan 2 hari', REF)!;
    const diff = daysBetweenDates(REF, birth);
    expect(diff).toBeGreaterThanOrEqual(31);
    expect(diff).toBeLessThanOrEqual(33);
  });

  it('"2th" (singkatan tahun) → sekitar -730 hari', () => {
    const birth = parseAgeTextToBirthDate('2th', REF)!;
    const diff = daysBetweenDates(REF, birth);
    expect(diff).toBeGreaterThanOrEqual(729);
    expect(diff).toBeLessThanOrEqual(731);
  });

  it('teks tak bisa di-parse → null', () => {
    expect(parseAgeTextToBirthDate('belum tahu', REF)).toBeNull();
    expect(parseAgeTextToBirthDate('', REF)).toBeNull();
    expect(parseAgeTextToBirthDate(null as any, REF)).toBeNull();
  });
});

describe('Age Calculator — computeCurrentAge (dinamis terhadap today)', () => {
  it('berdasarkan birth_date: 6 bulan lalu → "6 bulan"', () => {
    const birthDate = new Date('2026-02-02T00:00:00.000Z');
    expect(computeCurrentAge({ birthDate }, new Date('2026-08-02T00:00:00.000Z'))).toBe('6 bulan');
  });

  it('berdasarkan birth_date: > 2 tahun → "2 tahun 3 bulan"', () => {
    const birthDate = new Date('2024-05-02T00:00:00.000Z');
    expect(computeCurrentAge({ birthDate }, new Date('2026-08-02T00:00:00.000Z'))).toBe('2 tahun 3 bulan');
  });

  it('berdasarkan birth_date: baru lahir 5 hari lalu → "5 hari"', () => {
    const birthDate = new Date('2026-07-28T00:00:00.000Z');
    expect(computeCurrentAge({ birthDate }, new Date('2026-08-02T00:00:00.000Z'))).toBe('5 hari');
  });

  it('berdasarkan snapshot usia + waktu berlalu: 6 bulan 3 bulan lalu → "9 bulan"', () => {
    const registeredAt = new Date('2026-05-02T00:00:00.000Z');
    expect(
      computeCurrentAge({ ageMonthsAtRegistration: 6, registeredAt }, new Date('2026-08-02T00:00:00.000Z'))
    ).toBe('9 bulan');
  });

  it('tanpa birth_date & tanpa snapshot → ""', () => {
    expect(computeCurrentAge({})).toBe('');
  });
});

describe('Age Calculator — helpers', () => {
  it('monthsBetween', () => {
    expect(monthsBetween(new Date('2026-02-02'), new Date('2026-08-02'))).toBe(6);
    expect(monthsBetween(new Date('2026-08-02'), new Date('2026-08-01'))).toBe(0);
    expect(monthsBetween(new Date('2024-05-02'), new Date('2026-08-02'))).toBe(27);
  });

  it('formatAgeFromMonths', () => {
    expect(formatAgeFromMonths(6)).toBe('6 bulan');
    expect(formatAgeFromMonths(27)).toBe('2 tahun 3 bulan');
    expect(formatAgeFromMonths(24)).toBe('2 tahun');
    expect(formatAgeFromMonths(0)).toBe('Baru lahir');
  });
});

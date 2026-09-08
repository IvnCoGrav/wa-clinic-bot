import { describe, it, expect } from 'vitest';
import { parseIndonesianDate } from '../../../src/utils/indonesian-date-parser';

describe('parseIndonesianDate', () => {
  const ref = new Date('2026-09-08T08:00:00.000Z'); // Selasa, 8 Sept 2026

  it('mengurai "besok pagi" menjadi H+1 (9 Sept)', () => {
    const res = parseIndonesianDate('besok pagi', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDate()).toBe(9);
    expect(res.date.getMonth()).toBe(8); // Sept = 8
  });

  it('mengurai "lusa jam 10" menjadi H+2 (10 Sept)', () => {
    const res = parseIndonesianDate('lusa jam 10', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDate()).toBe(10);
  });

  it('mengurai "Sabtu depan" menjadi Sabtu terdekat', () => {
    const res = parseIndonesianDate('Sabtu depan', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDay()).toBe(6); // 6 = Sabtu
  });

  it('mengurai "12 September 2026"', () => {
    const res = parseIndonesianDate('12 September 2026', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDate()).toBe(12);
    expect(res.date.getMonth()).toBe(8);
  });
});

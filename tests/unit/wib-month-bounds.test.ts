import { describe, it, expect } from 'vitest';
import { wibMonthBoundsUtc, shiftWibMonth } from '../../src/utils/wib-time';

describe('wibMonthBoundsUtc — batas bulan WIB', () => {
  it('start = 00:00 WIB tanggal 1, end = 23:59:59.999 WIB hari terakhir', () => {
    const bounds = wibMonthBoundsUtc(2026, 11);
    expect(bounds).not.toBeNull();
    // 2026-11-01 00:00 WIB = 2026-10-31T17:00:00Z
    expect(bounds!.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    // 2026-11-30 23:59:59.999 WIB = 2026-11-30T16:59:59.999Z
    expect(bounds!.end.toISOString()).toBe('2026-11-30T16:59:59.999Z');
    expect(bounds!.daysInMonth).toBe(30);
  });

  it('menangani Februari tahun kabisat (2028) = 29 hari', () => {
    const bounds = wibMonthBoundsUtc(2028, 2);
    expect(bounds!.daysInMonth).toBe(29);
    expect(bounds!.end.toISOString()).toBe('2028-02-29T16:59:59.999Z');
  });

  it('menangani Februari non-kabisat (2026) = 28 hari', () => {
    expect(wibMonthBoundsUtc(2026, 2)!.daysInMonth).toBe(28);
  });

  it('menangani pergantian tahun: Januari start jatuh di Desember UTC', () => {
    const bounds = wibMonthBoundsUtc(2027, 1);
    expect(bounds!.start.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(bounds!.end.toISOString()).toBe('2027-01-31T16:59:59.999Z');
  });

  it.each([
    [2026, 0],
    [2026, 13],
    [2026, -1],
    [2026, 1.5],
    [NaN, 5],
    [1969, 5],
    [3000, 5],
  ])('menolak input tidak valid (%s, %s) → null', (year, month) => {
    expect(wibMonthBoundsUtc(year as number, month as number)).toBeNull();
  });
});

describe('shiftWibMonth — aritmetika bulan', () => {
  it('mundur dari Januari menyeberang tahun', () => {
    expect(shiftWibMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('maju dari Desember menyeberang tahun', () => {
    expect(shiftWibMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('mundur 3 bulan dari Februari', () => {
    expect(shiftWibMonth(2026, 2, -3)).toEqual({ year: 2025, month: 11 });
  });

  it('delta 0 tidak mengubah apa pun', () => {
    expect(shiftWibMonth(2026, 11, 0)).toEqual({ year: 2026, month: 11 });
  });
});

import { describe, it, expect } from 'vitest';
import { parseIndonesianDate } from '../../src/utils/indonesian-date-parser';
import { DATE_TEST_CORPUS, GoldenDateExpectation } from '../fixtures/date-parser/corpus';

const WIB_OFFSET_MS = 7 * 3600000;

function toWibComponents(d: Date): GoldenDateExpectation {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return {
    year: wib.getUTCFullYear(),
    month: wib.getUTCMonth(),
    day: wib.getUTCDate(),
    hourWib: wib.getUTCHours(),
    minuteWib: wib.getUTCMinutes()
  };
}

describe('Golden Date Parser Oracle & Policy Seam (Fase 4-4a)', () => {
  // Tanggal referensi tetap: 10 Juli 2026 jam 10:00 WIB (Jumat)
  const FIXED_REF_DATE = new Date(Date.UTC(2026, 6, 10, 3, 0, 0, 0)); // 10:00 WIB

  describe('1. Alur Live Booking Policy (rollPastToFuture=true, allowRelative=true)', () => {
    for (const testCase of DATE_TEST_CORPUS) {
      it(`[${testCase.id}] ${testCase.description}: "${testCase.input}"`, () => {
        const parsed = parseIndonesianDate(testCase.input, FIXED_REF_DATE, {
          rollPastToFuture: true,
          allowRelative: true
        });

        const expected = typeof testCase.expectedBooking === 'function'
          ? testCase.expectedBooking(FIXED_REF_DATE)
          : testCase.expectedBooking;

        if (expected === null) {
          expect(parsed.isRecognized, `Input "${testCase.input}" harusnya tidak dikenali (isRecognized=false)`).toBe(false);
        } else {
          expect(parsed.isRecognized, `Input "${testCase.input}" harusnya dikenali (isRecognized=true)`).toBe(true);
          const actual = toWibComponents(parsed.date);
          expect(actual.year, `Tahun tidak cocok untuk "${testCase.input}"`).toBe(expected.year);
          expect(actual.month, `Bulan tidak cocok untuk "${testCase.input}"`).toBe(expected.month);
          expect(actual.day, `Hari tidak cocok untuk "${testCase.input}"`).toBe(expected.day);
          expect(actual.hourWib, `Jam WIB tidak cocok untuk "${testCase.input}"`).toBe(expected.hourWib);
          expect(actual.minuteWib, `Menit WIB tidak cocok untuk "${testCase.input}"`).toBe(expected.minuteWib);
        }
      });
    }
  });

  describe('2. Alur Historical Backfill Policy (rollPastToFuture=false, allowRelative=false)', () => {
    for (const testCase of DATE_TEST_CORPUS) {
      it(`[${testCase.id}] ${testCase.description}: "${testCase.input}"`, () => {
        const parsed = parseIndonesianDate(testCase.input, FIXED_REF_DATE, {
          rollPastToFuture: false,
          allowRelative: false
        });

        const expected = typeof testCase.expectedHistorical === 'function'
          ? testCase.expectedHistorical(FIXED_REF_DATE)
          : testCase.expectedHistorical;

        if (expected === null) {
          expect(parsed.isRecognized, `Input "${testCase.input}" harusnya tidak dikenali di backfill (isRecognized=false)`).toBe(false);
        } else {
          expect(parsed.isRecognized, `Input "${testCase.input}" harusnya dikenali di backfill (isRecognized=true)`).toBe(true);
          const actual = toWibComponents(parsed.date);
          expect(actual.year, `Tahun tidak cocok untuk "${testCase.input}"`).toBe(expected.year);
          expect(actual.month, `Bulan tidak cocok untuk "${testCase.input}"`).toBe(expected.month);
          expect(actual.day, `Hari tidak cocok untuk "${testCase.input}"`).toBe(expected.day);
          expect(actual.hourWib, `Jam WIB tidak cocok untuk "${testCase.input}"`).toBe(expected.hourWib);
          expect(actual.minuteWib, `Menit WIB tidak cocok untuk "${testCase.input}"`).toBe(expected.minuteWib);
        }
      });
    }
  });

  describe('3. Uji Robustness Timezone & UTC Offset', () => {
    it('hasil parsing WIB selalu konsisten 7 jam di depan UTC absolut', () => {
      const parsed = parseIndonesianDate('12 Agustus 2026 jam 14.30', FIXED_REF_DATE, {
        rollPastToFuture: true,
        allowRelative: true
      });

      expect(parsed.isRecognized).toBe(true);
      // 14:30 WIB = 07:30 UTC
      expect(parsed.date.toISOString()).toBe('2026-08-12T07:30:00.000Z');
      expect(parsed.date.getUTCHours()).toBe(7);
      expect(parsed.date.getUTCMinutes()).toBe(30);
    });

    it('jam pergantian hari 00:30 WIB tetap berada pada hari yang tepat secara UTC (hari-1 17:30 UTC)', () => {
      const parsed = parseIndonesianDate('jam 00.30 senin 5 oktober 2026', FIXED_REF_DATE, {
        rollPastToFuture: true,
        allowRelative: true
      });

      expect(parsed.isRecognized).toBe(true);
      // 05 Okt 2026 00:30 WIB = 04 Okt 2026 17:30 UTC
      expect(parsed.date.toISOString()).toBe('2026-10-04T17:30:00.000Z');
      const wib = toWibComponents(parsed.date);
      expect(wib.day).toBe(5);
      expect(wib.month).toBe(9); // Oktober
      expect(wib.hourWib).toBe(0);
      expect(wib.minuteWib).toBe(30);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  LEADTIME_BRACKETS,
  JOURNEY_BRACKETS,
  NO_DATE_KEY,
  addMonths,
  capacityBandFor,
  isQualifyingStatus,
  isSandboxed,
  mean,
  median,
  monthDiff,
  round2,
  sanitizeUtmCampaign,
  sanitizeUtmSource,
  wibDateKey,
  wibDayEnd,
  wibDayStart,
  wibMonthKey,
  wibTodayStr,
} from '../../src/services/meta-performance.helpers';

/**
 * Karakterisasi helper murni Meta Ads Performance (S1-3).
 * Helper ini tidak boleh menyentuh DB; semua kasus di bawah berjalan offline.
 */
describe('meta-performance helpers — statistik', () => {
  it('median menangani ganjil, genap, kosong, dan satu elemen', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('mean mengembalikan null untuk array kosong dan rata-rata benar', () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([0.1, 0.2])).toBeCloseTo(0.15, 10);
  });

  it('round2 membulatkan ke dua desimal termasuk nilai negatif', () => {
    expect(round2(1.005)).toBe(1);
    expect(round2(1.234)).toBe(1.23);
    expect(round2(-1.235)).toBe(-1.24);
    expect(round2(0)).toBe(0);
  });
});

describe('meta-performance helpers — tanggal WIB', () => {
  it('wibDayStart/wibDayEnd memakai batas hari WIB (UTC+7)', () => {
    expect(wibDayStart('2026-08-13').toISOString()).toBe('2026-08-12T17:00:00.000Z');
    expect(wibDayEnd('2026-08-13').toISOString()).toBe('2026-08-13T16:59:59.999Z');
  });

  it('wibDayStart menolak tanggal yang tidak valid (bukan Date sampah)', () => {
    expect(() => wibDayStart('13-08-2026')).toThrow(/tidak valid/);
    expect(() => wibDayEnd('')).toThrow(/tidak valid/);
  });

  it('wibDateKey memakai kalender WIB, bukan UTC', () => {
    // 2026-01-01 00:30 WIB == 2025-12-31 17:30 UTC
    expect(wibDateKey(new Date('2025-12-31T17:30:00.000Z'))).toBe('2026-01-01');
    // 2026-01-01 06:30 WIB == 2025-12-31 23:30 UTC
    expect(wibDateKey(new Date('2025-12-31T23:30:00.000Z'))).toBe('2026-01-01');
  });

  it('wibMonthKey menghasilkan YYYY-MM pada batas bulan', () => {
    expect(wibMonthKey(new Date('2026-01-31T17:00:00.000Z'))).toBe('2026-02');
    expect(wibMonthKey(new Date('2026-01-31T16:59:59.999Z'))).toBe('2026-01');
  });

  it('wibTodayStr berformat YYYY-MM-DD', () => {
    expect(wibTodayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('monthDiff dan addMonths menyeberangi batas tahun (termasuk negatif)', () => {
    expect(monthDiff('2026-12', '2027-01')).toBe(1);
    expect(monthDiff('2027-01', '2026-12')).toBe(-1);
    expect(monthDiff('2026-01', '2026-01')).toBe(0);
    expect(addMonths('2026-01', 1)).toBe('2026-02');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-03', -15)).toBe('2024-12');
  });
});

describe('meta-performance helpers — klasifikasi reservasi', () => {
  it('isQualifyingStatus hanya mengecualikan cancelled/rejected (case-insensitive)', () => {
    expect(isQualifyingStatus('COMPLETED')).toBe(true);
    expect(isQualifyingStatus('pending')).toBe(true);
    expect(isQualifyingStatus('Cancelled')).toBe(false);
    expect(isQualifyingStatus('REJECTED')).toBe(false);
    expect(isQualifyingStatus(null)).toBe(true);
    expect(isQualifyingStatus(undefined)).toBe(true);
    expect(isQualifyingStatus('')).toBe(true);
  });

  it('isSandboxed menandai sandbox maupun staf internal', () => {
    expect(isSandboxed({ is_sandbox_test: true })).toBe(true);
    expect(isSandboxed({ is_internal_staff: true })).toBe(true);
    expect(isSandboxed({ is_sandbox_test: false, is_internal_staff: false })).toBe(false);
    expect(isSandboxed(null)).toBe(false);
    expect(isSandboxed(undefined)).toBe(false);
  });
});

describe('meta-performance helpers — sanitasi UTM', () => {
  it('sanitizeUtmCampaign memakai label default untuk kosong dan makro mentah', () => {
    expect(sanitizeUtmCampaign(null)).toBe('(tanpa campaign)');
    expect(sanitizeUtmCampaign('   ')).toBe('(tanpa campaign)');
    expect(sanitizeUtmCampaign('{{ad.id}}')).toBe('(macro UTM belum dirender)');
    expect(sanitizeUtmCampaign(' promo-august ')).toBe('promo-august');
  });

  it('sanitizeUtmSource mengembalikan null untuk kosong/makro, bukan string palsu', () => {
    expect(sanitizeUtmSource(null)).toBeNull();
    expect(sanitizeUtmSource('')).toBeNull();
    expect(sanitizeUtmSource('{{site_source_name}}')).toBeNull();
    expect(sanitizeUtmSource(' instagram ')).toBe('instagram');
  });
});

describe('meta-performance helpers — pita journey & lead time', () => {
  const journeyKey = (d: number) => JOURNEY_BRACKETS.find((b) => b.test(d))?.key;
  const leadTimeKey = (d: number) => LEADTIME_BRACKETS.find((b) => b.test(d))?.key;

  it('pita journey menutup semua nilai tanpa celah', () => {
    expect(journeyKey(0)).toBe('lt1');
    expect(journeyKey(0.99)).toBe('lt1');
    expect(journeyKey(1)).toBe('d1_3');
    expect(journeyKey(2.99)).toBe('d1_3');
    expect(journeyKey(3)).toBe('d3_7');
    expect(journeyKey(7)).toBe('d7_14');
    expect(journeyKey(13.99)).toBe('d7_14');
    expect(journeyKey(14)).toBe('gt14');
    expect(journeyKey(365)).toBe('gt14');
  });

  it('pita lead time menutup H-0 sampai > H-7 tanpa celah', () => {
    expect(leadTimeKey(-1)).toBe('same_day');
    expect(leadTimeKey(0)).toBe('same_day');
    expect(leadTimeKey(1)).toBe('h1');
    expect(leadTimeKey(2)).toBe('h2_3');
    expect(leadTimeKey(3)).toBe('h2_3');
    expect(leadTimeKey(4)).toBe('h4_7');
    expect(leadTimeKey(7)).toBe('h4_7');
    expect(leadTimeKey(8)).toBe('gt7');
  });

  it('kunci bucket unik dan NO_DATE_KEY tidak bertabrakan', () => {
    const keys = [...JOURNEY_BRACKETS, ...LEADTIME_BRACKETS, NO_DATE_KEY].map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('meta-performance helpers — pita kapasitas', () => {
  it('kapasitas: batas 65 dan 85 inklusif', () => {
    expect(capacityBandFor(null)).toBe('UNKNOWN');
    expect(capacityBandFor(Number.NaN)).toBe('UNKNOWN');
    expect(capacityBandFor(0)).toBe('AMAN');
    expect(capacityBandFor(64.99)).toBe('AMAN');
    expect(capacityBandFor(65)).toBe('OPTIMAL');
    expect(capacityBandFor(85)).toBe('OPTIMAL');
    expect(capacityBandFor(85.01)).toBe('PENUH');
    expect(capacityBandFor(150)).toBe('PENUH');
  });
});

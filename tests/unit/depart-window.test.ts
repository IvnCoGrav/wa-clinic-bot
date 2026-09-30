import { describe, it, expect } from 'vitest';
import {
  DEPART_WINDOW_MINUTES,
  isWithinDepartWindow,
  minutesUntilBooking,
  formatWibClock,
  estimateTravelMinutesKm,
  calculateHaversineKm,
} from '../../packages/admin-dashboard/src/utils/geoUtils';

/**
 * Plan 2026-09-30 (kontrol keberangkatan) — jendela ±60 menit & estimasi tiba.
 * Murni; tanpa I/O. Adversarial: batas jendela, tanggal lampau, invalid.
 */
describe('geoUtils — jendela keberangkatan', () => {
  const NOW = new Date('2026-10-15T02:00:00.000Z').getTime(); // 09:00 WIB

  it('booking 30 mnt ke depan → dalam jendela', () => {
    const iso = new Date(NOW + 30 * 60000).toISOString();
    expect(isWithinDepartWindow(iso, NOW)).toBe(true);
  });

  it('booking 61 mnt ke depan → DI LUAR jendela (mode intip)', () => {
    const iso = new Date(NOW + 61 * 60000).toISOString();
    expect(isWithinDepartWindow(iso, NOW)).toBe(false);
  });

  it('booking tepat 60 mnt → dalam jendela (boundary)', () => {
    const iso = new Date(NOW + DEPART_WINDOW_MINUTES * 60000).toISOString();
    expect(isWithinDepartWindow(iso, NOW)).toBe(true);
  });

  it('booking baru lewat 30 mnt → masih dalam jendela (relevan)', () => {
    const iso = new Date(NOW - 30 * 60000).toISOString();
    expect(isWithinDepartWindow(iso, NOW)).toBe(true);
  });

  it('booking lampau 3 jam → di luar jendela', () => {
    const iso = new Date(NOW - 180 * 60000).toISOString();
    expect(isWithinDepartWindow(iso, NOW)).toBe(false);
  });

  it('tanggal invalid / null → false (tanpa crash)', () => {
    expect(isWithinDepartWindow(null, NOW)).toBe(false);
    expect(isWithinDepartWindow('bukan-tanggal', NOW)).toBe(false);
    expect(minutesUntilBooking(undefined, NOW)).toBeNull();
  });

  it('minutesUntilBooking mengembalikan selisih menit', () => {
    const iso = new Date(NOW + 45 * 60000).toISOString();
    expect(minutesUntilBooking(iso, NOW)).toBe(45);
  });

  it('formatWibClock menambah offset menit & zona WIB', () => {
    // 02:00 UTC = 09:00 WIB; +12 mnt = 09:12
    expect(formatWibClock(new Date('2026-10-15T02:00:00.000Z'), 12)).toBe('09:12');
    expect(formatWibClock(new Date('2026-10-15T02:00:00.000Z'), 0)).toBe('09:00');
  });

  it('ETA memakai kalibrasi kanonis (reuse, bukan rumus baru)', () => {
    expect(estimateTravelMinutesKm(10)).toBe(Math.max(5, Math.round(10 * 2.05 + 3)));
  });

  it('Haversine konsisten dengan jarak nol', () => {
    expect(calculateHaversineKm(-7.34, 112.75, -7.34, 112.75)).toBe(0);
  });
});

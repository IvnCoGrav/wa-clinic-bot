import { describe, it, expect } from 'vitest';
import {
  OTW_OPEN_MINUTES_BEFORE,
  OTW_GRACE_MINUTES_AFTER,
  GPS_WARMUP_MINUTES,
  getOtwGate,
  isWithinGpsWarmupWindow,
  minutesUntilBooking,
  formatWibClock,
  estimateTravelMinutesKm,
  calculateHaversineKm,
} from '../../packages/admin-dashboard/src/utils/geoUtils';

/**
 * Plan Penyelarasan Gerbang OTW H-2 — jendela H-120 s/d H+15 & estimasi tiba.
 * Murni; tanpa I/O. Adversarial: batas jendela, toleransi milidetik mentah, invalid.
 */
describe('geoUtils — getOtwGate (kontrak gerbang OTW H-2 jam s/d H+15 mnt)', () => {
  const NOW = new Date('2026-10-15T02:00:00.000Z').getTime(); // 09:00 WIB

  it('booking H-121 mnt → DI LUAR jendela (too_early)', () => {
    const iso = new Date(NOW + 121 * 60000).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('too_early');
    expect(gate.minutesUntil).toBe(121);
  });

  it('booking tepat H-120 mnt (boundary) → DALAM jendela (ok)', () => {
    const iso = new Date(NOW + OTW_OPEN_MINUTES_BEFORE * 60000).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('ok');
    expect(gate.minutesUntil).toBe(120);
  });

  it('booking H-90 mnt → DALAM jendela (ok)', () => {
    const iso = new Date(NOW + 90 * 60000).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('ok');
    expect(gate.minutesUntil).toBe(90);
  });

  it('booking H-5 mnt → DALAM jendela (ok)', () => {
    const iso = new Date(NOW + 5 * 60000).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('ok');
    expect(gate.minutesUntil).toBe(5);
  });

  it('booking tepat saat jadwal (H-0) → DALAM jendela (ok)', () => {
    const iso = new Date(NOW).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('ok');
    expect(gate.minutesUntil).toBe(0);
  });

  it('booking lewat H+15 mnt (boundary toleransi) → DALAM jendela (ok)', () => {
    const iso = new Date(NOW - OTW_GRACE_MINUTES_AFTER * 60000).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe('ok');
    expect(gate.minutesUntil).toBe(-15);
  });

  it('booking lewat H+16 mnt → DI LUAR jendela (expired)', () => {
    const iso = new Date(NOW - 16 * 60000).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('expired');
    expect(gate.minutesUntil).toBe(-16);
  });

  it('booking lewat 15m 30s (milidetik mentah > 15m) → DI LUAR jendela (expired)', () => {
    const iso = new Date(NOW - (15 * 60000 + 30000)).toISOString();
    const gate = getOtwGate(iso, NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('expired');
  });

  it('tanggal invalid / null / undefined → false dengan reason invalid', () => {
    expect(getOtwGate(null, NOW)).toEqual({ allowed: false, reason: 'invalid', minutesUntil: null });
    expect(getOtwGate('bukan-tanggal', NOW)).toEqual({ allowed: false, reason: 'invalid', minutesUntil: null });
    expect(getOtwGate(undefined, NOW)).toEqual({ allowed: false, reason: 'invalid', minutesUntil: null });
    expect(minutesUntilBooking(undefined, NOW)).toBeNull();
  });
});

describe('geoUtils — isWithinGpsWarmupWindow (pre-warm GPS 60 mnt)', () => {
  const NOW = new Date('2026-10-15T02:00:00.000Z').getTime(); // 09:00 WIB

  it('booking 30 mnt ke depan → dalam jendela pre-warm', () => {
    const iso = new Date(NOW + 30 * 60000).toISOString();
    expect(isWithinGpsWarmupWindow(iso, NOW)).toBe(true);
  });

  it('booking 61 mnt ke depan → di luar jendela pre-warm', () => {
    const iso = new Date(NOW + 61 * 60000).toISOString();
    expect(isWithinGpsWarmupWindow(iso, NOW)).toBe(false);
  });

  it('booking tepat 60 mnt → dalam jendela pre-warm (boundary)', () => {
    const iso = new Date(NOW + GPS_WARMUP_MINUTES * 60000).toISOString();
    expect(isWithinGpsWarmupWindow(iso, NOW)).toBe(true);
  });

  it('booking baru lewat 30 mnt → masih dalam jendela pre-warm', () => {
    const iso = new Date(NOW - 30 * 60000).toISOString();
    expect(isWithinGpsWarmupWindow(iso, NOW)).toBe(true);
  });

  it('booking lampau 3 jam → di luar jendela pre-warm', () => {
    const iso = new Date(NOW - 180 * 60000).toISOString();
    expect(isWithinGpsWarmupWindow(iso, NOW)).toBe(false);
  });

  it('tanggal invalid / null → false (tanpa crash)', () => {
    expect(isWithinGpsWarmupWindow(null, NOW)).toBe(false);
    expect(isWithinGpsWarmupWindow('bukan-tanggal', NOW)).toBe(false);
  });
});

describe('geoUtils — helper murni lainnya', () => {
  const NOW = new Date('2026-10-15T02:00:00.000Z').getTime(); // 09:00 WIB

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

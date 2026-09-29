import { describe, it, expect } from 'vitest';
import {
  evaluateArrivalGeofence,
  calculateDelayStatus,
  isWithinPreTripWindow,
  ARRIVAL_RADIUS_M,
  ARRIVAL_CONSECUTIVE_PING,
  PRE_TRIP_WINDOW_MIN,
  DELAY_WARN_MIN,
  DELAY_CRITICAL_MIN,
} from '../../src/services/staff-trip-tracking.service';
import { haversineKm } from '../../src/utils/gazetteer';

// Basis koordinat (sekitar Surabaya). 1 derajat lintang ~ 111.195 km.
const BASE_LAT = -7.28;
const BASE_LNG = 112.74;

/** Geser lintang sehingga jarak garis lurus mendekati `meters`. */
function offsetLat(meters: number): number {
  return BASE_LAT + meters / 111_195;
}

describe('evaluateArrivalGeofence (adversarial)', () => {
  it('titik sama -> dalam radius, jarak 0, alasan ARRIVED bila streak cukup', () => {
    const r = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG, 10, ARRIVAL_CONSECUTIVE_PING - 1);
    expect(r.distanceM).toBe(0);
    expect(r.isArrived).toBe(true);
    expect(r.reason).toBe('ARRIVED');
    expect(r.consecutiveCount).toBe(ARRIVAL_CONSECUTIVE_PING);
  });

  it('dwell: ping ke-1 dalam radius belum ARRIVED, ping ke-2 baru ARRIVED', () => {
    const first = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, offsetLat(30), BASE_LNG, 15, 0);
    expect(first.isArrived).toBe(false);
    expect(first.reason).toBe('IN_RADIUS');
    expect(first.consecutiveCount).toBe(1);

    const second = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, offsetLat(30), BASE_LNG, 15, first.consecutiveCount);
    expect(second.isArrived).toBe(true);
    expect(second.reason).toBe('ARRIVED');
    expect(second.consecutiveCount).toBe(2);
  });

  it('lewat depan rumah: ping keluar radius me-reset streak ke 0', () => {
    const out = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, offsetLat(400), BASE_LNG, 10, 5);
    expect(out.isArrived).toBe(false);
    expect(out.consecutiveCount).toBe(0);
    expect(out.reason).toBe('OUT_OF_RANGE');
  });

  it('akurasi buruk (>100m) fail-closed: tidak pernah auto-stop, streak reset', () => {
    const r = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG, 150, 5);
    expect(r.isArrived).toBe(false);
    expect(r.reason).toBe('LOW_ACCURACY');
    expect(r.consecutiveCount).toBe(0);
    // jarak tetap dihitung untuk telemetri meski akurasi buruk
    expect(r.distanceM).toBe(0);
  });

  it('akurasi null/NaN fail-closed (tidak diasumsikan akurat)', () => {
    const n = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG, null, 5);
    expect(n.reason).toBe('LOW_ACCURACY');
    expect(n.isArrived).toBe(false);
    const nan = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG, NaN, 5);
    expect(nan.reason).toBe('LOW_ACCURACY');
  });

  it('batas radius: titik tepat di dalam vs di luar ARRIVAL_RADIUS_M', () => {
    const inside = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, offsetLat(ARRIVAL_RADIUS_M - 5), BASE_LNG, 10, 5);
    expect(inside.reason).toBe('ARRIVED');

    const outside = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, offsetLat(ARRIVAL_RADIUS_M + 20), BASE_LNG, 10, 5);
    expect(outside.isArrived).toBe(false);
    expect(outside.reason).toBe('OUT_OF_RANGE');
  });

  it('custom radius dihormati (parameter arrivalRadiusM)', () => {
    const r = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, offsetLat(80), BASE_LNG, 10, 5, 100);
    expect(r.reason).toBe('ARRIVED');
  });

  it('titik pasien belum ada (null) -> NO_CUSTOMER_COORDS, tidak crash', () => {
    const r = evaluateArrivalGeofence(BASE_LAT, BASE_LNG, null, null, 10, 5);
    expect(r.reason).toBe('NO_CUSTOMER_COORDS');
    expect(r.isArrived).toBe(false);
    expect(r.distanceM).toBeNull();
  });

  it('koordinat terapis invalid -> INVALID_COORDS', () => {
    const r = evaluateArrivalGeofence(999, 0, BASE_LAT, BASE_LNG, 10, 5);
    expect(r.reason).toBe('INVALID_COORDS');
    expect(r.isArrived).toBe(false);
    expect(r.distanceM).toBeNull();
  });
});

describe('calculateDelayStatus (adversarial)', () => {
  // now = 09:35 WIB (02:35 UTC)
  const now = new Date('2026-09-29T02:35:00.000Z');
  const booking = new Date('2026-09-29T03:00:00.000Z'); // 10:00 WIB

  it('tiba lebih awal (ETA 10 mnt) -> tidak telat', () => {
    const r = calculateDelayStatus(booking, 10, now);
    expect(r.isDelayed).toBe(false);
    expect(r.level).toBe('none');
    expect(r.delayMinutes).toBeLessThan(0);
  });

  it('delayMinutes = estimasiTiba - jadwal (bukan minus toleransi)', () => {
    // ETA 45 mnt -> tiba 10:20 WIB -> delay 20 mnt
    const r = calculateDelayStatus(booking, 45, now);
    expect(r.delayMinutes).toBe(20);
    expect(r.level).toBe('warning');
    expect(r.isDelayed).toBe(true);
  });

  it('ambang warning 20 mnt: 19 -> none, 20 -> warning, 29 -> warning', () => {
    expect(calculateDelayStatus(booking, 44, now).level).toBe('none'); // 19 mnt
    expect(calculateDelayStatus(booking, 45, now).level).toBe('warning'); // 20 mnt
    expect(calculateDelayStatus(booking, 54, now).level).toBe('warning'); // 29 mnt
  });

  it('ambang critical 30 mnt: 30 -> critical', () => {
    const r = calculateDelayStatus(booking, 55, now); // 30 mnt
    expect(r.delayMinutes).toBe(DELAY_CRITICAL_MIN);
    expect(r.level).toBe('critical');
  });

  it('ambang dapat di-override (opts)', () => {
    const r = calculateDelayStatus(booking, 45, now, { warnMin: 25, criticalMin: 40 });
    expect(r.level).toBe('none');
  });

  it('bookingDate null/invalid -> NO_SCHEDULE (fail-open, tidak menuduh telat)', () => {
    expect(calculateDelayStatus(null, 45, now).reason).toBe('NO_SCHEDULE');
    expect(calculateDelayStatus(null, 45, now).isDelayed).toBe(false);
    expect(calculateDelayStatus(new Date('x'), 45, now).reason).toBe('NO_SCHEDULE');
  });

  it('ETA null/NaN -> NO_ETA', () => {
    expect(calculateDelayStatus(booking, null, now).reason).toBe('NO_ETA');
    expect(calculateDelayStatus(booking, NaN, now).reason).toBe('NO_ETA');
  });

  it('formattedArrivalWib memakai zona Asia/Jakarta (bukan UTC)', () => {
    // now 09:35 WIB + 45 mnt = 10:20 WIB
    const r = calculateDelayStatus(booking, 45, now);
    expect(r.formattedArrivalWib).toMatch(/10[.:]20/);
    expect(r.estimatedArrivalIso).toBe(new Date('2026-09-29T03:20:00.000Z').toISOString());
  });

  it('WIB tengah malam tidak menggeser hari', () => {
    const midnightNow = new Date('2026-09-29T16:50:00.000Z'); // 23:50 WIB
    const bookingMid = new Date('2026-09-29T17:00:00.000Z'); // 00:00 WIB (30 Sep)
    const r = calculateDelayStatus(bookingMid, 20, midnightNow); // tiba 00:10 WIB
    expect(r.formattedArrivalWib).toMatch(/00[.:]10/);
    expect(r.delayMinutes).toBe(10);
  });
});

describe('isWithinPreTripWindow (adversarial)', () => {
  const now = new Date('2026-09-29T02:00:00.000Z');

  it('jadwal 30 mnt lagi -> true (tepat batas)', () => {
    expect(isWithinPreTripWindow(new Date('2026-09-29T02:30:00.000Z'), now)).toBe(true);
  });

  it('jadwal 31 mnt lagi -> false', () => {
    expect(isWithinPreTripWindow(new Date('2026-09-29T02:31:00.000Z'), now)).toBe(false);
  });

  it('jadwal 5 mnt lagi -> true', () => {
    expect(isWithinPreTripWindow(new Date('2026-09-29T02:05:00.000Z'), now)).toBe(true);
  });

  it('jadwal sudah lewat jauh (durasi+grace) -> false', () => {
    expect(isWithinPreTripWindow(new Date('2026-09-28T20:00:00.000Z'), now)).toBe(false);
  });

  it('bookingDate null/invalid -> false (fail-closed)', () => {
    expect(isWithinPreTripWindow(null, now)).toBe(false);
    expect(isWithinPreTripWindow(new Date('x'), now)).toBe(false);
  });

  it('window dapat di-override', () => {
    expect(isWithinPreTripWindow(new Date('2026-09-29T02:45:00.000Z'), now, 60)).toBe(true);
  });

  it('default window = PRE_TRIP_WINDOW_MIN', () => {
    expect(PRE_TRIP_WINDOW_MIN).toBe(30);
    expect(DELAY_WARN_MIN).toBe(20);
    expect(ARRIVAL_RADIUS_M).toBe(50);
  });
});

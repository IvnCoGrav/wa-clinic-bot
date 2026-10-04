import { describe, it, expect, beforeEach } from 'vitest';
import {
  staffTripTrackingService,
  resolveHumanAreaName,
  calculateTripProgress,
  evaluateGeofenceAlert,
} from '../../src/services/staff-trip-tracking.service';

const T = 'tenant-trip-1';
const R = 'res-trip-1';
const S = 'staff-trip-1';

beforeEach(() => {
  staffTripTrackingService.clearAll();
});

describe('staff-trip-tracking Fase 1 (adversarial)', () => {
  it('record -> get -> clear roundtrip + isolasi tenant', () => {
    const rec = staffTripTrackingService.recordTripPing(T, R, S, { lat: -7.28, lng: 112.74 });
    expect(rec.tenantId).toBe(T);
    expect(rec.areaName.length).toBeGreaterThan(0);
    expect(staffTripTrackingService.getTrip(T, R)?.lat).toBe(-7.28);
    // Tenant lain tidak bocor
    expect(staffTripTrackingService.getTrip('tenant-lain', R)).toBeNull();
    expect(staffTripTrackingService.clearTrip(T, R)).toBe(true);
    expect(staffTripTrackingService.getTrip(T, R)).toBeNull();
  });

  it('menolak tenant/reservasi/staff kosong + koordinat invalid', () => {
    expect(() => staffTripTrackingService.recordTripPing('', R, S, { lat: -7.28, lng: 112.74 })).toThrow(
      /TENANT_REQUIRED/
    );
    expect(() => staffTripTrackingService.recordTripPing(T, '', S, { lat: -7.28, lng: 112.74 })).toThrow();
    expect(() =>
      staffTripTrackingService.recordTripPing(T, R, S, { lat: 999, lng: 112.74 })
    ).toThrow(/INVALID_COORDS/);
    expect(() =>
      staffTripTrackingService.recordTripPing(T, R, S, { lat: -7.28, lng: 112.74, accuracy: 600 })
    ).toThrow(/ACCURACY/);
  });

  it('ping kedua overwrite posisi tapi pertahankan createdAt', () => {
    const first = staffTripTrackingService.recordTripPing(T, R, S, { lat: -7.28, lng: 112.74 });
    const second = staffTripTrackingService.recordTripPing(T, R, S, {
      lat: -7.29,
      lng: 112.75,
      speed: 5,
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lat).toBe(-7.29);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('resolveHumanAreaName tidak pernah throw/kosong (multi-kasus)', () => {
    expect(resolveHumanAreaName(-7.28, 112.74).length).toBeGreaterThan(0);
    expect(resolveHumanAreaName(0, 0)).toBe('Area perjalanan');
    expect(resolveHumanAreaName(NaN, 112.74)).toBe('Area perjalanan');
    expect(resolveHumanAreaName(999, 999)).toBe('Area perjalanan');
  });

  it('calculateTripProgress: titik sama ~0km, invalid null, ETA clamp', () => {
    const same = calculateTripProgress(-7.28, 112.74, -7.28, 112.74);
    expect(same).not.toBeNull();
    expect(same!.remainingKm).toBe(0);
    expect(same!.etaMinutes).toBeGreaterThanOrEqual(1);
    expect(calculateTripProgress(999, 0, -7.28, 112.74)).toBeNull();
    const far = calculateTripProgress(-7.28, 112.74, -7.45, 112.7);
    expect(far!.etaMinutes).toBeLessThanOrEqual(120);
  });

  it('geofence: batas 300m/1500m + stalled 180s + speed + akurasi', () => {
    // Terlalu dekat = zona tiba, bukan lost
    const inside = evaluateGeofenceAlert(-7.28, 112.74, -7.2805, 112.7405, 0, 10, 600);
    expect(inside.isStalledOutsideTarget).toBe(false);
    // Terlalu jauh = masih en-route
    const enroute = evaluateGeofenceAlert(-7.28, 112.74, -7.45, 112.7, 0, 10, 900);
    expect(enroute.reason).toBe('EN_ROUTE');
    // Bergerak cepat = bukan stalled
    const moving = evaluateGeofenceAlert(-7.345, 112.74, -7.354, 112.74, 8, 10, 900);
    expect(moving.reason).toBe('MOVING');
    // Akurasi buruk = jangan alert
    const lowAcc = evaluateGeofenceAlert(-7.345, 112.74, -7.354, 112.74, 0, 250, 900);
    expect(lowAcc.reason).toBe('LOW_ACCURACY');
    expect(lowAcc.isStalledOutsideTarget).toBe(false);
    // Belum cukup lama
    const early = evaluateGeofenceAlert(-7.345, 112.74, -7.354, 112.74, 0, 10, 179);
    expect(early.isStalledOutsideTarget).toBe(false);
    // Kasus lost ~1km diam 4 menit
    const lost = evaluateGeofenceAlert(-7.345, 112.74, -7.354, 112.74, 0, 10, 240);
    expect(lost.isStalledOutsideTarget).toBe(true);
    expect(lost.reason).toBe('STALLED_OUTSIDE_TARGET');
    // Koordinat rusak
    expect(evaluateGeofenceAlert(999, 0, -7.28, 112.74, 0, 10, 999).isStalledOutsideTarget).toBe(false);
  });
});

/**
 * Provenance titik awal (plan 2026-10-04). Adversarial: default GPS untuk ping
 * asli, estimasi prev_patient tersimpan apa adanya, dan ping telemetry asli
 * berikutnya mengembalikan penanda ke 'gps' (bukan nyangkut di estimasi).
 */
describe('staff-trip-tracking — originSource (adversarial)', () => {
  it('default gps; prev_patient tersimpan; ping asli berikutnya kembali gps', () => {
    const def = staffTripTrackingService.recordTripPing(T, R, S, { lat: -7.28, lng: 112.74 });
    expect(def.originSource).toBe('gps');

    staffTripTrackingService.clearAll();
    const est = staffTripTrackingService.recordTripPing(
      T,
      R,
      S,
      { lat: -7.281, lng: 112.741, accuracy: null },
      { originSource: 'prev_patient' }
    );
    expect(est.originSource).toBe('prev_patient');

    // Telemetry GPS asli menyusul (tanpa state) → kembali 'gps'.
    const real = staffTripTrackingService.recordTripPing(T, R, S, { lat: -7.29, lng: 112.75 });
    expect(real.originSource).toBe('gps');
  });
});

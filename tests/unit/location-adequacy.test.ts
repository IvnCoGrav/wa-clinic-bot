import { describe, it, expect } from 'vitest';
import {
  resolveLocationAdequacy,
  resolveEffectiveLocationSource,
  extractStaffVerifiedCoords,
} from '../../src/domain/location-adequacy';

/**
 * Uji adversarial sumber kebenaran lokasi (TEMUAN C-001/C-002).
 * Skenario nyata diambil dari data produksi 2026-11-06:
 *  - Bunda Lutfiah (gps_pin setelah kirim link Maps)
 *  - Bunda Diana (manual_staff, akurasi 14 m)
 *  - Bunda Hida (kolom estimated_area TAPI preferences manual_staff + riwayat staf)
 */
describe('location-adequacy — sumber kebenaran lokasi tunggal', () => {
  it('Lutfiah: kolom gps_pin + share_location_sent → presisi', () => {
    const r = resolveLocationAdequacy({
      columnSource: 'gps_pin',
      shareLocationSent: true,
      lat: -7.3276242,
      lng: 112.7677506,
    });
    expect(r.source).toBe('gps_pin');
    expect(r.isAdequate).toBe(true);
    expect(r.needsShareloc).toBe(false);
  });

  it('Diana: kolom manual_staff + bukti verifikasi staf → memadai (bukan butuh shareloc)', () => {
    const r = resolveLocationAdequacy({
      columnSource: 'manual_staff',
      preferenceSource: 'manual_staff',
      staffVerified: true,
      lat: -7.2148994,
      lng: 112.7723543,
      staffVerifiedCoords: { lat: -7.2148994, lng: 112.7723543 },
    });
    expect(r.source).toBe('manual_staff');
    expect(r.isAdequate).toBe(true);
    expect(r.needsShareloc).toBe(false);
    expect(r.reason).toBe('staff_verified');
  });

  it('Hida: kolom estimated_area TAPI preferences manual_staff di titik yang sama → memadai', () => {
    const r = resolveLocationAdequacy({
      columnSource: 'estimated_area',
      preferenceSource: 'manual_staff',
      staffVerified: true,
      lat: -7.3805925,
      lng: 112.6749883,
      staffVerifiedCoords: { lat: -7.3805925, lng: 112.6749883 },
    });
    expect(r.source).toBe('manual_staff');
    expect(r.needsShareloc).toBe(false);
  });

  it('pelanggan pindah rumah: verifikasi staf lama 2 km dari titik sekarang → JANGAN dianggap memadai', () => {
    const r = resolveLocationAdequacy({
      columnSource: 'estimated_area',
      preferenceSource: 'manual_staff',
      staffVerified: true,
      lat: -7.3805925,
      lng: 112.6749883,
      staffVerifiedCoords: { lat: -7.3605925, lng: 112.6749883 },
    });
    expect(r.source).toBe('estimated_area');
    expect(r.needsShareloc).toBe(true);
  });

  it('bukti lapangan (foto rumah + riwayat kunjungan + alamat lengkap) → memadai', () => {
    const r = resolveLocationAdequacy({
      columnSource: 'estimated_area',
      lat: -7.3805925,
      lng: 112.6749883,
      housePhotoUrl: '/media/outbound/default-tenant/rumah.jpg',
      purchaseCount: 11,
      hasVisitedAddress: true,
      hasCompleteAddress: true,
    });
    expect(r.isAdequate).toBe(true);
    expect(r.needsShareloc).toBe(false);
    expect(r.reason).toBe('field_verified');
  });

  it('rumah BARU (belum pernah dikunjungi) tidak boleh memakai bukti lapangan rumah lama', () => {
    const r = resolveLocationAdequacy({
      columnSource: 'estimated_area',
      lat: -7.31,
      lng: 112.71,
      housePhotoUrl: '/media/outbound/default-tenant/rumah-lama.jpg',
      purchaseCount: 11,
      hasVisitedAddress: false,
      hasCompleteAddress: true,
    });
    expect(r.source).toBe('estimated_area');
    expect(r.needsShareloc).toBe(true);
  });

  it('lokasi estimasi tanpa bukti lapangan → butuh shareloc', () => {
    const r = resolveLocationAdequacy({
      columnSource: 'estimated_area',
      lat: -7.38,
      lng: 112.67,
    });
    expect(r.source).toBe('estimated_area');
    expect(r.needsShareloc).toBe(true);
  });

  it('tanpa koordinat valid → unknown + butuh shareloc', () => {
    const r = resolveLocationAdequacy({ columnSource: 'gps_pin', lat: null, lng: null, shareLocationSent: false });
    expect(r.source).toBe('unknown');
    expect(r.needsShareloc).toBe(true);
  });

  it('share_location_sent tanpa koordinat valid TIDAK boleh dianggap presisi', () => {
    const r = resolveLocationAdequacy({ shareLocationSent: true, lat: null, lng: null });
    expect(r.source).toBe('unknown');
    expect(r.needsShareloc).toBe(true);
  });

  it('normalisasi sumber: bidan_shareloc / url_coords / db_coords', () => {
    expect(resolveEffectiveLocationSource({ source: 'bidan_shareloc' })).toBe('gps_pin');
    expect(resolveEffectiveLocationSource({ source: 'url_coords' })).toBe('gps_pin');
    expect(resolveEffectiveLocationSource({ source: 'db_coords' })).toBe('estimated_area');
    expect(resolveEffectiveLocationSource({ source: 'FIELD_STAFF_GPS' })).toBe('manual_staff');
    expect(resolveEffectiveLocationSource({ source: 'ngawur' })).toBeNull();
  });

  it('extractStaffVerifiedCoords mengambil riwayat staf terbaru', () => {
    const coords = extractStaffVerifiedCoords({
      location_history: [
        { source: 'db_coords', lat: -7.1, lng: 112.1, refreshedAt: '2026-10-01T00:00:00Z' },
        { source: 'manual_staff', lat: -7.2, lng: 112.2, updatedAt: '2026-10-02T00:00:00Z' },
        { source: 'manual_staff', lat: -7.3, lng: 112.3, updatedAt: '2026-10-03T00:00:00Z' },
      ],
    });
    expect(coords).toEqual({ lat: -7.3, lng: 112.3 });
  });
});

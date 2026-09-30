import { describe, it, expect } from 'vitest';
import {
  classifyLocationDrift,
  type StoredLocation,
  type ResolvedLocation,
} from '../../src/utils/location-drift';

/**
 * Gerbang keputusan rekonsiliasi lokasi pelanggan (pure, tanpa DB).
 * Berbasis STATE (location_source, kelurahan, koordinat) — bukan pencocokan
 * kalimat. Menguji ketahanan terhadap kasus batas & data terkunci staf.
 */
describe('classifyLocationDrift — gerbang rekonsiliasi lokasi', () => {
  const resolved: ResolvedLocation = { kelurahan: 'Tambakoso', kecamatan: 'Waru', lat: -7.3553, lng: 112.8065 };

  it('manual_staff TERKUNCI: tidak pernah ditimpa otomasi', () => {
    const stored: StoredLocation = {
      kelurahan: 'Suko', kecamatan: 'Sukodono', lat: -7.44615, lng: 112.678558,
      location_source: 'manual_staff',
    };
    const d = classifyLocationDrift(stored, resolved, 'Tambak Os Waru');
    expect(d.shouldReconcile).toBe(false);
    expect(d.reason).toBe('locked_manual_staff');
  });

  it('kelurahan beda (hijack) → rekonsiliasi + drift terukur', () => {
    const stored: StoredLocation = { kelurahan: 'Suko', kecamatan: 'Sukodono', lat: -7.44615, lng: 112.678558 };
    const d = classifyLocationDrift(stored, resolved, 'Tambak Os Waru');
    expect(d.shouldReconcile).toBe(true);
    expect(d.reason).toBe('kelurahan_mismatch');
    expect(d.driftKm).not.toBeNull();
    expect(d.driftKm!).toBeGreaterThan(5);
  });

  it('tanpa teks rujukan → skip (anti-fabrikasi)', () => {
    const stored: StoredLocation = { kelurahan: 'Suko', lat: -7.44615, lng: 112.678558 };
    const d = classifyLocationDrift(stored, resolved, null);
    expect(d.shouldReconcile).toBe(false);
    expect(d.reason).toBe('no_reference_text');
  });

  it('resolve ulang gagal → skip (tidak mengarang)', () => {
    const stored: StoredLocation = { kelurahan: 'Suko', lat: -7.44615, lng: 112.678558 };
    const d = classifyLocationDrift(stored, null, 'Alamat Entah Dimana 123');
    expect(d.shouldReconcile).toBe(false);
    expect(d.reason).toBe('no_resolution');
  });

  it('titik tersimpan di luar (sentroid lama) tapi kelurahan sama → ok (tidak diutak-atik tanpa bukti)', () => {
    // Audit Google Maps membuktikan lng timur bukan sinyal air; jadi drift
    // koordinat TANPA perbedaan kelurahan TIDAK cukup memicu overwrite.
    const stored: StoredLocation = { kelurahan: 'Tambakoso', kecamatan: 'Waru', lat: -7.35, lng: 112.8135304 };
    const d = classifyLocationDrift(stored, resolved, 'Tambakoso');
    expect(d.shouldReconcile).toBe(false);
    expect(d.reason).toBe('ok');
  });

  it('sudah benar (kelurahan sama) → ok, tidak diutak-atik', () => {
    const stored: StoredLocation = { kelurahan: 'Tambakoso', kecamatan: 'Waru', lat: -7.3553, lng: 112.8065 };
    const d = classifyLocationDrift(stored, resolved, 'Tambakoso Waru');
    expect(d.shouldReconcile).toBe(false);
    expect(d.reason).toBe('ok');
  });
});

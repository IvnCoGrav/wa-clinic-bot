import { describe, it, expect } from 'vitest';
import {
  buildMapsUrls,
  resolveLocationSource,
} from '../../src/services/staff-reservation.service';
import {
  getGoogleMapsDirectionUrl,
  needsNavigationPreflight,
} from '../../packages/admin-dashboard/src/utils/geoUtils';

/**
 * Uji adversarial akurasi navigasi (insiden Bidan tersasar 2026-09-30).
 * Fokus: URL tujuan Google Maps WAJIB membedakan titik GPS presisi vs
 * estimasi staf/geocoding, dan gerbang pra-navigasi HANYA terbuka untuk presisi.
 * Murni — tanpa DOM, tanpa DB.
 */
describe('buildMapsUrls — destination sadar akurasi', () => {
  const LAT = -7.356239;
  const LNG = 112.814143;

  it('gps_pin: destination tetap koordinat presisi (byte-identik perilaku lama)', () => {
    const { mapsUrl, navigationUrl } = buildMapsUrls(LAT, LNG, 'gps_pin', 'The Oso Blok C-06');
    expect(mapsUrl).toBe(`https://maps.google.com/?q=${LAT},${LNG}`);
    expect(navigationUrl).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${LAT},${LNG}&travelmode=two-wheeler`
    );
  });

  it('manual_staff + alamat: destination memakai teks alamat (bukan pin mati)', () => {
    const { navigationUrl } = buildMapsUrls(
      LAT,
      LNG,
      'manual_staff',
      'The Oso, The Wise Blok C-06, Tambakoso, Waru, Sidoarjo'
    );
    expect(navigationUrl).toBeTruthy();
    const dest = new URL(navigationUrl!).searchParams.get('destination');
    // Harus berisi nama cluster, bukan hanya koordinat
    expect(dest).toContain('The Oso');
    expect(dest).not.toBe(`${LAT},${LNG}`);
  });

  it('estimated_area + alamat: juga memakai teks alamat', () => {
    const { navigationUrl } = buildMapsUrls(LAT, LNG, 'estimated_area', 'Perumahan The Oso');
    const dest = new URL(navigationUrl!).searchParams.get('destination');
    expect(dest).toContain('The Oso');
  });

  it('manual_staff TANPA alamat: fallback ke koordinat (jangan URL kosong)', () => {
    const { navigationUrl } = buildMapsUrls(LAT, LNG, 'manual_staff', null);
    expect(navigationUrl).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${LAT},${LNG}&travelmode=two-wheeler`
    );
  });

  it('locationSource null + alamat: tetap koordinat (kompatibel mundur)', () => {
    const { navigationUrl } = buildMapsUrls(LAT, LNG, null, 'The Oso');
    expect(navigationUrl).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${LAT},${LNG}&travelmode=two-wheeler`
    );
  });

  it('koordinat tidak valid: kedua URL null (tanpa crash)', () => {
    expect(buildMapsUrls(undefined, undefined, 'gps_pin', 'x')).toEqual({
      mapsUrl: null,
      navigationUrl: null,
    });
    expect(buildMapsUrls(NaN, 112.8, 'gps_pin', 'x')).toEqual({
      mapsUrl: null,
      navigationUrl: null,
    });
  });
});

describe('needsNavigationPreflight — gerbang deterministik', () => {
  it('gps_pin TIDAK butuh gerbang (boleh langsung navigasi)', () => {
    expect(needsNavigationPreflight('gps_pin')).toBe(false);
  });

  it('manual_staff / estimated_area / null WAJIB melewati gerbang', () => {
    expect(needsNavigationPreflight('manual_staff')).toBe(true);
    expect(needsNavigationPreflight('estimated_area')).toBe(true);
    expect(needsNavigationPreflight(null)).toBe(true);
    expect(needsNavigationPreflight(undefined)).toBe(true);
  });
});

describe('getGoogleMapsDirectionUrl — sinkron dengan backend', () => {
  const LAT = -7.356239;
  const LNG = 112.814143;

  it('tanpa locationSource: perilaku lama (koordinat) dipertahankan', () => {
    const url = getGoogleMapsDirectionUrl(LAT, LNG, 'The Oso');
    expect(url).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${LAT},${LNG}&travelmode=two-wheeler`
    );
  });

  it('gps_pin: koordinat meski ada fallbackText', () => {
    const url = getGoogleMapsDirectionUrl(LAT, LNG, 'The Oso', 'gps_pin');
    expect(url).toContain(`destination=${LAT},${LNG}`);
  });

  it('manual_staff + fallbackText: destination teks alamat', () => {
    const url = getGoogleMapsDirectionUrl(LAT, LNG, 'The Oso Blok C-06', 'manual_staff');
    const dest = new URL(url).searchParams.get('destination');
    expect(dest).toContain('The Oso');
  });

  it('manual_staff tanpa fallbackText: jatuh ke koordinat', () => {
    const url = getGoogleMapsDirectionUrl(LAT, LNG, null, 'manual_staff');
    expect(url).toContain(`destination=${LAT},${LNG}`);
  });
});

describe('resolveLocationSource — derivasi state kanonis', () => {
  it('kolom manual_staff menang atas preferensi gps', () => {
    expect(
      resolveLocationSource({ location_source: 'manual_staff', preferences: { location_source: 'customer_shareloc' } })
    ).toBe('manual_staff');
  });

  it('data lama tanpa kolom + share_location_sent → gps_pin', () => {
    expect(
      resolveLocationSource({ location_source: null, preferences: {}, share_location_sent: true, lat: -7.4, lng: 112.7 })
    ).toBe('gps_pin');
  });
});

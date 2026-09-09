import { describe, it, expect } from 'vitest';
import { extractWahaLocation } from '../../src/utils/waha-location-parser';

/**
 * Component 1 — Normalisasi payload lokasi WAHA Baileys (kasus Bunda Retno).
 * Shareloc asli (-7.393858, 112.745941) wajib terbaca dari path Baileys,
 * bukan menguap jadi NaN / pesan teks biasa.
 */
describe('extractWahaLocation (WAHA NOWEB / Baileys / lawas)', () => {
  it('membaca _data.message.locationMessage.degreesLatitude/degreesLongitude (kasus Retno)', () => {
    const payload = {
      _data: {
        message: {
          locationMessage: {
            degreesLatitude: -7.393858,
            degreesLongitude: 112.745941,
          },
        },
      },
      type: 'message',
    };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(true);
    expect(r.isLocationMsgType).toBe(true);
    expect(r.rawLat).toBeCloseTo(-7.393858, 6);
    expect(r.rawLng).toBeCloseTo(112.745941, 6);
  });

  it('membaca message.locationMessage langsung (tanpa _data)', () => {
    const payload = {
      message: { locationMessage: { degreesLatitude: -7.39, degreesLongitude: 112.74 } },
    };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(true);
    expect(r.rawLat).toBeCloseTo(-7.39, 6);
  });

  it('membaca liveLocationMessage (lokasi live)', () => {
    const payload = {
      _data: {
        message: {
          liveLocationMessage: { degreesLatitude: -7.39, degreesLongitude: 112.74 },
        },
      },
    };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(true);
  });

  it('tetap membaca format lawas payload.location.latitude/longitude', () => {
    const payload = { location: { latitude: -7.35, longitude: 112.75 }, type: 'location' };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(true);
    expect(r.rawLat).toBeCloseTo(-7.35, 6);
    expect(r.rawLng).toBeCloseTo(112.75, 6);
  });

  it('membuang koordinat 0,0 (EXIF/WA Web image)', () => {
    const payload = { location: { latitude: 0, longitude: 0 }, type: 'image' };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(false);
  });

  it('pesan teks biasa tanpa lokasi → false (raw NaN, bukan lokasi)', () => {
    const payload = { body: 'Halo kak', type: 'text' };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(false);
    expect(r.isLocationMsgType).toBe(false);
    expect(Number.isNaN(r.rawLat)).toBe(true);
  });

  it('tipe location tanpa koordinat → false (tidak bocor NaN ke pipeline)', () => {
    const payload = { type: 'location' };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(false);
  });

  it('string angka ("-7.39") tetap terparse', () => {
    const payload = {
      _data: { message: { locationMessage: { degreesLatitude: '-7.393858', degreesLongitude: '112.745941' } } },
    };
    const r = extractWahaLocation(payload);
    expect(r.hasRealLocation).toBe(true);
    expect(r.rawLat).toBeCloseTo(-7.393858, 6);
  });

  it('payload kosong/null aman', () => {
    expect(extractWahaLocation(null).hasRealLocation).toBe(false);
    expect(extractWahaLocation(undefined).hasRealLocation).toBe(false);
    expect(extractWahaLocation({}).hasRealLocation).toBe(false);
  });
});

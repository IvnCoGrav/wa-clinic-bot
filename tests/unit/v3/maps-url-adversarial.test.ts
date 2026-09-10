import { describe, it, expect } from 'vitest';
import {
  extractCoordinatesFromUrlString,
  extractAddressQueryFromUrlString,
  extractGoogleMapsUrls,
} from '../../../src/utils/google-maps-url-resolver';

/**
 * Phase 0 (audit 315036) — adversarial URL resolver: directions (daddr),
 * protobuf ter-encode, pin tempat (q=), dan shortlink tanpa koordinat.
 * Murni offline, deterministik (tanpa network).
 */
describe('Maps URL Resolver Adversarial', () => {
  it('daddr directions -> koordinat terekstrak', () => {
    const r = extractCoordinatesFromUrlString(
      'https://www.google.com/maps/dir/?api=1&daddr=-7.2970621,112.6521768'
    );
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(-7.2970621, 5);
    expect(r!.lng).toBeCloseTo(112.6521768, 5);
  });

  it('saddr / destination variant -> koordinat terekstrak', () => {
    expect(extractCoordinatesFromUrlString('https://maps.google.com/?saddr=-7.3,112.65')?.lat)
      .toBeCloseTo(-7.3, 5);
    expect(extractCoordinatesFromUrlString('https://maps.google.com/?destination=-7.31,112.66')?.lng)
      .toBeCloseTo(112.66, 5);
  });

  it('protobuf ter-encode (%213d/%214d) -> koordinat terekstrak', () => {
    const r = extractCoordinatesFromUrlString(
      'https://www.google.com/maps/place/x/data=%213d-7.2970621%214d112.6521768'
    );
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(-7.2970621, 5);
  });

  it('q= nama tempat -> addressQuery (fallback geocoding), bukan null', () => {
    const q = extractAddressQueryFromUrlString(
      'https://www.google.com/maps/place/?q=Waterplace+Residence+Tower+A+Surabaya'
    );
    expect(q).not.toBeNull();
    expect(q!).toMatch(/waterplace/i);
  });

  it('q= koordinat angka -> null (ranah pola koordinat, bukan alamat)', () => {
    expect(extractAddressQueryFromUrlString('https://maps.google.com/?q=-7.29,112.65')).toBeNull();
  });

  it('shortlink tanpa koordinat -> null tanpa throw', () => {
    expect(extractCoordinatesFromUrlString('https://maps.app.goo.gl/9tino2KDgFKrq8aj8')).toBeNull();
    expect(extractAddressQueryFromUrlString('https://maps.app.goo.gl/9tino2KDgFKrq8aj8')).toBeNull();
  });

  it('extractGoogleMapsUrls mengenali share.google & maps.app.goo.gl di teks chat', () => {
    const urls = extractGoogleMapsUrls(
      'kak ini lokasinya https://share.google/Ef30htzIpVPKEwdWP dan https://maps.app.goo.gl/9tino2KDgFKrq8aj8 ya'
    );
    expect(urls.length).toBe(2);
  });

  it('koordinat invalid (0,0) ditolak', () => {
    expect(extractCoordinatesFromUrlString('https://www.google.com/maps/@0,0,17z')).toBeNull();
  });
});

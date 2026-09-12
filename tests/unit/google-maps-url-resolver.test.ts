import { describe, it, expect } from 'vitest';
import {
  extractGoogleMapsUrls,
  extractCoordinatesFromUrlString,
  extractAddressQueryFromUrlString,
  parseMapsUrl,
  parseLatLngPair,
} from '../../src/utils/google-maps-url-resolver';

describe('Google Maps URL Resolver Utility', () => {
  it('extracts Google Maps URLs from mixed text', () => {
    const text = 'Alamat di Jl. Griya Kebraon Utama AU 18 (https://maps.app.goo.gl/DGusQAqJDvPWznBV6), patokan pagar hitam.';
    const urls = extractGoogleMapsUrls(text);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://maps.app.goo.gl/DGusQAqJDvPWznBV6');
  });

  it('extracts coordinates from @lat,lng standard URL', () => {
    const url = 'https://www.google.com/maps/place/Surabaya/@-7.3278912,112.6954231,17z/data=!3m1!4b1';
    const coords = extractCoordinatesFromUrlString(url);
    expect(coords).not.toBeNull();
    expect(coords?.lat).toBeCloseTo(-7.3278912, 5);
    expect(coords?.lng).toBeCloseTo(112.6954231, 5);
  });

  it('extracts coordinates from ?q=lat,lng query URL', () => {
    const url = 'https://maps.google.com/?q=-7.3488600,112.7516770';
    const coords = extractCoordinatesFromUrlString(url);
    expect(coords).not.toBeNull();
    expect(coords?.lat).toBeCloseTo(-7.34886, 5);
    expect(coords?.lng).toBeCloseTo(112.751677, 5);
  });

  it('extracts coordinates from !3d!4d proto URL', () => {
    const url = 'https://www.google.com/maps/place/Kala+Baby+Spa/!3d-7.34886!4d112.751677';
    const coords = extractCoordinatesFromUrlString(url);
    expect(coords).not.toBeNull();
    expect(coords?.lat).toBeCloseTo(-7.34886, 5);
    expect(coords?.lng).toBeCloseTo(112.751677, 5);
  });

  it('returns empty array when text has no Google Maps links', () => {
    const text = 'Alamat di Jl. Raya Darmo No 10 Surabaya';
    expect(extractGoogleMapsUrls(text)).toEqual([]);
  });

  it('extracts new share.google shortlinks (kasus Bunda Retno)', () => {
    const text = 'Shareloc rumah saya https://share.google/Ef30htzIpVPKEwdWP ya kak';
    const urls = extractGoogleMapsUrls(text);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://share.google/Ef30htzIpVPKEwdWP');
  });

  it('extracts share.google links alongside legacy shortlinks', () => {
    const text = 'Titik 1 https://share.google/Ef30htzIpVPKEwdWP dan titik 2 https://maps.app.goo.gl/DGusQAqJDvPWznBV6';
    const urls = extractGoogleMapsUrls(text);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe('https://share.google/Ef30htzIpVPKEwdWP');
    expect(urls[1]).toBe('https://maps.app.goo.gl/DGusQAqJDvPWznBV6');
  });
});

describe('Google Maps URL Standard Parser (Plan 6 FASE 2, Issue #16)', () => {
  it('parseMapsUrl: URL absolut terparse; body HTML / string acak -> null', () => {
    expect(parseMapsUrl('https://www.google.com/maps?q=Surabaya')).not.toBeNull();
    expect(parseMapsUrl('<html><body>noise ?q=1,2</body></html>')).toBeNull();
    expect(parseMapsUrl('')).toBeNull();
  });

  it('parseLatLngPair: "lat,lng" valid; teks/inkomplit -> null', () => {
    expect(parseLatLngPair('-7.28,112.74')).toEqual({ lat: -7.28, lng: 112.74 });
    expect(parseLatLngPair('Waterplace Residence')).toBeNull();
    expect(parseLatLngPair('-7.28')).toBeNull();
    expect(parseLatLngPair('0,0')).toBeNull();
    expect(parseLatLngPair('1,2')).toBeNull();
  });

  it('URL tanpa skema host-like tetap terparse (paritas perilaku lama)', () => {
    expect(extractCoordinatesFromUrlString('maps.google.com/?q=-7.34886,112.751677'))
      .toEqual({ lat: -7.34886, lng: 112.751677 });
  });

  it('body HTML berisi ?q=angka-bulat TIDAK menjadi koordinat palsu', () => {
    expect(extractCoordinatesFromUrlString('<html><body>noise ?q=1,2</body></html>')).toBeNull();
  });

  it('koordinat via ?daddr= kompleks (rute share) terparse URL API', () => {
    const coords = extractCoordinatesFromUrlString(
      'https://www.google.com/maps/dir/?api=1&daddr=-7.28,112.74&travelmode=driving'
    );
    expect(coords).toEqual({ lat: -7.28, lng: 112.74 });
  });

  it('koordinat via ?ll= dengan parameter ganda & anchor terparse', () => {
    const coords = extractCoordinatesFromUrlString(
      'https://maps.google.com/?hl=id&ll=-7.31,112.72&z=15#fragment-noise'
    );
    expect(coords).toEqual({ lat: -7.31, lng: 112.72 });
  });

  it('address query ?q=Waterplace+Residence ter-decode via URL API', () => {
    expect(
      extractAddressQueryFromUrlString(
        'https://www.google.com/maps/search/?api=1&q=Waterplace+Residence+Tower+A+Surabaya'
      )
    ).toBe('Waterplace Residence Tower A Surabaya');
  });

  it('address query q=koordinat -> null (ranah pola koordinat)', () => {
    expect(extractAddressQueryFromUrlString('https://maps.google.com/?q=-7.3488600,112.7516770')).toBeNull();
  });

  it('address query dari fragment HTML tak-terparse (fallback regex)', () => {
    expect(
      extractAddressQueryFromUrlString('<a href="/maps?q=Kenjeran+Park+Surabaya&z=14">x</a>')
    ).toBe('Kenjeran Park Surabaya');
  });

  it('encoding khusus %2C dan %20 pada q terparse benar', () => {
    expect(
      extractAddressQueryFromUrlString('https://www.google.com/maps/search/?api=1&q=Jl.%20Griya%20Kebraon%20Utama%2C%20Surabaya')
    ).toBe('Jl. Griya Kebraon Utama, Surabaya');
  });
});

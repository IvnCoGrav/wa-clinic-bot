import { describe, it, expect } from 'vitest';
import {
  extractGoogleMapsUrls,
  extractCoordinatesFromUrlString,
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

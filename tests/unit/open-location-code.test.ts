import { describe, it, expect } from 'vitest';
import {
  decodeFullPlusCode,
  decodePlusCode,
  extractPlusCode,
} from '../../src/utils/open-location-code';

describe('Open Location Code (Plus Code) Decoder', () => {
  it('ekstrak token Plus Code dari teks dan URL', () => {
    expect(extractPlusCode('https://maps.google.com/place/JP96+9WG+Asian+Conveksi')).toBe('JP96+9WG');
    expect(extractPlusCode('JP96+9WG Asian Conveksi, Bohar')).toBe('JP96+9WG');
    expect(extractPlusCode('Kode lokasi 6P4JJP96+9WG')).toBe('6P4JJP96+9WG');
    expect(extractPlusCode('Teks biasa tanpa kode')).toBeNull();
  });

  it('mendekode full code 6P4JJP96+9WG secara presisi', () => {
    const decoded = decodeFullPlusCode('6P4JJP96+9WG');
    expect(decoded).not.toBeNull();
    expect(decoded!.lat).toBeCloseTo(-7.3816117, 4);
    expect(decoded!.lng).toBeCloseTo(112.7122506, 4);
  });

  it('merekonstruksi short code JP96+9WG berbasis titik acuan Surabaya/Sidoarjo', () => {
    const ref = { lat: -7.34886, lng: 112.751677 }; // Klinik Kala
    const decoded = decodePlusCode('JP96+9WG', ref);
    expect(decoded).not.toBeNull();
    expect(decoded!.isShort).toBe(true);
    expect(decoded!.lat).toBeCloseTo(-7.3816117, 4);
    expect(decoded!.lng).toBeCloseTo(112.7122506, 4);
  });

  it('mengabaikan input tidak valid tanpa error', () => {
    expect(decodePlusCode('')).toBeNull();
    expect(decodePlusCode('jalan mawar')).toBeNull();
    expect(decodePlusCode('12345')).toBeNull();
  });
});

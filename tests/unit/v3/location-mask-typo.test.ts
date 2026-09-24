import { describe, it, expect } from 'vitest';
import { hasNewLocationEntity } from '../../../src/v3/tools/tool-masker';

// Fase D batch kecerdasan: kunci regresi deteksi entitas lokasi typo.
// Kasus dari KNOWN_ISSUES:11 ("bngurasih kena berapa ya kak" → mask salah).
// File terpisah dari tool-masker.test.ts (area refactor paralel aktif).
describe('M0 location mask typo-resilience (I-typo)', () => {
  it('"bngurasih kena berapa ya kak" terdeteksi sebagai entitas lokasi', () => {
    expect(hasNewLocationEntity('bngurasih kena berapa ya kak')).toBe(true);
  });

  it('"kenjern" (typo Kenjeran) terdeteksi', () => {
    expect(hasNewLocationEntity('ongkir ke kenjern berapa')).toBe(true);
  });

  it('"waru kepuh" (kecamatan+kelurahan) terdeteksi', () => {
    expect(hasNewLocationEntity('saya di waru kepuh')).toBe(true);
  });

  it('pesan tanpa lokasi tetap false (anti false-positive)', () => {
    expect(hasNewLocationEntity('berapa harga pijat bayi')).toBe(false);
    expect(hasNewLocationEntity('')).toBe(false);
    expect(hasNewLocationEntity(undefined)).toBe(false);
  });
});

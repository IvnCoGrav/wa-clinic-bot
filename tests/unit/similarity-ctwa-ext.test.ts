import { describe, it, expect } from 'vitest';
import {
  normalizeForMatch,
  tokenJaccard,
  combinedSimilarity,
  getStringSimilarity,
} from '../../src/utils/similarity';

describe('similarity utils — ekstensi CTWA (normalisasi & gabungan)', () => {
  it('normalizeForMatch: lowercase, buang tanda baca & emoji, collapse spasi', () => {
    expect(normalizeForMatch('  Halo, Bidan!! 🙏  Mau   TANYA  ')).toBe('halo bidan mau tanya');
  });

  it('normalizeForMatch: buang diakritik / aksen', () => {
    expect(normalizeForMatch('Café Déjà')).toBe('cafe deja');
  });

  it('normalizeForMatch: string kosong / non-huruf → string kosong', () => {
    expect(normalizeForMatch('')).toBe('');
    expect(normalizeForMatch('   !!! 😀😀 ')).toBe('');
  });

  it('tokenJaccard: identik → 1.0', () => {
    expect(tokenJaccard('halo mau tanya promo', 'halo mau tanya promo')).toBe(1.0);
  });

  it('tokenJaccard: salah satu kosong → 0.0', () => {
    expect(tokenJaccard('', 'halo')).toBe(0.0);
    expect(tokenJaccard('halo', '!!!')).toBe(0.0);
  });

  it('tokenJaccard: tahan urutan kata yang dibalik', () => {
    expect(tokenJaccard('promo baby spa surabaya', 'surabaya spa baby promo')).toBe(1.0);
  });

  it('combinedSimilarity: identik → 1.0', () => {
    expect(combinedSimilarity('Halo Bidan mau tanya', 'halo bidan mau tanya')).toBe(1.0);
  });

  it('combinedSimilarity: typo 1 karakter pada kalimat tetap tinggi (>0.8)', () => {
    const t = 'Halo Bidan, saya mau tanya promo Baby Spa Surabaya';
    expect(combinedSimilarity('halo bidan mau tanya promo baby spa surabay', t)).toBeGreaterThan(0.8);
  });

  it('combinedSimilarity: typo 1 kata tunggal tetap moderat (>0.4)', () => {
    expect(combinedSimilarity('surabaya', 'surabays')).toBeGreaterThan(0.4);
  });

  it('combinedSimilarity: string sangat berbeda tetap rendah', () => {
    expect(combinedSimilarity('halo mau tanya jadwal', 'promo baby spa surabaya')).toBeLessThan(0.4);
  });

  it('combinedSimilarity: simetris', () => {
    const ab = combinedSimilarity('halo min mau tny prmo baby spa sby', 'Halo Bidan, saya mau tanya promo Baby Spa Surabaya');
    const ba = combinedSimilarity('Halo Bidan, saya mau tanya promo Baby Spa Surabaya', 'halo min mau tny prmo baby spa sby');
    expect(Math.abs(ab - ba)).toBeLessThan(1e-9);
  });

  it('combinedSimilarity: kosong → 0.0', () => {
    expect(combinedSimilarity('', 'halo')).toBe(0.0);
  });

  it('getStringSimilarity tetap backward-compatible', () => {
    expect(getStringSimilarity('ab', 'ab')).toBe(1.0);
    expect(getStringSimilarity('', 'ab')).toBe(0.0);
  });
});

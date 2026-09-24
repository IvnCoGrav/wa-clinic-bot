import { describe, it, expect } from 'vitest';
import {
  isCorruptedKelurahan,
  stripTrailingDistrict,
  toTitleCase,
} from '../../src/utils/customer-name-healing';
import { COMMON_DISTRICTS } from '../../src/utils/name-sanitizer';

describe('customer-name-healing (pure helpers Fase 5)', () => {
  it('mendeteksi kelurahan tercemar (URL/maps/alamat/>40char)', () => {
    expect(isCorruptedKelurahan('Jl. Griya Kebraon (https://maps.google.com/...)')).toBe(true);
    expect(isCorruptedKelurahan('Blok A-12 RT 03 RW 07')).toBe(true);
    expect(isCorruptedKelurahan('x'.repeat(41))).toBe(true);
    expect(isCorruptedKelurahan(null)).toBe(false);
    expect(isCorruptedKelurahan('')).toBe(false);
  });

  it('TIDAK menandai kelurahan resmi sebagai tercemar (anti-false-positive)', () => {
    for (const legit of ['Manukan Kulon', 'Bulakbanteng', 'Gedangan', 'Mulyorejo', 'Kutisari', 'Waru', 'Sukomanunggal']) {
      expect(isCorruptedKelurahan(legit)).toBe(false);
    }
  });

  it('mengelupas suffix wilayah multi-kata terpanjang dulu', () => {
    const r = stripTrailingDistrict('Bunda Retno Gedangan', COMMON_DISTRICTS);
    expect(r.cleanName).toBe('Bunda Retno');
    expect(r.district?.toLowerCase()).toBe('gedangan');
  });

  it('TIDAK mengelupas nama orang murni (anti-mutilasi)', () => {
    for (const legit of ['Bunda Sari', 'Desy', 'Bunda Maya', 'Rina', 'Pelanggan 8247']) {
      expect(stripTrailingDistrict(legit, COMMON_DISTRICTS).district).toBeNull();
      expect(stripTrailingDistrict(legit, COMMON_DISTRICTS).cleanName).toBe(legit);
    }
  });

  it('toTitleCase merapikan kapitalisasi', () => {
    expect(toTitleCase('gedangan')).toBe('Gedangan');
    expect(toTitleCase('MANUKAN KULON')).toBe('Manukan Kulon');
  });
});

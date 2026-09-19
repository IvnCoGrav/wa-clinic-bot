import { describe, it, expect } from 'vitest';
import {
  normalizeWilayahText,
  isValidAreaName,
} from '../../src/utils/wilayah-normalizer';

/**
 * Adversarial tests untuk sanitasi teks wilayah.
 * Data nyata produksi memuat polusi seperti `kecamatan = "Kota :"` dan
 * `kota = "No. Hp : 087852674363"` — keduanya HARUS ditolak agar tidak menjadi
 * sentroid palsu di peta.
 */
describe('wilayah-normalizer (adversarial)', () => {
  describe('normalizeWilayahText', () => {
    it('membuang prefix label teknis', () => {
      expect(normalizeWilayahText('Kota : Surabaya')).toBe('Surabaya');
      expect(normalizeWilayahText('No. Hp : 087852674363')).toBe('087852674363');
      expect(normalizeWilayahText('Kecamatan: Wonokromo')).toBe('Wonokromo');
      expect(normalizeWilayahText('Alamat : Jl. Raya')).toBe('Jl. Raya');
    });

    it('trim whitespace & pemisah tepi', () => {
      expect(normalizeWilayahText('  Surabaya  ')).toBe('Surabaya');
      expect(normalizeWilayahText(': Sidoarjo')).toBe('Sidoarjo');
      expect(normalizeWilayahText('Gresik,')).toBe('Gresik');
    });

    it('kosong / null → string kosong', () => {
      expect(normalizeWilayahText(null)).toBe('');
      expect(normalizeWilayahText(undefined)).toBe('');
      expect(normalizeWilayahText('   ')).toBe('');
    });
  });

  describe('isValidAreaName', () => {
    it('menerima nama wilayah wajar', () => {
      expect(isValidAreaName('Wonokromo')).toBe(true);
      expect(isValidAreaName('Kota Surabaya')).toBe(true);
      expect(isValidAreaName('Kepuh Permai')).toBe(true);
      expect(isValidAreaName('Kota : Sidoarjo')).toBe(true);
    });

    it('menolak data kotor', () => {
      expect(isValidAreaName('Kota :')).toBe(false);
      expect(isValidAreaName('No. Hp : 087852674363')).toBe(false);
      expect(isValidAreaName('12345')).toBe(false);
      expect(isValidAreaName('')).toBe(false);
      expect(isValidAreaName(null)).toBe(false);
      expect(isValidAreaName('ab')).toBe(false);
    });
  });
});

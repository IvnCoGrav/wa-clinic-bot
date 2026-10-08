import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGazetteerCoordinates,
  isCrossCityDuplicate,
  isCityHomonymKecamatan,
  __resetGazetteerCache,
} from '../../src/utils/gazetteer';

describe('Gazetteer Cross-City Homonym & Anti-Hijack Resolution (Fase 1)', () => {
  beforeEach(() => {
    __resetGazetteerCache();
  });

  describe('isCrossCityDuplicate helper (data-driven)', () => {
    it('mengidentifikasi 14 nama duplikat lintas kota secara data-driven tanpa hardcode', () => {
      // Sby - Sda duplikat
      expect(isCrossCityDuplicate('wonocolo')).toBe(true);
      expect(isCrossCityDuplicate('krembangan')).toBe(true);
      expect(isCrossCityDuplicate('semampir')).toBe(true);
      expect(isCrossCityDuplicate('jambangan')).toBe(true);
      expect(isCrossCityDuplicate('gading')).toBe(true);
      expect(isCrossCityDuplicate('kandangan')).toBe(true);
      expect(isCrossCityDuplicate('kebonsari')).toBe(true);
      expect(isCrossCityDuplicate('ploso')).toBe(true);
      expect(isCrossCityDuplicate('sidodadi')).toBe(true);
      expect(isCrossCityDuplicate('sumberejo')).toBe(true);
      expect(isCrossCityDuplicate('tanjungsari')).toBe(true);

      // Sda - Gresik duplikat
      expect(isCrossCityDuplicate('kepatihan')).toBe(true);
      expect(isCrossCityDuplicate('pranti')).toBe(true);
      expect(isCrossCityDuplicate('sumput')).toBe(true);

      // Non-duplikat (hanya di 1 kota)
      expect(isCrossCityDuplicate('waru')).toBe(false);
      expect(isCrossCityDuplicate('rungkut')).toBe(false);
      expect(isCrossCityDuplicate('sedati')).toBe(false);
      expect(isCrossCityDuplicate('buduran')).toBe(false);
      expect(isCrossCityDuplicate('sukodono')).toBe(false);
    });
  });

  describe('TC-01, TC-02, TC-03: Resolusi Wonocolo', () => {
    it('TC-01: "Wonocolo, Surabaya" → Kec. Wonocolo Surabaya', () => {
      const hit = getGazetteerCoordinates('Wonocolo, Surabaya');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Wonocolo');
      expect(hit!.matchedLevel).toBe('kecamatan');
      expect(hit!.lat).toBeCloseTo(-7.3368916, 4);
      expect(hit!.lng).toBeCloseTo(112.7378452, 4);
    });

    it('TC-02: "Wonocolo" polos → Kec. Wonocolo Surabaya (bukan Taman Sidoarjo)', () => {
      const hit = getGazetteerCoordinates('Wonocolo');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Wonocolo');
      expect(hit!.matchedLevel).toBe('kecamatan');
      expect(hit!.lat).toBeCloseTo(-7.3368916, 4);
      expect(hit!.lng).toBeCloseTo(112.7378452, 4);
    });

    it('TC-03: "Wonocolo, Taman, Sidoarjo" → Desa Wonocolo Taman Sidoarjo (tidak dirampok balik)', () => {
      const hit = getGazetteerCoordinates('Wonocolo, Taman, Sidoarjo');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
      expect(hit!.kecamatan).toBe('Taman');
      expect(hit!.kelurahan).toBe('Wonocolo');
      expect(hit!.matchedLevel).toBe('kelurahan');
      expect(hit!.lat).toBeCloseTo(-7.3462035, 4);
      expect(hit!.lng).toBeCloseTo(112.6958457, 4);
    });

    it('TC-03b: "Wonocolo, Taman" (tanpa kata Sidoarjo) → Desa Wonocolo Taman Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Wonocolo, Taman');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
      expect(hit!.kecamatan).toBe('Taman');
      expect(hit!.kelurahan).toBe('Wonocolo');
      expect(hit!.matchedLevel).toBe('kelurahan');
    });
  });

  describe('TC-04: Resolusi Krembangan & Semampir', () => {
    it('"Krembangan" polos → Kec. Krembangan Surabaya, bukan Taman Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Krembangan');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Krembangan');
      expect(hit!.matchedLevel).toBe('kecamatan');
    });

    it('"Krembangan, Taman" → Desa Krembangan Taman Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Krembangan, Taman');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
      expect(hit!.kecamatan).toBe('Taman');
      expect(hit!.kelurahan).toBe('Krembangan');
      expect(hit!.matchedLevel).toBe('kelurahan');
    });

    it('"Semampir" polos → Kec. Semampir Surabaya, bukan Sedati Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Semampir');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Semampir');
      expect(hit!.matchedLevel).toBe('kecamatan');
    });

    it('"Semampir, Sedati" → Desa Semampir Sedati Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Semampir, Sedati');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
      expect(hit!.kecamatan).toBe('Sedati');
      expect(hit!.kelurahan).toBe('Semampir');
      expect(hit!.matchedLevel).toBe('kelurahan');
    });
  });

  describe('TC-05: Non-regresi wilayah non-duplikat & alias sby/sda', () => {
    it('"Waru" polos → Waru Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Waru');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
      expect(hit!.kecamatan).toBe('Waru');
    });

    it('"Rungkut" polos → Rungkut Surabaya', () => {
      const hit = getGazetteerCoordinates('Rungkut');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Rungkut');
    });

    it('"Sedati" polos → Sedati Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Sedati');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
      expect(hit!.kecamatan).toBe('Sedati');
    });

    it('"Jambangan" polos → Jambangan Surabaya', () => {
      const hit = getGazetteerCoordinates('Jambangan');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Jambangan');
    });

    it('"Wonocolo sby" → Kec. Wonocolo Surabaya', () => {
      const hit = getGazetteerCoordinates('Wonocolo sby');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Wonocolo');
    });

    it('"Wonocolo sda" → Desa Wonocolo Taman Sidoarjo', () => {
      const hit = getGazetteerCoordinates('Wonocolo sda');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
      expect(hit!.kecamatan).toBe('Taman');
    });
  });

  describe('TC-06: Typo toleransi nama duplikat', () => {
    it('Typo "Wonocollo" polos → tetap Kec. Wonocolo Surabaya', () => {
      const hit = getGazetteerCoordinates('Wonocollo');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Wonocolo');
    });

    it('Typo "Krembangn" polos → tetap Kec. Krembangan Surabaya', () => {
      const hit = getGazetteerCoordinates('Krembangn');
      expect(hit).not.toBeNull();
      expect(hit!.kota).toBe('Kota Surabaya');
      expect(hit!.kecamatan).toBe('Krembangan');
    });
  });
});

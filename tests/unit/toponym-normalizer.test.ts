import { describe, it, expect } from 'vitest';
import {
  normalizeToponymAbbreviations,
  extractCityScope,
  getCanonicalCities,
} from '../../src/utils/toponym-normalizer';

const KNOWN_CITIES = ['Kabupaten Sidoarjo', 'Kota Surabaya', 'Kabupaten Gresik'];

describe('Toponym Normalizer (linguistik, bukan data bisnis)', () => {
  it('normalizeToponymAbbreviations: ekspansi singkatan baku toponimi', () => {
    expect(normalizeToponymAbbreviations('Kupang gn barat gg 3')).toBe('kupang gunung barat gang 3');
    expect(normalizeToponymAbbreviations('jl kyai husein no 57')).toBe('jalan kyai husein no 57');
    expect(normalizeToponymAbbreviations('kec waru ds bungah')).toBe('kecamatan waru desa bungah');
    expect(normalizeToponymAbbreviations('GN. Kupang Jl. Baru')).toBe('gunung kupang jalan baru');
    // Tidak menyentuh kata utuh / angka / non-singkatan
    expect(normalizeToponymAbbreviations('Kureksari Waru Sidoarjo')).toBe('kureksari waru sidoarjo');
    expect(normalizeToponymAbbreviations('no 1C GG 3')).toBe('no 1c gang 3');
  });

  it('getCanonicalCities: turunkan dari dataset, tanpa literal', () => {
    const cities = getCanonicalCities([
      { Kabupaten_Kota: 'Kota Surabaya' },
      { Kabupaten_Kota: ' Kabupaten Sidoarjo ' },
      { Kabupaten_Kota: 'Kota Surabaya' },
      { Kabupaten_Kota: '' },
    ]);
    expect(cities).toEqual(['Kabupaten Sidoarjo', 'Kota Surabaya']);
  });

  it('extractCityScope: deteksi kanonis dari sebutan kota', () => {
    expect(extractCityScope('Surabaya, Kupang gn barat', KNOWN_CITIES)).toBe('Kota Surabaya');
    expect(extractCityScope('Kureksari Waru Sidoarjo', KNOWN_CITIES)).toBe('Kabupaten Sidoarjo');
    expect(extractCityScope('kebonsari candi', KNOWN_CITIES)).toBeNull();
    expect(extractCityScope('Klampis jaya', KNOWN_CITIES)).toBeNull();
  });

  it('extractCityScope: alias sby/sda', () => {
    expect(extractCityScope('kupang gunung barat sby', KNOWN_CITIES)).toBe('Kota Surabaya');
    expect(extractCityScope('pabean sda', KNOWN_CITIES)).toBe('Kabupaten Sidoarjo');
  });

  it('extractCityScope: multi-kota, last-mention menang', () => {
    expect(extractCityScope('dari surabaya ke kupang jabon sidoarjo', KNOWN_CITIES)).toBe('Kabupaten Sidoarjo');
    expect(extractCityScope('maybe surabaya, gresik nanti', KNOWN_CITIES)).toBe('Kabupaten Gresik');
  });

  it('extractCityScope: tidak menebak kota bila tidak ada di canonical', () => {
    // 'malang' tidak ada di dataset teritori -> bukan scope
    expect(extractCityScope('malang', KNOWN_CITIES)).toBeNull();
  });
});
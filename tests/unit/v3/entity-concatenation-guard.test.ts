import { describe, it, expect } from 'vitest';
import { stripStaleRegionPrefix } from '../../../src/v3/tools/entity-concatenation-guard';

/**
 * RC-4 (sesi 535222): Router Call 1 menggabungkan entitas kecamatan LAMA
 * (dari sesi) dengan kelurahan BARU yang disebut customer menjadi satu string
 * artifisial ("Buduran Bungurasih"). Guard deterministik ini membuang prefiks
 * wilayah basi sehingga hanya entitas baru yang diteruskan ke geocoding.
 *
 * Data-driven: daftar kecamatan diambil dari gazetteer, bukan hafalan kalimat.
 */
describe('stripStaleRegionPrefix — guard anti-konkatenasi entitas (RC-4)', () => {
  it('buang kecamatan basi di depan bila sesi sudah mengenalnya: "Buduran Bungurasih" → "Bungurasih"', () => {
    const session = { kecamatan: 'Buduran', kelurahan: null as string | null };
    expect(stripStaleRegionPrefix('Buduran Bungurasih', session)).toBe('Bungurasih');
  });

  it('tidak mengubah entitas tunggal yang valid: "Bungurasih" → "Bungurasih"', () => {
    const session = { kecamatan: 'Buduran', kelurahan: null as string | null };
    expect(stripStaleRegionPrefix('Bungurasih', session)).toBe('Bungurasih');
  });

  it('tidak mengubah bila wilayah basi TIDAK ada di string: "Waru Kepuh Kiriman" tetap utuh', () => {
    const session = { kecamatan: 'Buduran', kelurahan: null as string | null };
    expect(stripStaleRegionPrefix('Waru Kepuh Kiriman', session)).toBe('Waru Kepuh Kiriman');
  });

  it('tanpa sesi (lokasi belum diketahui) → string apa adanya', () => {
    expect(stripStaleRegionPrefix('Buduran Bungurasih', null)).toBe('Buduran Bungurasih');
  });

  it('kecamatan basi jelas berbeda dari entitas baru (bukan prefiks kelurahan baru)', () => {
    const session = { kecamatan: 'Rungkut', kelurahan: null as string | null };
    expect(stripStaleRegionPrefix('Rungkut Tenggilis Mejoyo', session)).toBe('Tenggilis Mejoyo');
  });

  it('anti-merusak: bila sisa string kosong setelah strip, kembalikan aslinya', () => {
    const session = { kecamatan: 'Buduran', kelurahan: null as string | null };
    expect(stripStaleRegionPrefix('Buduran', session)).toBe('Buduran');
  });
});

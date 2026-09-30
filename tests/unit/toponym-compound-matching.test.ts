import { describe, it, expect } from 'vitest';
import { getGazetteerCoordinates } from '../../src/utils/gazetteer';

/**
 * Toponimi majemuk: nama kelurahan dataset ditulis 1 kata (Tambakoso, Pepelegi,
 * Sawotratap), sedangkan customer mengetik dengan spasi (tambak oso) atau varian
 * potong (tambak os). Pencocokan word-boundary eksak gagal -> sistem jatuh ke
 * fallback kecamatan dan membajak lokasi (Wedoro/Suko). Test ini mengunci
 * perilaku normalizer majemuk data-driven.
 */
describe('Toponimi majemuk — spasi vs tanpa spasi (data-driven)', () => {
  it('"tambak oso" / "tambakoso" -> kelurahan Tambakoso (Waru), bukan sentroid kecamatan', () => {
    for (const q of ['tambak oso waru', 'tambakoso', 'di tambak oso sidoarjo']) {
      const r = getGazetteerCoordinates(q);
      expect(r, q).not.toBeNull();
      expect(r!.kelurahan, q).toBe('Tambakoso');
      expect(r!.kecamatan, q).toBe('Waru');
      expect(r!.matchedLevel, q).toBe('kelurahan');
    }
  });

  it('"pepe legi" / "pepelegi" -> kelurahan Pepelegi (Waru)', () => {
    for (const q of ['pepe legi waru', 'pepelegi', 'rumah di pepe legi']) {
      const r = getGazetteerCoordinates(q);
      expect(r, q).not.toBeNull();
      expect(r!.kelurahan, q).toBe('Pepelegi');
      expect(r!.matchedLevel, q).toBe('kelurahan');
    }
  });

  it('"sawo tratap" / "sawotratap" -> kelurahan Sawotratap (Gedangan)', () => {
    for (const q of ['sawo tratap gedangan', 'sawotratap']) {
      const r = getGazetteerCoordinates(q);
      expect(r, q).not.toBeNull();
      expect(r!.kelurahan, q).toBe('Sawotratap');
      expect(r!.matchedLevel, q).toBe('kelurahan');
    }
  });

  it('"tambak os" (varian potong) dengan gate kecamatan Waru -> Tambakoso', () => {
    const r = getGazetteerCoordinates('tambak os waru');
    expect(r).not.toBeNull();
    expect(r!.kelurahan).toBe('Tambakoso');
  });

  it('NEGATIF: toponimi tetangga tidak boleh tertelan (tambak sawah ≠ tambakoso)', () => {
    const sawah = getGazetteerCoordinates('tambak sawah waru');
    expect(sawah).not.toBeNull();
    expect(sawah!.kelurahan).toBe('Tambaksawah');

    const sumur = getGazetteerCoordinates('tambak sumur waru');
    expect(sumur).not.toBeNull();
    expect(sumur!.kelurahan).toBe('Tambaksumur');
  });
});

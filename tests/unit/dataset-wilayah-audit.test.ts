import { describe, it, expect } from 'vitest';
import { getGazetteerCoordinates } from '../../src/utils/gazetteer';

/**
 * Audit dataset wilayah (2026-09-30): 13 entri "salah kecamatan" dibandingkan
 * sumber resmi Kemendagri (Kepmendagri 300.2.2-2138/2025) + Wikipedia (Permendagri
 * 137/2017). Sebelas di antaranya adalah baris DUPLIKAT (koordinat sama dengan
 * entri benar di kecamatan lain) → dihapus. Satu (Turirejo) kecamatannya salah →
 * diperbaiki. Test ini mengunci agar tidak regresi.
 */
describe('Audit dataset wilayah — koreksi kecamatan (fondasional)', () => {
  it('desa yang tadinya salah kecamatan memetakan ke kecamatan yang BENAR', () => {
    const cases: Array<[string, string]> = [
      ['karangbong', 'Gedangan'],
      ['mergosari', 'Tarik'],
      ['wedi', 'Gedangan'],
      ['pangkemiri', 'Tulangan'],
      ['kedungbanteng', 'Tanggulangin'],
      ['pagerngumbuk', 'Wonoayu'],
      ['mulyodadi', 'Wonoayu'],
      ['simoangin-angin', 'Wonoayu'],
      ['turirejo', 'Kedamean'],
    ];
    for (const [q, kec] of cases) {
      const r = getGazetteerCoordinates(q);
      expect(r, q).not.toBeNull();
      expect(r!.kecamatan, q).toBe(kec);
    }
  });

  it('tidak ada lagi baris duplikat kecamatan salah (Taman/Candi/Buduran dll)', () => {
    // Karangbong hanya boleh ada di Gedangan, bukan Taman
    const karangbongTaman = getGazetteerCoordinates('karangbong taman');
    expect(karangbongTaman?.kecamatan).not.toBe('Taman');
    // Wedi hanya Gedangan
    const wediCandi = getGazetteerCoordinates('wedi candi');
    expect(wediCandi?.kecamatan).not.toBe('Candi');
  });

  it('homonim sadar-kecamatan: kecamatan yang disebut menang atas koridor arteri', () => {
    // Tropodo ada di Waru DAN Krian. Koridor arteri default Waru, tapi bila
    // customer menyebut "krian", harus Krian.
    expect(getGazetteerCoordinates('tropodo krian')!.kecamatan).toBe('Krian');
    expect(getGazetteerCoordinates('tropodo waru')!.kecamatan).toBe('Waru');
    // Desa homonim lain lintas kecamatan
    expect(getGazetteerCoordinates('janti tarik')!.kecamatan).toBe('Tarik');
    expect(getGazetteerCoordinates('janti tulangan')!.kecamatan).toBe('Tulangan');
    expect(getGazetteerCoordinates('janti waru')!.kecamatan).toBe('Waru');
    expect(getGazetteerCoordinates('kedungrejo jabon')!.kecamatan).toBe('Jabon');
    expect(getGazetteerCoordinates('kedungrejo waru')!.kecamatan).toBe('Waru');
  });
});

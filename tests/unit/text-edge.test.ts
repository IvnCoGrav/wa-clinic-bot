import { describe, it, expect } from 'vitest';
import { stripNonAlnumEdges } from '../../src/utils/text-edge';

/**
 * Karakterisasi kanonis `stripNonAlnumEdges`.
 *
 * Tiga pemanggil lama (pronoun-validator, persona intent extractor,
 * lead-greeting detector) memakai salinan fungsi ini untuk mencocokkan token
 * kata utuh. Perubahan perilaku akan mengubah deteksi pelanggaran kata ganti,
 * sinyal harga, dan deteksi alamat.
 */
describe('utils/text-edge — stripNonAlnumEdges', () => {
  it('membuang tanda baca di kedua tepi', () => {
    expect(stripNonAlnumEdges('**halo**')).toBe('halo');
    expect(stripNonAlnumEdges('...apa?!')).toBe('apa');
    expect(stripNonAlnumEdges('"kata,"')).toBe('kata');
  });

  it('mempertahankan digit dan huruf kecil di tepi', () => {
    expect(stripNonAlnumEdges('123!')).toBe('123');
    expect(stripNonAlnumEdges('!12abc34?')).toBe('12abc34');
    expect(stripNonAlnumEdges('jl.')).toBe('jl');
  });

  it('mengembalikan string kosong bila seluruh isi non-alfanumerik', () => {
    expect(stripNonAlnumEdges('!!!')).toBe('');
    expect(stripNonAlnumEdges('...')).toBe('');
    expect(stripNonAlnumEdges('')).toBe('');
  });

  it('mendokumentasikan perilaku lama: huruf besar di tepi ikut terpotong', () => {
    // Pemanggil SELALU men-lowercase lebih dulu (lihat tiga pemanggil asli).
    // Karena huruf besar bukan alfanumerik, 'Halo' kehilangan 'H' -> 'alo'.
    // Ini alasan modul ini bukan pengganti umum untuk trim/cleanup teks.
    expect(stripNonAlnumEdges('Halo')).toBe('alo');
    expect(stripNonAlnumEdges('  kata  ')).toBe('kata');
    expect(stripNonAlnumEdges('halo, Dunia')).toBe('halo, Dunia');
  });

  it('tidak menyentuh karakter internal', () => {
    expect(stripNonAlnumEdges('kata-kata')).toBe('kata-kata');
    expect(stripNonAlnumEdges('rp.50rb')).toBe('rp.50rb');
    expect(stripNonAlnumEdges('a@b')).toBe('a@b');
  });

  it('idempoten: menerapkan dua kali menghasilkan nilai sama', () => {
    const samples = ['**halo**', 'jl.', '!!!', 'kata-kata', '', '123!'];
    for (const s of samples) {
      const once = stripNonAlnumEdges(s);
      expect(stripNonAlnumEdges(once)).toBe(once);
    }
  });

  it('token hasil split spasi cocok dengan pencocokan kata utuh pemanggil', () => {
    const text = 'beritahu saya, dong!';
    const tokens = text.toLowerCase().split(' ').map(stripNonAlnumEdges).filter((t) => t.length > 0);
    expect(tokens).toEqual(['beritahu', 'saya', 'dong']);
  });
});

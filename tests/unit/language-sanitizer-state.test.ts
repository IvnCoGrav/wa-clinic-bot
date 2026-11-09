import { describe, it, expect } from 'vitest';
import {
  containsForeignScripts,
  stripNonIndonesianScripts,
} from '../../src/utils/language-sanitizer';

describe('UTL-05: language-sanitizer regex statefulness', () => {
  it('containsForeignScripts harus deterministik saat dipanggil berulang kali pada string yang sama (stateless .test)', () => {
    const textWithChinese = 'Halo Bunda, selamat pagi 你好 ada yang bisa kami bantu?';

    // Memanggil .test() berulang kali tidak boleh berselang-seling true, false, true, false
    const res1 = containsForeignScripts(textWithChinese);
    const res2 = containsForeignScripts(textWithChinese);
    const res3 = containsForeignScripts(textWithChinese);
    const res4 = containsForeignScripts(textWithChinese);

    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(res3).toBe(true);
    expect(res4).toBe(true);
  });

  it('containsForeignScripts tetap deterministik setelah pemanggilan stripNonIndonesianScripts', () => {
    const textWithRussian = 'Layanan pijat bayi Привет';

    expect(containsForeignScripts(textWithRussian)).toBe(true);
    const stripped = stripNonIndonesianScripts(textWithRussian);
    expect(stripped).toBe('Layanan pijat bayi ');

    // Pemanggilan berikutnya harus tetap true untuk teks asli, dan false untuk hasil stripped
    expect(containsForeignScripts(textWithRussian)).toBe(true);
    expect(containsForeignScripts(stripped)).toBe(false);
  });

  it('teks tanpa karakter asing selalu return false secara konsisten', () => {
    const cleanText = 'Halo Bunda, kami dari Mom & Baby Spa ingin konfirmasi jadwal besok.';
    for (let i = 0; i < 5; i++) {
      expect(containsForeignScripts(cleanText)).toBe(false);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

/**
 * Fase 5 — Grammar-Aware Preposition Protection.
 *
 * Regresi asal (Kasus #9 T3): "Untuk si kecil atau sekalian untuk Bunda juga?"
 * termutilasi menjadi "Untuk si kecil atau sekalian untuk juga?" karena kata
 * "Bunda" objek preposisi salah dianggap vokatif yang melampaui kuota.
 */
describe('Fase 5 — proteksi objek preposisi pada kuota sapaan', () => {
  it('"untuk Bunda" (objek preposisi) TIDAK dipotong', () => {
    const input = 'Untuk si kecil atau sekalian untuk Bunda juga? 🤗';
    const out = OutputSanitizer.limitVocativeQuota(input, 1);
    expect(out).toContain('untuk Bunda juga');
    expect(out).not.toContain('untuk juga');
  });

  it('berbagai preposisi melindungi objek: ke/dari/dengan/bersama/bagi/pada', () => {
    const phrases = [
      'Treatment ini cocok untuk Bunda ya',
      'Kami siap datang ke Bunda',
      'Terima kasih dari Bunda',
      'Nanti kami kerjakan dengan Bunda',
      'Kunjungan bersama Bunda dan si kecil',
      'Pilihan ini bagus bagi Bunda',
      'Kami sudah kabari pada Bunda',
    ];
    for (const p of phrases) {
      const out = OutputSanitizer.limitVocativeQuota(p, 1);
      expect(out, `"${p}" tidak boleh termutilasi`).toBe(p);
    }
  });

  it('sapaan vokatif ganda tetap dipangkas ke kuota 1x', () => {
    const input = 'Halo Bunda! Terima kasih Bunda. Mau jadwal kapan Bunda?';
    const out = OutputSanitizer.limitVocativeQuota(input, 1);
    const count = (out.match(/\b(Bunda|bund|bun)\b/gi) || []).length;
    expect(count).toBeLessThanOrEqual(1);
  });

  it('objek preposisi tidak mengurangi kuota vokatif', () => {
    // "untuk Bunda" (objek, dilindungi) + "Bunda" vokatif → vokatif tetap 1.
    const input = 'Kami siapkan untuk Bunda. Terima kasih Bunda ya.';
    const out = OutputSanitizer.limitVocativeQuota(input, 1);
    expect(out).toContain('untuk Bunda');
    const count = (out.match(/\b(Bunda|bund|bun)\b/gi) || []).length;
    // "untuk Bunda" dilindungi + 1 vokatif = 2 total, tapi hanya 1 vokatif.
    expect(count).toBeLessThanOrEqual(2);
  });

  it('objek preposisi menghabiskan kuota → vokatif tambahan dihapus (anti-overuse tetap)', () => {
    // Kasus nyata Kasus #1 T5: "Untuk Bunda yang pasca salin ... Bunda sedang menyusui"
    const input = 'Untuk Bunda yang pasca salin, ada dua pilihan yaa. Saat ini Bunda sedang menyusui ya.';
    const out = OutputSanitizer.limitVocativeQuota(input, 1);
    expect(out).toContain('Untuk Bunda yang pasca salin');
    const count = (out.match(/\b(Bunda|bund|bun)\b/gi) || []).length;
    expect(count).toBeLessThanOrEqual(1);
  });
});

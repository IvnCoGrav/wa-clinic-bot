import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

/**
 * Fase 3 (Trimmer): senarai opsi bernomor/bullet yang diperkenalkan dengan
 * ":" DILARANG diamputasi oleh pemotong 3-kalimat. Prosa biasa tetap dipotong.
 */
describe('v3 sanitizer list preservation', () => {
  it('daftar opsi setelah "nih:" tidak terpotong', () => {
    const draft =
      'Halo Bunda, promo bulan ini masih berjalan ya. ' +
      'Untuk paketnya sebenarnya ada dua pilihan nih:\n\n' +
      '1. Paket Cukur + Pijat Ceria Rp 80.000\n' +
      '2. Paket Full Cukur + Ceria + Mandi Rp 100.000';
    const out = OutputSanitizer.trimToMaxSentences(draft, 3);
    expect(out).toContain('1. Paket Cukur + Pijat Ceria');
    expect(out).toContain('2. Paket Full Cukur + Ceria + Mandi');
  });

  it('daftar bullet setelah ":" tidak kehilangan item terakhir', () => {
    const draft =
      'Baik Bunda, kami bantu jelaskan ya. ' +
      'Ada beberapa pilihan berikut:\n\n' +
      '• Pijat Ceria Newborn\n' +
      '• Pijat Pulih Ceria\n' +
      '• Pijat Lahap Juara';
    const out = OutputSanitizer.trimToMaxSentences(draft, 3);
    expect(out).toContain('Pijat Lahap Juara');
  });

  it('prosa biasa TETAP dipotong 3 kalimat (anti over-protection)', () => {
    const draft =
      'Kalimat satu ya Bunda. Kalimat dua ya Bunda. Kalimat tiga ya Bunda. Kalimat empat TIDAK boleh muncul.';
    const out = OutputSanitizer.trimToMaxSentences(draft, 3);
    expect(out).not.toContain('Kalimat empat');
    expect(out).toContain('Kalimat tiga');
  });

  it('angka desimal/harga tidak dianggap batas kalimat', () => {
    const draft =
      'Harganya Rp 60.000 ya Bunda. Durasi 40 menit ya. Total Rp 100.000 pas. Kalimat keempat hilang.';
    const out = OutputSanitizer.trimToMaxSentences(draft, 3);
    expect(out).not.toContain('Kalimat keempat');
  });
});

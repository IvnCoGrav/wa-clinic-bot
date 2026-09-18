import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

/**
 * Audit 993955 Turn 9: chat lanjutan mengulang sapaan vokatif "Bunda" hingga 3x
 * dalam satu pesan pendek. Kuota sapaan (maks 1x di chat lanjutan) WAJIB
 * ditegakkan deterministik oleh sanitizer, bukan diserahkan ke LLM.
 * Prinsip: pertahankan kemunculan PERTAMA; pengulangan di ujung kalimat
 * dibersihkan rapi tanpa merusak tanda baca/emoji.
 */
describe('Sanitizer — kuota sapaan vokatif chat lanjutan (sesi 993955)', () => {
  it('chat lanjutan dengan 3x "Bunda" → tersisa maksimal 1', () => {
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(
      'Baik Bunda, kami catat ya Bunda, nanti kami infokan Bunda',
      true
    );
    const count = (out.match(/\bBunda\b/gi) || []).length;
    expect(count).toBeLessThanOrEqual(1);
    expect(out).toMatch(/Baik Bunda/);
    expect(out).toContain('nanti kami infokan');
  });

  it('emoji di akhir tetap utuh saat pengulangan vokatif dihapus', () => {
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(
      'Baik Bunda, jadwalnya kami cekkan dulu ya Bunda 😊',
      true
    );
    const count = (out.match(/\bBunda\b/gi) || []).length;
    expect(count).toBeLessThanOrEqual(1);
    expect(out).toContain('😊');
    expect(out).toContain('Baik Bunda');
  });

  it('sapaan tunggal TIDAK diubah', () => {
    const single = 'Baik Bunda, jadwalnya kami cekkan dulu ya';
    expect(OutputSanitizer.sanitizeFollowUpGreetingRepetition(single, true)).toBe(single);
  });

  it('Turn-0 (isFollowUp=false) TIDAK dipangkas', () => {
    const turn0 = 'Halo Bunda! Bunda, terima kasih ya Bunda';
    expect(OutputSanitizer.sanitizeFollowUpGreetingRepetition(turn0, false)).toBe(turn0);
  });

  it('vokatif "Bapak" juga dibatasi 1x', () => {
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(
      'Baik Bapak, kami catat ya Bapak',
      true
    );
    const count = (out.match(/\bBapak\b/gi) || []).length;
    expect(count).toBeLessThanOrEqual(1);
  });

  it('vokatif varian "bund"/"bun" ikut dihitung (kasus "Bunda ... bund")', () => {
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(
      'Oh jadi tidak perlu mandi dulu ya Bunda 😊 Justru mandinya disarankan setelah pijat. Untuk waktunya bebas ya bund.',
      true
    );
    const count = (out.match(/\b(Bunda|bund|bun)\b/gi) || []).length;
    expect(count).toBeLessThanOrEqual(1);
  });

  // 391501 Fase 1 — proteksi subjek & koma menggantung
  it('proteksi subjek: "Bunda hanya perlu..." tidak dipotong', () => {
    const input = 'Tenang saja ya Bunda, seluruh peralatan sudah siap. Bunda hanya perlu menyiapkan tempat yang nyaman.';
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(input, true);
    // Bunda kedua adalah subjek tata bahasa → dipertahankan
    expect(out).toContain('Bunda hanya perlu menyiapkan');
    // Koma menggantung tidak ada
    expect(out).not.toContain(' ,');
    expect(out).not.toMatch(/,\s*[!?.]/);
  });

  it('koma menggantung ", Bunda!" dibersihkan menjadi "!"', () => {
    const input = 'Kalau ada yang ingin ditanyakan lagi, jangan ragu untuk bertanya ya, Bunda! 🤗';
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(
      `Halo Bunda! ${input}`,
      true
    );
    // Tidak ada koma menggantung sebelum tanda seru
    expect(out).not.toContain('ya,!'); 
    expect(out).not.toContain('ya,!');
    expect(out).toMatch(/ya! 🤗/);
    // Subjek tidak relevan di sini, tapi koma harus bersih
    expect(out).not.toMatch(/,\s*[!?.]/);
  });
});

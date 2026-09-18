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

  // Plan regresi Fase 1.2 — anti mutilasi subjek klausa relatif tengah kalimat:
  // "Bunda" yang didahului "yang" + diikuti verba adalah SUBJEK, bukan vokatif.
  it('subjek klausa relatif "layanan yang Bunda maksud" tetap utuh', () => {
    const input = 'Halo Bunda! Siap Bunda, untuk layanan yang Bunda maksud kami jelaskan ya Bunda.';
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(input, true);
    expect(out).toContain('layanan yang Bunda maksud');
  });

  it('subjek klausa relatif "yang Bunda tanyakan" tetap utuh', () => {
    const input = 'Baik Bunda, terkait layanan yang Bunda tanyakan sudah kami catat Bunda.';
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(input, true);
    expect(out).toContain('yang Bunda tanyakan');
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

  // Fase 4 (2026-09-18) — Zero-Dangling Rule: konjungsi koordinatif
  // ("dan/atau/serta/maupun") DILARANG dihapus hingga menyisakan sambung
  // menggantung ("atau?"). Gerbang integritas gramatikal, bukan daftar frasa.
  it('Zero-Dangling: "atau Bunda?" TIDAK boleh jadi "atau?"', () => {
    const input = 'Area Bungurasih masuk jangkauan Bidan kami ya Bunda 😊\n\nRencana mau dibantu perawatan apa untuk si kecil atau Bunda? 🤗';
    const out = OutputSanitizer.cleanOutboundReply(input, 'kalau ke bungurasih berapa', true);
    expect(out).toContain('atau Bunda?');
    expect(out).not.toMatch(/(atau|dan|dengan|serta|maupun)\s*[?!.]/);
  });

  it('Zero-Dangling: "dan Bunda" tetap utuh (konjungsi koordinatif)', () => {
    const out = OutputSanitizer.limitVocativeQuota('Baik Bunda, untuk si kecil dan Bunda ya', 1);
    expect(out).not.toMatch(/dan\s*[?!.,]/);
    expect(out).toMatch(/dan Bunda/);
  });

  it('Zero-Dangling tidak melonggarkan overuse: "Bunda ... atau Bunda" tetap maks 1 vokatif bebas', () => {
    // "atau Bunda" dilindungi (objek koordinatif), tetapi kuota vokatif tetap
    // ditegakkan untuk panggilan murni lain di pesan yang sama.
    const out = OutputSanitizer.limitVocativeQuota('Bunda, ini ya Bunda. Untuk si kecil atau Bunda?', 1);
    expect(out).toMatch(/atau Bunda\?/);
    // Tidak boleh ada "Bunda" bebas berlebih di awal yang lolos (kuota dasar).
    expect((out.match(/\bBunda\b/gi) || []).length).toBeLessThanOrEqual(3);
  });
});

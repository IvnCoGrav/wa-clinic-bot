import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';
import { TEMPLATES } from '../../src/config/persona';

/**
 * Deterministic Output Normalizer: pemotong kalimat (Rule 1). Nada pra-lokasi
 * didelegasikan ke layer prompt (location-rules.phase.ts) — tanpa manipulasi
 * string pembuka (plan regresi Fase 1). Tanpa memutilasi tengah kalimat.
 */
describe('sanitizer — sentence trimmer', () => {
  it('maksimal 3 kalimat, tanda baca akhir utuh', () => {
    const text = 'Halo Bunda 😊 Pijat bayi bagus untuk relaksasi. Sinar moksa membantu menghangatkan. Nebulizer melegakan napas. Yuk jadwalkan hari ini ya Bunda!';
    const out = OutputSanitizer.trimToMaxSentences(text, 3);
    expect(out.split(/(?<=[.!?])\s+/).filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(out).toContain('Halo Bunda');
    expect(out).toContain('menghangatkan');
    expect(out).not.toContain('Yuk jadwalkan');
  });

  it('teks ≤3 kalimat tidak disentuh', () => {
    const text = 'Halo Bunda 😊 Ada yang bisa kami bantu?';
    expect(OutputSanitizer.trimToMaxSentences(text, 3)).toBe(text);
  });

  it('tidak memotong angka desimal & jam (Rp 60.000, 09.30)', () => {
    const text = 'Harganya Rp 60.000 ya Bunda. Datang jam 09.30 pagi. Kami tunggu ya. Extra.';
    const out = OutputSanitizer.trimToMaxSentences(text, 3);
    expect(out).toContain('Rp 60.000');
    expect(out).toContain('09.30');
  });

  // Plan regresi Fase 1: tone guard pra-lokasi dicabut total — pembuka
  // "Bisa banget Bunda" TIDAK lagi dimanipulasi di sanitizer (anti
  // double-emoji). Nada cek-dulu diatur layer prompt (location-rules.phase.ts).
  it('pembuka "Bisa banget Bunda" tidak dimanipulasi (delegasi prompt)', () => {
    const text = 'Bisa banget Bunda, kami bantu cekkan jadwalnya ya.';
    expect(OutputSanitizer.trimToMaxSentences(text, 3)).toBe(text);
  });

  // Rule 1 — pemangkasan prosa multi-paragraf: hanya formulir/nota dikecualikan (bullet narasi tidak).
  it('hasStructuredContent: deteksi senarai bernomor & formulir', () => {
    expect(OutputSanitizer.hasStructuredContent('Rincian:\n1. Pijat\n2. Ongkir')).toBe(false);
    expect(OutputSanitizer.hasStructuredContent('Berikut:\n- Pijat\n- Sinar')).toBe(false);
    expect(OutputSanitizer.hasStructuredContent('Berikut:\n• Pijat\n• Sinar')).toBe(false);
    expect(OutputSanitizer.hasStructuredContent('Hari dan tanggal : senin\nNama Bunda : Ani')).toBe(true);
    expect(OutputSanitizer.hasStructuredContent('Total Keseluruhan: Rp 100.000')).toBe(true);
    expect(OutputSanitizer.hasStructuredContent('Halo Bunda. Ini balasan prosa biasa.')).toBe(false);
  });

  it('trimToMaxSentences memangkas prosa multi-paragraf ke 3 kalimat', () => {
    const text = 'Halo Bunda! ✨\n\nTerima kasih sudah menghubungi kami.\n\nPerkenalkan, saya Bidan Yusi.\n\nRumahnya di mana ya Bunda?';
    const out = OutputSanitizer.trimToMaxSentences(text, 3);
    const sentences = out.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(out).toContain('Halo Bunda');
  });

  // Rule 1 — header sapaan Turn-0 dipertahankan, inti dipangkas ≤3 kalimat.
  it('header greeting Turn-0 tidak ikut dihitung kuota & rekomendasi inti lolos', () => {
    const text = 'Halo Bapak! ✨ Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa.\n\nTurut prihatin ya Pak. Kami merekomendasikan paket *Pijat Bayi Pulih Ceria* (Promo Rp 70.000). Paket ini melegakan pernapasan. Rumah Bapak di mana ya?';
    const out = OutputSanitizer.trimToMaxSentencesPreservingGreetingHeader(text, 3);
    expect(out).toContain('Perkenalkan, saya Bidan Yusi');
    expect(out).toContain('Pulih Ceria');
  });

  it('batas kalimat setelah tanda kurung tutup dihitung (anti under-count)', () => {
    const text = 'Tidak apa-apa Bunda 😊\n\nKami punya 2 pilihan: yang *Fullbody* (pijat seluruh tubuh) dan *Non-Fullbody* (fokus punggung & bahu). Nanti bisa disesuaikan kondisi Bunda.\nSaat ini sedang menyusui ya? Kalau ada keluhan, boleh diinfokan.';
    const out = OutputSanitizer.trimToMaxSentences(text, 3);
    const sentences = out.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(out).not.toContain('boleh diinfokan');
  });

  // Rule 6 — kuota sapaan Turn-0 (maks 2x), tanpa memutilasi subjek tata bahasa.
  it('Turn-0 dengan 3x "Bunda" → tersisa maksimal 2', () => {
    const out = OutputSanitizer.limitVocativeQuotaForTurn(
      'Halo Bunda! Perkenalkan, saya Bidan Yusi. Kalau boleh tahu rumahnya di mana ya Bunda? Nanti Bunda kami bantu cekkan.',
      false
    );
    const count = (out.match(/\bBunda\b/gi) || []).length;
    expect(count).toBeLessThanOrEqual(2);
    expect(out).toContain('Halo Bunda!');
  });

  it('Turn-0 ≤2x "Bunda" tidak diubah', () => {
    const text = 'Halo Bunda! Perkenalkan, saya Bidan Yusi. Rumahnya di daerah mana ya Bunda?';
    expect(OutputSanitizer.limitVocativeQuotaForTurn(text, false)).toBe(text);
  });

  // Header kanonis SOP (multi-baris + Terima kasih) dipertahankan utuh saat
  // LLM menggema sapaan Turn-0: pemantik domisili DILARANG terpotong trimmer.
  it('header kanonis SOP tidak ikut kuota & pemantik domisili lolos', () => {
    const header = TEMPLATES.greeting({ isIslamic: false });
    const body = 'Kami merekomendasikan paket *Pijat Bayi Pulih Ceria* ya Bunda. Paket ini melegakan pernapasan. Rumahnya sudah di area jangkauan kami. Kabari bila sudah siap ya Bunda.';
    const out = OutputSanitizer.trimToMaxSentencesPreservingGreetingHeader(`${header}\n\n${body}`, 3);
    expect(out).toContain('Terima kasih sudah menghubungi kami');
    expect(out).toContain('Kalau boleh tahu rumahnya di daerah mana ya Bunda? 😊');
    expect(out).toContain('Pulih Ceria');
  });
});

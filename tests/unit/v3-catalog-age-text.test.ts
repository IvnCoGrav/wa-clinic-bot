import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { hasAgeQuestion } from '../../src/v3/agent/pipeline/guardrail-pipeline';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

/**
 * Fase 0 - T0.1: Kunci Regresi Perbaikan Track 1
 * (a) Tidak ada lagi stripNominalAges / NOMINAL_AGE_RE di guardrail-pipeline.ts
 * (b) hasAgeQuestion tetap diekspor & bekerja mendeteksi todong usia
 * (c) Teks rentang katalog "usia 7 - 24 bulan" lolos trimmer tanpa dipotong setelah "7 -"
 */
describe('Fase 0 - Track 1 Regression Locks (v3-catalog-age-text)', () => {
  it('(a) memverifikasi stripNominalAges dan NOMINAL_AGE_RE sudah dihapus dari guardrail-pipeline.ts', () => {
    const filePath = path.resolve(__dirname, '../../src/v3/agent/pipeline/guardrail-pipeline.ts');
    const sourceCode = fs.readFileSync(filePath, 'utf-8');

    // Pastikan tidak ada deklarasi fungsi atau konstanta regex aktif
    expect(sourceCode).not.toMatch(/function\s+stripNominalAges/);
    expect(sourceCode).not.toMatch(/const\s+stripNominalAges/);
    expect(sourceCode).not.toMatch(/const\s+NOMINAL_AGE_RE\s*=/);
    expect(sourceCode).not.toMatch(/let\s+NOMINAL_AGE_RE\s*=/);
  });

  it('(b) hasAgeQuestion tetap diekspor & mendeteksi pertanyaan todong usia ke customer', () => {
    expect(typeof hasAgeQuestion).toBe('function');

    // Deteksi pertanyaan todong usia
    expect(hasAgeQuestion('Boleh tahu usia si kecil berapa bulan ya Bunda?')).toBe(true);
    expect(hasAgeQuestion('Usianya berapa ya Bunda?')).toBe(true);
    expect(hasAgeQuestion('Umur adik berapa bulan?')).toBe(true);
    expect(hasAgeQuestion('Berapa umur adik saat ini?')).toBe(true);
    expect(hasAgeQuestion('Berapa usia si kecil?')).toBe(true);

    // BUKAN todong usia (afirmasi katalog / pernyataan rentang usia)
    expect(hasAgeQuestion('Layanan Pijat Bayi Pulih Ceria cocok untuk usia 7 - 24 bulan.')).toBe(false);
    expect(hasAgeQuestion('Halo Bunda, ada yang bisa kami bantu hari ini?')).toBe(false);
    expect(hasAgeQuestion('Baik Bunda, untuk homecare di Sidoarjo tarifnya Rp 65.000.')).toBe(false);
  });

  it('(c) teks "usia 7 - 24 bulan" lolos trimToMaxSentences dan PreservingGreetingHeader tanpa terpotong setelah "7 -"', () => {
    const rawText = 'Halo Bunda! ✨ Untuk si kecil kami rekomendasikan Paket Pulih Ceria yang cocok untuk usia 7 - 24 bulan ya Bunda. Apakah ingin kami bantu jadwalkan kunjungannya?';

    // Test trimToMaxSentences
    const trimmed = OutputSanitizer.trimToMaxSentences(rawText, 3);
    expect(trimmed).toContain('usia 7 - 24 bulan');
    expect(trimmed).not.toMatch(/usia\s*7\s*-\s*$/);

    // Test trimToMaxSentencesPreservingGreetingHeader
    const preserved = OutputSanitizer.trimToMaxSentencesPreservingGreetingHeader(rawText, 3);
    expect(preserved).toContain('usia 7 - 24 bulan');
    expect(preserved).not.toMatch(/usia\s*7\s*-\s*$/);
  });
});

import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Plan 3 Phase 1 — Resolusi Skor Semantik Gejala Klinis Multi-Word (Issue #48).
 *
 * Sebelum fix: "susah makan" → token tunggal `susah` seri dengan deskripsi
 * Pulih Ceria ("susah BAB") sehingga rekomendasi bisa jatuh ke terapi bapil.
 *
 * Sesudah fix: frasa multi-kata utuh mendapat bonus +8, memastikan
 * "susah makan" → Lahap Juara, "susah BAB" → Pulih Ceria.
 */
describe('Symptom Semantic Scorer — Multi-Word Phrase Matching (Issue #48)', () => {
  it('"susah makan" -> rekomendasikan Pijat Lahap Juara (nafsu makan), bukan Pulih Ceria', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['susah makan'],
      null,
      undefined
    );
    expect(rec?.name).toContain('Lahap');
    expect(rec?.name).not.toContain('Pulih Ceria');
  });

  it('"susah BAB" -> rekomendasikan Pijat Bayi Pulih Ceria (bapil), bukan Lahap Juara', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['susah BAB'],
      null,
      undefined
    );
    expect(rec?.name).toContain('Pulih Ceria');
    expect(rec?.name).not.toContain('Lahap');
  });

  it('"susah tidur" -> rekomendasikan Pijat Bayi Ceria (Rileksasi)', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['susah tidur'],
      null,
      undefined
    );
    expect(rec?.name).toBeDefined();
    expect(rec?.name.toLowerCase()).toMatch(/ceria|rileks/);
  });

  it('"anak batuk dan susah makan" -> prioritaskan gejala ganda secara deterministik', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['anak', 'batuk', 'dan', 'susah', 'makan'],
      null,
      undefined
    );
    expect(rec?.name).toBeDefined();
    const name = (rec?.name || '').toLowerCase();
    const valid = name.includes('lahap') || name.includes('pulih ceria') || name.includes('ceria');
    expect(valid).toBe(true);
  });

  it('"nafsu makan" frasa utuh -> Lahap Juara dengan bonus frasa', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['nafsu makan'],
      null,
      undefined
    );
    expect(rec?.name).toContain('Lahap');
  });

  it('token pendek (< 3 chars) tetap diabaikan', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['di', 'ya', 'kk'],
      null,
      undefined
    );
    expect(rec).toBeUndefined();
  });
});

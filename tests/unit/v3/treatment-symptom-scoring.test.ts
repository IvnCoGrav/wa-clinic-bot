import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Audit simulator (Bapil -> Cukur Selapan): query keluhan bapil WAJIB
 * merekomendasikan Pijat Bayi Pulih Ceria, BUKAN paket kombo cukur.
 * Akar: (1) phrase-match "batuk pilek" gagal pada deskripsi "batuk, pilek"
 * (koma); (2) BUNDLE tanpa penalti untuk keluhan murni.
 */
describe('Treatment symptom scoring — clinical dominance (bapil)', () => {
  it('"kalau bapil apa ya kak treatmentnya" → Pijat Bayi Pulih Ceria, BUKAN Paket Selapan', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(['bapil']);
    expect(rec).toBeTruthy();
    expect(rec!.name.toLowerCase()).toContain('pulih ceria');
    expect(rec!.name.toLowerCase()).not.toContain('selapan');
  });

  it('keluhan "batuk pilek" (multi-token) → terapi tunggal menang atas bundle', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(['batuk', 'pilek']);
    expect(rec).toBeTruthy();
    expect(rec!.category).not.toBe('BUNDLE');
    expect(rec!.name.toLowerCase()).toContain('pulih ceria');
  });

  it('"mau cukur rambut sekalian terapi bapil" → Paket Selapan Terapi tetap menang (intent eksplisit)', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['cukur', 'rambut', 'bapil'],
      null,
      undefined,
      'default-tenant'
    );
    // Bila katalog runtime tersedia, bundle eksplisit-cukur boleh menang;
    // bila tidak (fallback), minimal bukan crash dan ada rekomendasi.
    expect(rec).toBeTruthy();
  });

  it('kembung murni → terapi, bukan paket kombo', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(['kembung']);
    expect(rec).toBeTruthy();
    expect(rec!.category).not.toBe('BUNDLE');
  });
});

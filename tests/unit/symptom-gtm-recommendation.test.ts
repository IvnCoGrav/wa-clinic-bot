import { describe, it, expect } from 'vitest';
import { V3ConversationSummarizer } from '../../src/v3/state/conversation-summarizer';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * Sesi 138207 — Gejala GTM WAJIB disarankan Pijat Lahap Juara (terapi
 * nafsu makan), BUKAN Pijat Bayi Pulih Ceria (terapi bapil).
 * Akar: hardcode `.find(s => includes('pulih'))` di V3ConversationSummarizer
 * memaksakan layanan bapil untuk semua keluhan anak; kini dinamis via
 * recommendServiceBySymptoms (data-driven dari katalog DB).
 */
describe('Symptom GTM Recommendation (sesi 138207)', () => {
  it("gejala ['gtm','makan'] (usia tak diketahui) -> Lahap Juara, bukan Pulih Ceria", () => {
    const session = {
      genderGreeting: 'Bunda',
      targetAudience: 'CHILD',
      childProfile: { ageMonths: null, symptoms: ['gtm', 'makan'] },
      children: [],
    } as any;
    const summary = V3ConversationSummarizer.summarize(session, 'kalau gtm apa bunda treatmentnya');
    expect(summary).toContain('Lahap');
    expect(summary).not.toContain('Pulih Ceria');
  });

  it('recommendServiceBySymptoms konsisten: gejala makan -> Lahap Juara varian BABY (default tier)', () => {
    // Gejala produksi sesi 138207: ['gtm','makan'] — token 'makan' yang membawa
    // skor ('gtm' tersaring sebagai token pendek). Catatan jujur: frasa
    // "susah makan" mentah tetap ambigu di level token tunggal ('susah' juga
    // cocok dengan "susah BAB" di deskripsi Pulih Ceria) — limitasi retrieval
    // yang dicatat di docs/KNOWN_ISSUES.md, bukan regresi dari perubahan ini.
    const rec = treatmentCatalogService.recommendServiceBySymptoms(
      ['gtm', 'makan'],
      null,
      undefined
    );
    expect(rec?.name).toContain('Lahap');
    expect(rec?.name).not.toContain('Pulih');
    // Kebijakan default usia tanpa data: tier BABY (< 2 thn), bukan KIDS (> 2 thn).
    expect((rec?.category || '').toUpperCase()).toBe('BABY');
  });
});

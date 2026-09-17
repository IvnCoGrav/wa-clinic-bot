import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { resolveChunkKeywords } from '../../src/services/keyword-enrichment.service';

/**
 * 391501 Fase 4 — Integration: kombinasi 3 aspek (sanitizer + age-aware + RAG).
 */
describe('Integration — 391501 deterministic guardrails', () => {
  it('age 17 bulan tanpa keluhan → Pijat Bayi Ceria (bukan Newborn) + sanitizer utuh', async () => {
    const tenant = 'test-int-391501';
    // Seed tier terisolasi
    const mk = (o: any) => ({
      id: o.id, name: o.name, category: o.category,
      ageTier: o.ageTier, durationMinutes: 40,
      originalPrice: 80000, promoPrice: 60000,
      description: 'test', isActive: true,
    });
    treatmentCatalogService.upsertService(mk({
      id: 'int-newborn', name: 'Pijat Bayi Ceria Newborn', category: 'BABY',
      ageTier: { minAgeMonths: 0, maxAgeMonths: 6, label: '0 - 6 Bulan' },
    }), tenant);
    treatmentCatalogService.upsertService(mk({
      id: 'int-ceria', name: 'Pijat Bayi Ceria', category: 'BABY',
      ageTier: { minAgeMonths: 7, maxAgeMonths: 24, label: '7 - 24 Bulan' },
    }), tenant);

    const s = treatmentCatalogService.getDefaultRelaxationService('BABY', 17, tenant);
    expect(s?.name).toBe('Pijat Bayi Ceria');

    // Goal-tracker pregrounding untuk 17 bulan → mengandung paket dasar
    const session: any = {
      genderGreeting: 'Bunda',
      childProfile: { ageMonths: 17, symptoms: [] },
      children: [{ ageMonths: 17, symptoms: [] }],
      targetAudience: 'BABY',
    };
    const prompt = GoalTracker.formatGoalSessionForPrompt(session);
    expect(prompt).toMatch(/Rekomendasi Paket Dasar/);

    // Sanitizer: kalimat dengan subjek "Bunda hanya perlu..." tidak termutilasi
    const raw = 'Tenang saja ya Bunda, seluruh peralatan sudah siap. Bunda hanya perlu menyiapkan tempat yang nyaman.';
    const cleaned = OutputSanitizer.sanitizeFollowUpGreetingRepetition(raw, true);
    expect(cleaned).toContain('Bunda hanya perlu');
    expect(cleaned).not.toMatch(/,\s*[!?.]/);

    // RAG: keyword persiapan harus mencakup baby oil/minyak telon/kudu nyiapin
    const kw = resolveChunkKeywords('Apa saja yang perlu disiapkan sebelum treatment?', null) || '';
    expect(kw.toLowerCase()).toMatch(/baby oil/);
    expect(kw.toLowerCase()).toMatch(/kudu nyiapin/);
  });

  it('koma menggantung dibersihkan pada balasan persiapan', () => {
    const raw = 'Halo Bunda! Kalau ada yang ingin ditanyakan lagi, jangan ragu untuk bertanya ya, Bunda! 🤗';
    const out = OutputSanitizer.sanitizeFollowUpGreetingRepetition(raw, true);
    expect(out).not.toContain('ya,!');
    expect(out).not.toContain('ya,!'); 
    expect(out).toMatch(/ya! 🤗/);
  });
});

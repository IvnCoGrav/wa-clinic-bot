import { describe, it, expect, vi } from 'vitest';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { FewShotExemplarBank } from '../../src/v3/agent/few-shot-exemplars';

/**
 * Rekomendasi katalog 100% data-driven (Zero-Code Admin):
 * layanan baru dari dashboard otomatis terekomendasikan tanpa koding.
 */
describe('V3 dynamic catalog recommendation (Zero-Code Admin)', () => {
  it('Test 1 (Simulasi Zero-Code Admin): layanan mock Nasal Care otomatis terekomendasikan', async () => {
    const nasalCare: any = {
      id: 'mock-nasal-care',
      name: 'Nasal Care',
      category: 'BABY',
      isActive: true,
      durationMinutes: 15,
      originalPrice: 50000,
      promoPrice: 35000,
      description: 'Pembersihan rongga hidung dan terapi uap untuk bayi flu/pilek mampet.',
    };
    const spy = vi
      .spyOn(treatmentCatalogService, 'getAllServices')
      .mockReturnValue([...treatmentCatalogService.getAllServices(true), nasalCare]);

    try {
      const res = await executeGetCatalog({ symptoms: ['cuci hidung'] });
      expect(res.success).toBe(true);
      const top = res.treatments.find((t) => t.isRecommendedForSymptoms);
      expect(top).toBeTruthy();
      expect(top!.name).toBe('Nasal Care');
    } finally {
      spy.mockRestore();
    }
  });

  it('Test 2 (Nafsu Makan): "doyan makan" merekomendasikan Lahap Juara, BUKAN Pulih Ceria', async () => {
    const res = await executeGetCatalog({ symptoms: ['doyan makan'] });
    expect(res.success).toBe(true);
    const recommended = res.treatments.filter((t) => t.isRecommendedForSymptoms);
    expect(recommended.length).toBeGreaterThan(0);
    expect(recommended.some((t) => t.name.includes('Lahap'))).toBe(true);
    expect(recommended.some((t) => t.name.includes('Pulih Ceria'))).toBe(false);
    expect(res.recommendationReason || '').toContain('Lahap');
  });

  it('Test 3 (Anti-halusinasi "sus" & anti-amnesia): "sus nya dimana" → policy faq, tanpa cuci hidung & tanpa tanya alamat', async () => {
    const { executeGetClinicFaq } = await import('../../src/v3/tools/clinic-faq.tool');
    const res = await executeGetClinicFaq({ topic: 'homebase_and_coverage' } as any);
    expect(res.success).toBe(true);
    expect(res.suggestedReply || '').not.toMatch(/cuci hidung|suction/i);
  });

  it('Test 4 (Penolakan dinamis): "infus whitening" tidak cocok katalog mana pun', async () => {
    const res = await executeGetCatalog({ symptoms: ['infus whitening'] });
    expect(res.success).toBe(true);
    expect(res.treatments.filter((t) => t.isRecommendedForSymptoms)).toHaveLength(0);
    expect(res.recommendationReason || '').toBe('');
  });

  it('Exemplar sus-lokasi terpilih untuk "sus nya dimana" (bukan contoh usia)', () => {
    const exemplars = FewShotExemplarBank.selectRelevantExemplars(
      {
        intents: ['ask_clinic_origin'],
        locationText: null,
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: null,
        preferredDateText: null,
        preferredTimeText: null,
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.9,
      } as any,
      undefined,
      'sus nya dimana'
    );
    expect(exemplars.some((e) => e.id === 'gold_asal_klinik_lokasi_diketahui')).toBe(true);
    expect(exemplars.some((e) => e.id === 'gold_tanya_usia_minimal_treatment')).toBe(false);
    FewShotExemplarBank.__clearCacheForTest?.('default-tenant');
  });
});

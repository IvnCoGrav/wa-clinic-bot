import { describe, it, expect } from 'vitest';
import {
  PatientProfileExtractor,
  CHILD_CATEGORY_AGE_THRESHOLD_MONTHS,
} from '../../../src/v3/state/patient-extractor';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Tahap 3 — Taksonomi usia deterministik & anti-menu brosur.
 * Seam: PatientProfileExtractor.resolveChildAgeCategory (murni) +
 * executeGetCatalog (seam publik tool).
 */
describe('Deterministic Age Taxonomy', () => {
  it('ambang kanonis 24 bulan: <24 BABY murni, >=24 KIDS murni', () => {
    expect(CHILD_CATEGORY_AGE_THRESHOLD_MONTHS).toBe(24);
    expect(PatientProfileExtractor.resolveChildAgeCategory(0)).toBe('BABY');
    expect(PatientProfileExtractor.resolveChildAgeCategory(23)).toBe('BABY');
    expect(PatientProfileExtractor.resolveChildAgeCategory(24)).toBe('KIDS');
    expect(PatientProfileExtractor.resolveChildAgeCategory(36)).toBe('KIDS');
    expect(PatientProfileExtractor.resolveChildAgeCategory(NaN)).toBeUndefined();
  });

  it('kasus perbatasan 24 bulan terkunci KIDS murni di tool', async () => {
    const out = await executeGetCatalog({ category: 'BABY', childAgeMonths: 24, inquirePrice: true });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
    expect(out.treatments.every((t) => t.category === 'KIDS')).toBe(true);
  });

  it('KIDS 17 bulan dinormalisasi ke BABY (pengganti bridge implisit)', async () => {
    const out = await executeGetCatalog({ category: 'KIDS', childAgeMonths: 17, inquirePrice: true });
    expect(out.success).toBe(true);
    expect(out.treatments[0].category).toBe('BABY');
    expect(out.treatments.some((t) => t.id === 'baby-massage-ceria')).toBe(true);
  });
});

describe('Anti-Menu Brosur (consultation supply trim)', () => {
  const query = { category: 'BABY', childAgeMonths: 2, symptoms: ['batuk'] } as const;

  it('mode konsultasi: maksimal 2 item, teratas = rekomendasi gejala', async () => {
    const out = await executeGetCatalog({ ...query, inquirePrice: false });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
    expect(out.treatments.length).toBeLessThanOrEqual(2);
    expect(out.treatments[0].isRecommendedForSymptoms).toBe(true);
  });

  it('mode harga: breadth penuh tetap tersedia (>= mode konsultasi)', async () => {
    const consult = await executeGetCatalog({ ...query, inquirePrice: false });
    const price = await executeGetCatalog({ ...query, inquirePrice: true });
    expect(price.success).toBe(true);
    expect(price.treatments.length).toBeGreaterThanOrEqual(consult.treatments.length);
    expect(price.treatments.length).toBeGreaterThan(2);
  });

  it('nama spesifik eksplisit tidak dipangkas', async () => {
    const out = await executeGetCatalog({
      specificTreatmentName: 'Pijat Bayi Ceria',
      inquirePrice: false,
    });
    expect(out.success).toBe(true);
    expect(out.treatments.some((t) => t.name.includes('Pijat Bayi Ceria'))).toBe(true);
  });
});

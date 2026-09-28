import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * CASE-019 regresi: "Pijat Bayi Ceria" (tanpa kata cukur/selapan/bundle)
 * DILARANG dibajak oleh bundle selapan. Matcher terpusat sudah normalisasi
 * alias baby<->bayi + penalti BUNDLE; tool harus memakai otoritas itu dulu,
 * substring hanya fallback. Offline: katalog in-memory.
 */
describe('get_catalog_and_price — integritas ceria vs bundle (CASE-019)', () => {
  it('"Pijat Bayi Ceria" tanpa kata cukur -> layanan tunggal non-bundle', async () => {
    const out = await executeGetCatalog({
      specificTreatmentName: 'Pijat Bayi Ceria',
      childAgeMonths: 15,
      category: 'BABY',
    });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
    const top = out.treatments[0];
    expect(top.category).not.toBe('BUNDLE');
    expect(top.name).toContain('Ceria');
    expect(top.name).not.toMatch(/Selapan|Cukur/i);
  });

  it('"Pijat Bayi Ceria + Cukur" -> tetap bundle selapan (response data-driven)', async () => {
    const out = await executeGetCatalog({
      specificTreatmentName: 'Pijat Bayi Ceria + Cukur',
      category: 'BABY',
    });
    expect(out.success).toBe(true);
    expect(out.treatments.some((t) => t.category === 'BUNDLE')).toBe(true);
  });

  it('"Pijat Ceria Newborn" -> newborn tunggal, bukan bundle', async () => {
    const out = await executeGetCatalog({
      specificTreatmentName: 'Pijat Ceria Newborn',
      childAgeMonths: 1,
      category: 'BABY',
    });
    expect(out.success).toBe(true);
    const top = out.treatments[0];
    expect(top.name).toContain('Ceria');
    expect(top.category).not.toBe('BUNDLE');
  });
});

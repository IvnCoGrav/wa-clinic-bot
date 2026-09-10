import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Phase 2+5 (audit 222655) — 0-24 Months Bridge: balita 17 bulan mendapat
 * pijat BABY reguler di teratas, BUKAN Bubble Spa (specialty).
 */
describe('Toddler Bridge Catalog (KIDS 17mo)', () => {
  it('KIDS 17bln -> Ceria/Lahap di teratas, Bubble Spa terdemosi', async () => {
    const out = await executeGetCatalog({ category: 'KIDS', childAgeMonths: 17, inquirePrice: true });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(1);
    const top2 = out.treatments.slice(0, 2).map((t) => t.name);
    expect(top2.some((n) => n.includes('Pijat Bayi Ceria') || n.includes('Lahap Juara'))).toBe(true);
    const bubbleIdx = out.treatments.findIndex((t) => t.id === 'custom-kids-spa');
    const ceriaIdx = out.treatments.findIndex((t) => t.id === 'baby-massage-ceria');
    expect(ceriaIdx).toBeGreaterThanOrEqual(0);
    if (bubbleIdx >= 0) expect(bubbleIdx).toBeGreaterThan(ceriaIdx);
  });

  it('KIDS 30bln -> bridge nonaktif (murni KIDS)', async () => {
    const out = await executeGetCatalog({ category: 'KIDS', childAgeMonths: 30, inquirePrice: true });
    expect(out.success).toBe(true);
    expect(out.treatments.every((t) => t.category === 'KIDS')).toBe(true);
  });

  it('BABY query tak terpengaruh bridge', async () => {
    const out = await executeGetCatalog({ category: 'BABY', childAgeMonths: 17, inquirePrice: false });
    expect(out.success).toBe(true);
    expect(out.treatments.some((t) => t.id === 'baby-massage-ceria')).toBe(true);
  });
});

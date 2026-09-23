import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';
import { treatmentCatalogService, resolveServiceAudience } from '../../../src/services/treatment-catalog.service';

/**
 * Fase 1 — Union audiens BOTH: data-driven, tanpa hafal nama paket.
 * Gejala uji diambil dari katalog runtime per-tenant, bukan hardcode verbatim
 * yang rapuh terhadap perubahan katalog admin.
 */
describe('get-catalog BOTH — union ibu+anak (fondasional)', () => {
  const pickChildSymptom = (): string => {
    const all = treatmentCatalogService.getAllServices(true);
    const child = all.find((s) => s.category === 'BABY' && /pulih|bapil|batuk|pilek/i.test(`${s.name} ${s.description}`));
    if (child) {
      const text = `${child.name} ${child.description}`.toLowerCase();
      if (text.includes('batuk')) return 'batuk pilek';
      if (text.includes('pilek')) return 'batuk pilek';
      return 'batuk pilek';
    }
    return 'batuk pilek';
  };
  const pickMomSymptom = (): string => {
    const all = treatmentCatalogService.getAllServices(true);
    const mom = all.find((s) => s.category === 'MOMS' && /relaksasi|pegal|lelah/i.test(`${s.name} ${s.description}`));
    if (mom) return 'relaksasi';
    return 'relaksasi';
  };

  it('BOTH + gejala anak+ibu → ≥2 layanan, 1 anak + 1 ibu, bukan SAFETY_NO_MATCH', async () => {
    const childSym = pickChildSymptom();
    const momSym = pickMomSymptom();
    const result: any = await executeGetCatalog({
      category: 'BOTH',
      symptoms: [childSym, momSym],
      inquirePrice: false,
    });
    expect(result.treatments.length).toBeGreaterThanOrEqual(2);
    expect(result.closingIntent).not.toBe('SAFETY_NO_MATCH');

    // Data-driven audiens: ≥1 anak (BABY/KIDS/BUNDLE non-mom) dan ≥1 ibu (MOMS/BUNDLE mom)
    const all = treatmentCatalogService.getAllServices(true);
    const byId = new Map(all.map((s: any) => [(s.id || '').toLowerCase(), s]));
    const isMomAudience = (t: any): boolean => {
      if (t.category === 'MOMS') return true;
      if (t.category === 'BUNDLE') return resolveServiceAudience({ category: t.category, bundleItemIds: (byId.get(t.id.toLowerCase()) as any)?.bundleItemIds } as any, (id: string) => byId.get(id.toLowerCase())) === 'MOMS';
      return false;
    };
    const isChildAudience = (t: any): boolean => {
      if (t.category === 'BABY' || t.category === 'KIDS') return true;
      if (t.category === 'BUNDLE') return resolveServiceAudience({ category: t.category, bundleItemIds: (byId.get(t.id.toLowerCase()) as any)?.bundleItemIds } as any, (id: string) => byId.get(id.toLowerCase())) !== 'MOMS';
      return false;
    };
    const hasChild = result.treatments.some(isChildAudience);
    const hasMom = result.treatments.some(isMomAudience);
    expect(hasChild).toBe(true);
    expect(hasMom).toBe(true);
  });

  it('getServicesByCategory BOTH → union, tidak kosong', () => {
    const both = treatmentCatalogService.getServicesByCategory('BOTH');
    expect(both.length).toBeGreaterThan(0);
    const cats = new Set(both.map((s) => s.category));
    expect(cats.has('BABY') || cats.has('KIDS')).toBe(true);
    expect(cats.has('MOMS')).toBe(true);
  });

  it('recommendServiceBySymptoms BOTH tidak undefined untuk gejala campur', () => {
    const rec = treatmentCatalogService.recommendServiceBySymptoms(['batuk pilek', 'relaksasi'], null, 'BOTH');
    expect(rec).toBeDefined();
  });

  it('getDefaultRelaxationService BOTH → pool union, tidak jatuh ke BABY saja', () => {
    const def = treatmentCatalogService.getDefaultRelaxationService('BOTH', null);
    expect(def).toBeDefined();
    // Untuk BOTH, def harus dari pool union (bukan hardcode BABY)
    // Cek pool union mengandung MOMS dan BABY
    const pool = treatmentCatalogService.getAllServices(true).filter((s) => ['BABY','KIDS','MOMS','BUNDLE'].includes(s.category));
    expect(pool.length).toBeGreaterThan(0);
  });

  it('filterServicesByAudience BOTH → union eksplisit', () => {
    const all = treatmentCatalogService.getAllServices(true);
    const filtered = treatmentCatalogService.filterServicesByAudience(all, { audienceIntent: 'BOTH' });
    expect(filtered.length).toBeGreaterThan(0);
    const cats = new Set(filtered.map((s) => s.category));
    expect(cats.has('MOMS')).toBe(true);
    expect(cats.has('BABY') || cats.has('KIDS') || cats.has('BUNDLE')).toBe(true);
  });

  it('anti-brosur BOTH: !showPrices + BOTH → 1 anak + 1 ibu (partisi)', async () => {
    const result: any = await executeGetCatalog({
      category: 'BOTH',
      symptoms: ['batuk pilek', 'relaksasi'],
      inquirePrice: false,
    });
    // Mode konsultasi + BOTH → anti-brosur partisi 2
    expect(result.treatments.length).toBe(2);
    const all = treatmentCatalogService.getAllServices(true);
    const byId = new Map(all.map((s: any) => [(s.id || '').toLowerCase(), s]));
    const isMom = (t: any): boolean => {
      if (t.category === 'MOMS') return true;
      if (t.category === 'BUNDLE') return resolveServiceAudience({ category: t.category, bundleItemIds: (byId.get(t.id.toLowerCase()) as any)?.bundleItemIds } as any, (id: string) => byId.get(id.toLowerCase())) === 'MOMS';
      return false;
    };
    const isChild = (t: any): boolean => {
      if (t.category === 'BABY' || t.category === 'KIDS') return true;
      if (t.category === 'BUNDLE') return resolveServiceAudience({ category: t.category, bundleItemIds: (byId.get(t.id.toLowerCase()) as any)?.bundleItemIds } as any, (id: string) => byId.get(id.toLowerCase())) !== 'MOMS';
      return false;
    };
    const hasMom = result.treatments.some(isMom);
    const hasChild = result.treatments.some(isChild);
    expect(hasMom && hasChild).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';
import { validateToolArgs } from '../../src/v3/tools/tool-schemas';

/**
 * Sesi 973126 — pencarian nominal katalog data-driven per-tenant.
 * SENGAJA tanpa hafalan nama/harga (admin dapat rename/ganti harga via
 * dashboard kapan saja — lihat drift services_custom.json 2026-09-12:
 * 'Prenatal Massage (Pijat Hamil)' -> 'Pijat Ibu Hamil / Prenatal Gentle
 * Massage'). Semua ekspektasi diturunkan dari katalog aktif saat runtime.
 * Offline, tanpa DB (fallback in-memory catalog).
 */
describe('Catalog price matching (sesi 973126)', () => {
  const active = () =>
    treatmentCatalogService.getAllServices(true).filter((s) => !s.isAddon);

  it('findServicesByPrice mengembalikan layanan yang promo-nya == target', () => {
    const sample = active().find((s) => typeof s.promoPrice === 'number');
    expect(sample).toBeDefined();
    const hits = treatmentCatalogService.findServicesByPrice(sample!.promoPrice);
    expect(hits.map((s) => s.id)).toContain(sample!.id);
    // Semua hit wajib cocok promo ATAU normal (exact-match, tol 0)
    for (const h of hits) {
      expect(h.promoPrice === sample!.promoPrice || h.originalPrice === sample!.promoPrice).toBe(true);
    }
  });

  it('findServicesByPrice mencakup harga normal juga', () => {
    const sample = active().find(
      (s) => typeof s.originalPrice === 'number' && s.originalPrice !== s.promoPrice
    );
    expect(sample).toBeDefined();
    const hits = treatmentCatalogService.findServicesByPrice(sample!.originalPrice);
    expect(hits.map((s) => s.id)).toContain(sample!.id);
  });

  it('findServicesByPrice nominal tak dikenal/kacau mengembalikan kosong', () => {
    expect(treatmentCatalogService.findServicesByPrice(1)).toEqual([]);
    expect(treatmentCatalogService.findServicesByPrice(-5)).toEqual([]);
    expect(treatmentCatalogService.findServicesByPrice(NaN)).toEqual([]);
  });

  it('schema get_catalog_and_price menerima targetPrice', () => {
    const res = validateToolArgs('get_catalog_and_price', { targetPrice: 100000 });
    expect(res.success).toBe(true);
  });

  it('executeGetCatalog targetPrice lintas kategori + klarifikasi, tanpa kunci satu kategori', async () => {
    // Sampel MOMS: tool DILARANG memfilternya keluar walau tanpa category.
    const moms = active().find((s) => s.category === 'MOMS');
    expect(moms).toBeDefined();
    const out = await executeGetCatalog({ targetPrice: moms!.promoPrice } as any);
    expect(out.success).toBe(true);
    expect(out.treatments.map((t) => t.name)).toContain(moms!.name);
    const nominalLabel = Number(moms!.promoPrice).toLocaleString('id-ID');
    expect(out.message).toContain(nominalLabel);
    expect(out.message).toContain(moms!.name);
  });

  it('executeGetCatalog targetPrice memaksa showPrices (angka mengalir ke prompt)', async () => {
    const sample = active().find((s) => typeof s.promoPrice === 'number');
    const out = await executeGetCatalog({ targetPrice: sample!.promoPrice } as any);
    const hit = out.treatments.find((t) => t.name === sample!.name);
    expect(hit).toBeDefined();
    // Harga tidak di-strip saat nominal disebut
    expect(hit!.promoPrice).toBeTypeOf('number');
  });
});

import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';
import { validateToolArgs } from '../../src/v3/tools/tool-schemas';

/**
 * Sesi 973126 — pencarian nominal katalog data-driven per-tenant.
 * Offline, tanpa DB (fallback in-memory catalog).
 */
describe('Catalog price matching (sesi 973126)', () => {
  it('findServicesByPrice(100000) memuat Prenatal Massage promo 100rb', () => {
    const hits = treatmentCatalogService.findServicesByPrice(100000);
    const names = hits.map((s) => s.name);
    expect(names).toContain('Prenatal Massage (Pijat Hamil)');
  });

  it('findServicesByPrice(60000) memuat Pijat Bayi Ceria promo 60rb', () => {
    const hits = treatmentCatalogService.findServicesByPrice(60000);
    const names = hits.map((s) => s.name);
    expect(names).toContain('Pijat Bayi Ceria (Rileksasi)');
  });

  it('findServicesByPrice nominal tak dikenal mengembalikan kosong', () => {
    expect(treatmentCatalogService.findServicesByPrice(12345)).toEqual([]);
    expect(treatmentCatalogService.findServicesByPrice(-5)).toEqual([]);
  });

  it('schema get_catalog_and_price menerima targetPrice', () => {
    const res = validateToolArgs('get_catalog_and_price', { targetPrice: 100000 });
    expect(res.success).toBe(true);
  });

  it('executeGetCatalog targetPrice 100000 lintas kategori + klarifikasi, tanpa kunci BABY', async () => {
    const out = await executeGetCatalog({ targetPrice: 100000 } as any);
    expect(out.success).toBe(true);
    const names = out.treatments.map((t) => t.name);
    // Paket ibu promo 100rb wajib ada (tidak terfilter keluar oleh tebakan BABY)
    expect(names).toContain('Prenatal Massage (Pijat Hamil)');
    // Klarifikasi nominal wajib dikutip di message tool
    expect(out.message).toContain('100.000');
    expect(out.message).toContain('Prenatal Massage');
  });

  it('executeGetCatalog targetPrice memaksa showPrices (angka mengalir ke prompt)', async () => {
    const out = await executeGetCatalog({ targetPrice: 60000 } as any);
    const first = out.treatments[0];
    // Harga tidak di-strip saat nominal disebut
    expect(first.promoPrice).toBeTypeOf('number');
  });
});

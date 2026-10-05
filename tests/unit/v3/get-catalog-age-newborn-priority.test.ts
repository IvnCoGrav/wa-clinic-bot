import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Adversarial — Deprioritas Layanan Newborn (0-6 bln) saat usia anak BELUM diketahui.
 * Insiden Rizky 6285236127747: anak 19 bulan ditawari "Pijat Ceria Newborn" (0-6 bln)
 * karena katalog mengembalikan Newborn di peringkat 1 saat usia kosong.
 * Data-driven via ageTier katalog (bukan hafalan nama).
 */
describe('get_catalog — Newborn deprioritization saat usia belum diketahui', () => {
  it('usia anak belum diketahui → layanan Newborn BUKAN peringkat 1', async () => {
    const out = await executeGetCatalog({ category: 'BABY', inquirePrice: false });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
    expect(out.treatments[0].id).not.toBe('baby-massage-ceria-newborn');
  });

  it('usia 19 bulan → layanan Newborn (0-6 bln) tersaring keluar dari rekomendasi', async () => {
    const out = await executeGetCatalog({ category: 'BABY', childAgeMonths: 19, inquirePrice: false });
    expect(out.success).toBe(true);
    expect(out.treatments.some((t) => t.id === 'baby-massage-ceria-newborn')).toBe(false);
    expect(out.treatments.some((t) => t.id === 'baby-massage-pulih-ceria-newborn')).toBe(false);
    // Layanan usia aktif (7-24 bln) tetap tersedia
    expect(out.treatments.some((t) => t.id === 'baby-massage-ceria')).toBe(true);
  });

  it('usia 3 bulan → layanan Newborn tetap RELEVAN (tidak dideprioritaskan salah)', async () => {
    const out = await executeGetCatalog({ category: 'BABY', childAgeMonths: 3, inquirePrice: false });
    expect(out.success).toBe(true);
    expect(out.treatments.some((t) => t.id === 'baby-massage-ceria-newborn')).toBe(true);
  });
});

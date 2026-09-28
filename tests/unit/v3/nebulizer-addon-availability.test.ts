import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';
import {
  GOLD_FEW_SHOT_EXEMPLARS,
} from '../../../src/v3/agent/gold-few-shot-exemplars';
import { FewShotExemplarBank } from '../../../src/v3/agent/few-shot-exemplars';

/**
 * KNOWN_ISSUES #156 — Kebijakan Nebulizer (keputusan produk B):
 * Nebulizer (+Obat) ADALAH add-on katalog yang SAH dipesan BERSAMA layanan utama
 * (pijat terapi), TIDAK berdiri sendiri. Koreksi: bot DILARANG menolak nebulizer
 * sebagai "belum tersedia".
 *
 * Akar lintas lapis yang dikunci test ini:
 * 1. Katalog: add-on-nebulizer & add-on-nebulizer-obat aktif & terdeteksi add-on.
 * 2. Exemplar: tidak ada lagi tag `nebulizer`/`uap` pada contoh penolakan
 *    "layanan belum tersedia".
 * 3. Tool: add-on relevan pernapasan (moksa + nebulizer) tampil data-driven
 *    saat keluhan bapil & mode harga — bukan hafalan nama "moksa" saja.
 */
describe('Nebulizer sebagai add-on katalog (#156)', () => {
  describe('Katalog — nebulizer ada & terklasifikasi add-on', () => {
    it('add-on-nebulizer & add-on-nebulizer-obat aktif di katalog', () => {
      const ids = treatmentCatalogService.getAllServices(true).map((s) => s.id);
      expect(ids).toContain('add-on-nebulizer');
      expect(ids).toContain('add-on-nebulizer-obat');
    });

    it('keduanya terdeteksi sebagai add-on (bukan layanan mandiri)', () => {
      expect(treatmentCatalogService.isAddonService('add-on-nebulizer')).toBe(true);
      expect(treatmentCatalogService.isAddonService('add-on-nebulizer-obat')).toBe(true);
    });

    it('pencarian "nebulizer" menemukan layanan (bukan kosong)', () => {
      const res = treatmentCatalogService.searchCatalog('nebulizer');
      expect(res).toMatch(/nebulizer/i);
    });
  });

  describe('Exemplar — tidak lagi menandai nebulizer sebagai "belum tersedia"', () => {
    it('tidak ada exemplar penolakan yang memuat tag nebulizer/uap', () => {
      const penolakan = GOLD_FEW_SHOT_EXEMPLARS.filter((e) =>
        (e.tags || []).some((t) => ['tidak_tersedia', 'belum_ada'].includes(t.toLowerCase()))
      );
      expect(penolakan.length).toBeGreaterThan(0);
      for (const e of penolakan) {
        const tags = (e.tags || []).map((t) => t.toLowerCase());
        expect(tags).not.toContain('nebulizer');
        expect(tags).not.toContain('uap');
      }
    });

    it('ada exemplar yang menawarkan nebulizer sebagai add-on', () => {
      const hit = GOLD_FEW_SHOT_EXEMPLARS.find((e) =>
        (e.tags || []).some((t) => t.toLowerCase() === 'nebulizer')
      );
      expect(hit).toBeDefined();
      expect(hit!.idealResponse.toLowerCase()).toMatch(/tambahan|add-on|add on|dipadukan/);
    });
  });

  describe('Tool get_catalog — add-on pernapasan data-driven', () => {
    it('keluhan bapil + tanya harga → add-on nebulizer (dan moksa) tersedia di output', async () => {
      const out = await executeGetCatalog(
        { symptoms: ['batuk', 'pilek'], childAgeMonths: 6, inquirePrice: true },
        'default-tenant'
      );
      expect(out.success).toBe(true);
      const ids = out.treatments.map((t) => t.id);
      expect(ids).toContain('add-on-nebulizer');
      expect(ids).toContain('add-on-sinar-moksa');
    });

    it('tidak ada hafalan: output add-on berasal dari katalog DB (id nyata)', async () => {
      const out = await executeGetCatalog(
        { symptoms: ['batuk', 'pilek', 'dahak'], childAgeMonths: 12, inquirePrice: true },
        'default-tenant'
      );
      const addonIds = out.treatments.filter((t) => t.isAddon).map((t) => t.id);
      const catalogIds = new Set(treatmentCatalogService.getAllServices(true).map((s) => s.id));
      for (const id of addonIds) {
        expect(catalogIds.has(id)).toBe(true);
      }
      expect(addonIds.length).toBeGreaterThan(0);
    });

    it('mode konsultasi (tanpa harga) TIDAK membanjiri add-on (anti-brosur tetap ≤2)', async () => {
      const out = await executeGetCatalog(
        { symptoms: ['batuk', 'pilek'], childAgeMonths: 6 },
        'default-tenant'
      );
      expect(out.success).toBe(true);
      expect(out.treatments.length).toBeLessThanOrEqual(2);
    });
  });
});

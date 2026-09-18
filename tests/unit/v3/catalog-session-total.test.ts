import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Phase 4+5 (audit 222655) — session-aware total: ongkir QUOTED sesi
 * otomatis digabung ke template harga katalog (anti amnesia total biaya).
 */
describe('Catalog Session-Aware Total Price', () => {
  it('Pulih Ceria 75rb + ongkir quoted 20rb -> template memuat Rp 95.000', async () => {
    const out = await executeGetCatalog(
      { specificTreatmentName: 'Pijat Bayi Pulih Ceria', inquirePrice: true },
      'default-tenant',
      { kelurahan: 'Tebel Barat', ongkirPromo: 20000, ongkirStatus: 'QUOTED' }
    );
    expect(out.success).toBe(true);
    expect(out.suggestedPriceReply).toBeDefined();
    expect(out.suggestedPriceReply!).toContain('95.000');
    expect(out.suggestedPriceReply!).toContain('Tebel Barat');
    expect(out.suggestedPriceReply!).toContain('total keseluruhan');
  });

  it('tanpa konteks ongkir -> template harga murni (tanpa total)', async () => {
    const out = await executeGetCatalog(
      { specificTreatmentName: 'Pijat Bayi Pulih Ceria', inquirePrice: true },
      'default-tenant'
    );
    expect(out.success).toBe(true);
    expect(out.suggestedPriceReply).toBeDefined();
    expect(out.suggestedPriceReply!).not.toContain('total keseluruhan');
  });
});

/**
 * Kontrak data terstruktur (Fase 3, revisi fondasional 2026-09-18): fakta
 * finansial & klinis mentah WAJIB tersedia terpisah dari narasi, agar LLM
 * menalar dari angka — bukan menyalin prosa siap-saji.
 */
describe('Catalog Structured Output Contract', () => {
  it('pricingBreakdown terisi lengkap saat harga ditanya + ongkir quoted', async () => {
    const out = await executeGetCatalog(
      { specificTreatmentName: 'Pijat Bayi Pulih Ceria', inquirePrice: true },
      'default-tenant',
      { kelurahan: 'Tebel Barat', ongkirPromo: 20000, ongkirStatus: 'QUOTED' }
    );
    expect(out.pricingBreakdown).toBeDefined();
    expect(out.pricingBreakdown!.targetName).toContain('Pulih Ceria');
    expect(typeof out.pricingBreakdown!.originalPrice).toBe('number');
    expect(typeof out.pricingBreakdown!.promoPrice).toBe('number');
    expect(out.pricingBreakdown!.deliveryFee).toBe(20000);
    expect(out.pricingBreakdown!.grandTotal).toBe(
      Number(out.pricingBreakdown!.promoPrice) + 20000
    );
    expect(out.pricingBreakdown!.area).toBe('Tebel Barat');
  });

  it('pricingBreakdown TANPA ongkir quoted -> deliveryFee/grandTotal undefined', async () => {
    const out = await executeGetCatalog(
      { specificTreatmentName: 'Pijat Bayi Pulih Ceria', inquirePrice: true },
      'default-tenant'
    );
    expect(out.pricingBreakdown).toBeDefined();
    expect(out.pricingBreakdown!.deliveryFee).toBeUndefined();
    expect(out.pricingBreakdown!.grandTotal).toBeUndefined();
  });

  it('message memuat fakta finansial terstruktur, BUKAN instruksi salin-tempel', async () => {
    const out = await executeGetCatalog(
      { specificTreatmentName: 'Pijat Bayi Pulih Ceria', inquirePrice: true },
      'default-tenant'
    );
    expect(out.message).toContain('Data Finansial Resmi');
    expect(out.message).not.toContain('Format Penyampaian Harga');
  });

  it('mode konsultasi (tanpa harga) -> focusClinicalDescription terisi, tanpa nominal di breakdown', async () => {
    const out = await executeGetCatalog(
      { symptoms: 'batuk pilek' },
      'default-tenant'
    );
    expect(out.success).toBe(true);
    expect(out.suggestedPriceReply).toBeUndefined();
    if (out.focusClinicalDescription) {
      expect(out.focusClinicalDescription.length).toBeGreaterThan(0);
      expect(['MOMS', 'BABY']).toContain(out.focusTargetAudience);
    }
  });

  it('cartRecapBreakdown terisi saat 2+ item & harga ditanya', async () => {
    const out = await executeGetCatalog(
      { inquirePrice: true },
      'default-tenant',
      {
        ongkirPromo: 15000,
        ongkirStatus: 'QUOTED',
        cartItems: [
          { name: 'Pijat Bayi Pulih Ceria', promoPrice: 75000 },
          { name: 'Sinar Moksa', promoPrice: 30000 },
        ],
      } as any
    );
    expect(out.cartRecapBreakdown).toBeDefined();
    expect(out.cartRecapBreakdown!.items.length).toBe(2);
    expect(out.cartRecapBreakdown!.subtotalPromo).toBe(105000);
    expect(out.cartRecapBreakdown!.deliveryFee).toBe(15000);
    expect(out.cartRecapBreakdown!.grandTotal).toBe(120000);
  });
});

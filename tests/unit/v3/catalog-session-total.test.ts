import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Phase 4+5 (audit 222655) — session-aware total: ongkir QUOTED sesi
 * otomatis digabung ke template harga katalog (anti amnesia total biaya).
 */
describe('Catalog Session-Aware Total Price', () => {
  it('Pulih Ceria 70rb + ongkir quoted 20rb -> template memuat Rp 90.000', async () => {
    const out = await executeGetCatalog(
      { specificTreatmentName: 'Pijat Bayi Pulih Ceria', inquirePrice: true },
      'default-tenant',
      { kelurahan: 'Tebel Barat', ongkirPromo: 20000, ongkirStatus: 'QUOTED' }
    );
    expect(out.success).toBe(true);
    expect(out.suggestedPriceReply).toBeDefined();
    expect(out.suggestedPriceReply!).toContain('90.000');
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

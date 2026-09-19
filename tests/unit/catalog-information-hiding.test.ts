import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { deliveryService } from '../../src/services/delivery.service';

/**
 * Information Hiding — kontrak sesi 779408:
 * 1. HARGA PAKET/treatment DILARANG bocor bila customer belum tanya biaya
 *    (get-catalog mode konsultasi) — tetap berlaku.
 * 2. ONGKIR/JARAK: dibuka bila lokasi PRESISI terverifikasi; disembunyikan bila
 *    area masih luas (imprecise) atau di luar jangkauan.
 * Garis pertahanan = data dipotong fisik di tool, bukan kepatuhan prompt.
 */
describe('information-hiding — harga paket vs ongkir lokasi presisi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('get-catalog mode konsultasi: objek treatment tanpa harga + pesan tanpa nominal', async () => {
    const res: any = await executeGetCatalog(
      { symptoms: ['batuk'], inquirePrice: false },
      'default-tenant',
      undefined
    );
    expect(res.success).toBe(true);
    for (const t of res.treatments || []) {
      expect(t.originalPrice).toBeUndefined();
      expect(t.promoPrice).toBeUndefined();
    }
    expect(res.suggestedPriceReply == null).toBe(true);
    expect(res.cartTotalReply == null).toBe(true);
    expect(String(res.message || '')).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('calculate-delivery lokasi PRESISI tanpa asksDeliveryFee: jarak & ongkir dibuka (kontrak 779408)', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 28.33,
      ongkir: 30000,
      normalPrice: 35000,
      promoPrice: 30000,
      isOutOfCoverage: false,
      maxCoverageKm: 30,
      freeTierKm: 5,
      messageTemplate: '',
    } as any);
    const res: any = await executeCalculateDelivery({
      locationText: 'Pelemwatu Menganti Gresik',
      asksDeliveryFee: false,
    });
    expect(res.success).toBe(true);
    expect(res.isPrecise).toBe(true);
    expect(res.ongkirNormal).toBe(35000);
    expect(res.ongkirPromo).toBe(30000);
    expect(res.distanceKm).toBeCloseTo(28.33, 2);
    expect(String(res.suggestedTemplateReply || '')).toMatch(/Rp\s*[\d.]+/);
  });

  it('calculate-delivery area LUAS (imprecise): nominal & km disembunyikan', async () => {
    const res: any = await executeCalculateDelivery({
      locationText: 'Menganti Gresik',
      asksDeliveryFee: false,
    });
    expect(res.success).toBe(false);
    expect(res.isPrecise).toBe(false);
    expect(res.ongkirNormal).toBeUndefined();
    expect(res.ongkirPromo).toBeUndefined();
    expect(res.distanceKm).toBeUndefined();
    expect(String(res.message || '')).not.toMatch(/Rp\s*[\d.]+/);
    expect(String(res.message || '')).not.toMatch(/\d+[.,]\d+\s*km/);
  });

  it('calculate-delivery di luar jangkauan: tidak mengekspos ongkir promo dalam jangkauan', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 45,
      ongkir: 0,
      normalPrice: 0,
      promoPrice: 0,
      isOutOfCoverage: true,
      maxCoverageKm: 30,
      freeTierKm: 5,
      messageTemplate: '',
    } as any);
    const res: any = await executeCalculateDelivery({
      locationText: 'Pelemwatu Menganti Gresik',
      asksDeliveryFee: true,
    });
    expect(res.isOutOfCoverage).toBe(true);
    // Payload LLM tetap bersih dari __internal.
    const { ToolExecutionPipeline } = await import('../../src/v3/agent/pipeline/tool-pipeline');
    const llmPayload = ToolExecutionPipeline.buildLlmSafeToolPayload('calculate_delivery', res);
    expect(JSON.stringify(llmPayload)).not.toContain('__internal');
  });
});

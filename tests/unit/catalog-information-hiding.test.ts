import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { deliveryService } from '../../src/services/delivery.service';

/**
 * Strict Information Hiding (Rule 2): nominal rupiah DILARANG muncul di output
 * tool saat customer TIDAK bertanya harga/biaya. Garis pertahanan = data dipotong
 * fisik di tool, bukan kepatuhan prompt.
 */
describe('catalog-information-hiding — zero price leaks mode konsultasi', () => {
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

  it('calculate-delivery tanpa asksDeliveryFee: tanpa nominal rupiah', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 28.33,
      ongkir: 30000,
      normalPrice: 35000,
      promoPrice: 30000,
      isOutOfCoverage: false,
      messageTemplate: '',
    } as any);
    const res: any = await executeCalculateDelivery({
      locationText: 'Pelemwatu Menganti Gresik',
      asksDeliveryFee: false,
    });
    expect(res.success).toBe(true);
    expect(String(res.message || '')).not.toMatch(/Rp\s*[\d.]+/);
    expect(String(res.suggestedTemplateReply || '')).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('calculate-delivery tanpa asksDeliveryFee: payload JSON LLM TANPA ongkirNormal/ongkirPromo (anti-bocor key-value)', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 12.33,
      ongkir: 15000,
      normalPrice: 25000,
      promoPrice: 15000,
      isOutOfCoverage: false,
      messageTemplate: '',
    } as any);
    const res: any = await executeCalculateDelivery({
      locationText: 'Pelemwatu Menganti Gresik',
      asksDeliveryFee: false,
    });
    expect(res.success).toBe(true);
    // Bukti leak vector: properti nominal di payload tool yang dibaca LLM.
    expect(res.ongkirNormal).toBeUndefined();
    expect(res.ongkirPromo).toBeUndefined();
    // Aturan Emas: jarak km juga DILARANG bocor bila tidak ditanya.
    expect(res.distanceKm).toBeUndefined();
    // Nilai asli tetap tersimpan internal untuk state sesi.
    expect(res.__internalOngkirNormal).toBe(25000);
    expect(res.__internalOngkirPromo).toBe(15000);
    expect(res.__internalDistanceKm).toBeDefined();
    // Payload yang benar-benar dikirim ke LLM bersih dari key-value nominal.
    const { ToolExecutionPipeline } = await import('../../src/v3/agent/pipeline/tool-pipeline');
    const llmPayload = ToolExecutionPipeline.buildLlmSafeToolPayload('calculate_delivery', res);
    const serialized = JSON.stringify(llmPayload);
    expect(serialized).not.toContain('25000');
    expect(serialized).not.toContain('15000');
    expect(serialized).not.toContain('__internal');
  });

  it('calculate-delivery dengan asksDeliveryFee: nominal tampil normal', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 28.33,
      ongkir: 30000,
      normalPrice: 35000,
      promoPrice: 30000,
      isOutOfCoverage: false,
      messageTemplate: '',
    } as any);
    const res: any = await executeCalculateDelivery({
      locationText: 'Pelemwatu Menganti Gresik',
      asksDeliveryFee: true,
    });
    expect(res.success).toBe(true);
    expect(String(res.message || '')).toMatch(/Rp\s*[\d.]+/);
    expect(res.ongkirNormal).toBe(35000);
    expect(res.ongkirPromo).toBe(30000);
  });
});

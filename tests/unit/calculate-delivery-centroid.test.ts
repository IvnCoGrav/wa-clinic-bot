import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { deliveryService } from '../../src/services/delivery.service';

/**
 * Centroid fallback (kasus #26 Jambangan): kecamatan + detail spesifik
 * (perumahan/gang) DILARANG terjebak loop tanya kelurahan — kunci ke sentroid
 * kecamatan (success:true, isEstimatedCentroid:true) agar tersimpan ke sesi.
 */
describe('calculate_delivery — centroid fallback kecamatan + detail spesifik', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('"Jambangan Persada" → success + centroid Jambangan, tanpa todong kelurahan', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 9.5,
      ongkir: 15000,
      normalPrice: 20000,
      promoPrice: 15000,
      isOutOfCoverage: false,
      messageTemplate: '',
    } as any);
    const res: any = await executeCalculateDelivery({ locationText: 'Jambangan Persada' });
    expect(res.success).toBe(true);
    expect(res.isEstimatedCentroid).toBe(true);
    expect(res.kecamatan).toMatch(/Jambangan/i);
    // Mode konsultasi: distanceKm disembunyikan dari payload LLM → cek internal.
    expect(res.__internalDistanceKm).toBeCloseTo(9.5, 2);
    expect(String(res.message || '').toLowerCase()).not.toContain('kelurahan');
  });

  it('"Jambangan" polos (tanpa detail) → tetap minta kelurahan (success:false)', async () => {
    const res: any = await executeCalculateDelivery({ locationText: 'Jambangan' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/kelurahan/i);
  });
});

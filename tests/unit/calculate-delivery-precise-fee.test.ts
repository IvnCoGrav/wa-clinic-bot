import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { deliveryService } from '../../src/services/delivery.service';

/**
 * Kontrak Baru (keputusan user, sesi 779408): saat lokasi PRESISI terverifikasi
 * (isPrecise && bukan centroid && dalam jangkauan), jarak & ongkir promo
 * DIINFORMASIKAN — meskipun customer hanya menyebut lokasi tanpa menanya biaya.
 *
 * Yang tetap dilindungi: kecamatan LUAS (imprecise) & di luar jangkauan TIDAK
 * membocorkan nominal; centorid kecamatan (estimasi) juga tidak.
 */
describe('calculate_delivery — ongkir saat lokasi presisi (kontrak sesi 779408)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lokasi presisi TANPA tanya biaya → distanceKm & ongkirPromo tetap dibuka', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 5.51,
      ongkir: 20000,
      normalPrice: 25000,
      promoPrice: 20000,
      isOutOfCoverage: false,
      maxCoverageKm: 30,
      freeTierKm: 5,
      messageTemplate: '',
    } as any);

    const res = await executeCalculateDelivery({ locationText: 'Bungurasih' });
    expect(res.success).toBe(true);
    expect(res.isPrecise).toBe(true);
    expect(res.distanceKm).toBeCloseTo(5.51, 2);
    expect(res.ongkirPromo).toBe(20000);
    expect(res.ongkirNormal).toBe(25000);
  });

  it('kecamatan luas (imprecise) → TIDAK membocorkan nominal', async () => {
    const res = await executeCalculateDelivery({ locationText: 'Menganti Gresik' });
    expect(res.isPrecise).toBe(false);
    expect(res.success).toBe(false);
    expect(res.distanceKm).toBeUndefined();
    expect(res.ongkirPromo).toBeUndefined();
    expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('di luar jangkauan → tidak menyembunyikan status (tetap out of coverage, tanpa promo dalam jangkauan)', async () => {
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

    const res = await executeCalculateDelivery({ locationText: 'Pelemwatu Menganti Gresik' });
    expect(res.isOutOfCoverage).toBe(true);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { deliveryService } from '../../src/services/delivery.service';

/**
 * Pencegahan ongkir prematur pada kecamatan luas (arsitektur non-regex):
 * - "Menganti Gresik" (kecamatan, 22 desa) → isPrecise false + minta kelurahan,
 *   TANPA nominal km/ongkir, TANPA hijack Dukuh Sutorejo.
 * - "Pelemwatu Menganti Gresik" (desa spesifik) → presisi + hitung ongkir.
 * - Typo ringan "memganti" tetap dikenali sebagai Kecamatan Menganti (data-driven).
 */
describe('calculate_delivery — intersepsi kecamatan luas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('"Menganti Gresik" → imprecise + pesan kecamatan luas, tanpa nominal & tanpa Dukuh Sutorejo', async () => {
    const res = await executeCalculateDelivery({ locationText: 'Menganti Gresik' });
    expect(res.isPrecise).toBe(false);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Menganti/);
    expect(res.message).toMatch(/kecamatan.*luas|luas.*kecamatan/i);
    expect(res.message).toMatch(/kelurahan/i);
    expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
    expect(res.message).not.toMatch(/\d+[.,]\d+\s*km/);
    expect(res.message).not.toMatch(/Dukuh Sutorejo/i);
    expect(res.distanceKm).toBeUndefined();
  });

  it('"Saya memganti gresik" (typo) → tetap dikenali sebagai Kecamatan Menganti', async () => {
    const res = await executeCalculateDelivery({ locationText: 'Saya memganti gresik' });
    expect(res.isPrecise).toBe(false);
    expect(res.message).toMatch(/Menganti/);
    expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('"Pelemwatu Menganti Gresik" → presisi + kelurahan Pelemwatu + ongkir (±28 km live)', async () => {
    // Nilai rute jalan riil terverifikasi live (ORS): 28.33 km, promo Rp 30.000.
    // Offline (tanpa API key) Haversine×1.6 overshoot wilayah perbatasan, jadi
    // delivery di-mock ke angka rute riil; fokus test = presisi geocode + wiring tool.
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 28.33,
      ongkir: 30000,
      normalPrice: 35000,
      promoPrice: 30000,
      isOutOfCoverage: false,
      messageTemplate: '',
    } as any);

    const res = await executeCalculateDelivery({ locationText: 'Pelemwatu Menganti Gresik' });
    expect(res.success).toBe(true);
    expect(res.isPrecise).toBe(true);
    expect(res.kelurahan).toBe('Pelemwatu');
    expect(res.distanceKm).toBeCloseTo(28.33, 2);
    expect(res.ongkirPromo).toBe(30000);
    expect(res.isOutOfCoverage).toBe(false);
  });

  it('"Driyorejo Gresik" (kecamatan) → minta kelurahan; "Petiken Driyorejo" (desa) → presisi', async () => {
    const broad = await executeCalculateDelivery({ locationText: 'Driyorejo Gresik' });
    expect(broad.isPrecise).toBe(false);
    expect(broad.message).toMatch(/Driyorejo/);
    expect(broad.message).not.toMatch(/Rp\s*[\d.]+/);

    const precise = await executeCalculateDelivery({ locationText: 'Petiken Driyorejo' });
    expect(precise.success).toBe(true);
    expect(precise.isPrecise).toBe(true);
    expect(precise.kelurahan).toBe('Petiken');
  });
});

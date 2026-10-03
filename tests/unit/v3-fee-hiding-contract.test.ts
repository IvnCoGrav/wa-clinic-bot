import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { deliveryService } from '../../src/services/delivery.service';
import { ContextGrounder } from '../../src/v3/agent/pipeline/context-grounder';

/**
 * C.3 (audit #199) — "pertajamkan kontrak lama 779408":
 *  - Lokasi PRESISI & dalam jangkauan → nominal & jarak dibuka (kontrak lama dipertahankan).
 *  - Centroid kecamatan / kecamatan luas / luar jangkauan → nominal & jarak DILARANG bocor.
 *  - Grounding [LOKASI TERKUNCI] DILARANG menyuntik km bila lokasi hanya rawText kota luas.
 */
describe('C.3 — pertajam kontrak eksposur nominal/jarak', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lokasi presisi dalam jangkauan → nominal dibuka (kontrak lama dipertahankan)', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 5.51, ongkir: 20000, normalPrice: 25000, promoPrice: 20000,
      isOutOfCoverage: false, maxCoverageKm: 30, freeTierKm: 5, messageTemplate: '',
    } as any);
    const res: any = await executeCalculateDelivery({ locationText: 'Bungurasih' });
    expect(res.ongkirPromo).toBe(20000);
    expect(res.distanceKm).toBeCloseTo(5.51, 2);
  });

  it('kecamatan luas (imprecise) → nominal & jarak TIDAK bocor', async () => {
    const res: any = await executeCalculateDelivery({ locationText: 'Menganti Gresik' });
    expect(res.distanceKm).toBeUndefined();
    expect(res.ongkirPromo).toBeUndefined();
  });

  it('grounding: lokasi presisi boleh menyuntik km', () => {
    const text = ContextGrounder.buildContextSummary(
      { genderGreeting: 'Bunda', location: { kelurahan: 'Bungurasih', distanceKm: 5.5 } } as any,
      'halo', []
    );
    expect(text).toContain('LOKASI TERKUNCI');
    expect(text).toMatch(/5\.5 km/);
  });

  it('grounding: lokasi hanya rawText kota luas → TIDAK menyuntik km', () => {
    const text = ContextGrounder.buildContextSummary(
      { genderGreeting: 'Bunda', location: { rawText: 'Surabaya', distanceKm: 12 } } as any,
      'halo', []
    );
    expect(text).toContain('LOKASI TERKUNCI');
    expect(text).not.toMatch(/\d+\s*km/);
  });
});

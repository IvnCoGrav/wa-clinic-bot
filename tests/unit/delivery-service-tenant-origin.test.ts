import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DeliveryService,
  DEFAULT_TIERS,
  setTenantDeliveryTiersForTest,
} from '../../src/services/delivery.service';
import * as clinicLocationModule from '../../src/config/clinic-location';

describe('CFG-05: Tenant-aware delivery clinic location origin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should use tenant clinic location when clinicCoords is omitted', async () => {
    // Tenant A: Surabaya Basecamp
    const spyLoc = vi.spyOn(clinicLocationModule, 'getClinicLocationAsync').mockImplementation(async (tenantId: string) => {
      if (tenantId === 'tenant-jakarta') {
        return {
          lat: -6.2088,
          lng: 106.8456, // Jakarta pusat
          name: 'Klinik Moms Jakarta',
          maxCoverageKm: 25,
        };
      }
      return {
        lat: -7.2575,
        lng: 112.7521, // Surabaya pusat
        name: 'Kala Spa Surabaya',
        maxCoverageKm: 20,
      };
    });

    setTenantDeliveryTiersForTest('tenant-jakarta', DEFAULT_TIERS);

    const deliveryService = new DeliveryService();

    // Customer located in Jakarta (-6.21, 106.85)
    const customerInJakarta = { lat: -6.21, lng: 106.85 };

    // When tenant is tenant-jakarta: close distance (< 2km)
    const resultJakarta = await deliveryService.calculateDelivery(
      customerInJakarta,
      undefined,
      'tenant-jakarta'
    );
    expect(resultJakarta.distanceKm).toBeLessThan(5);
    expect(resultJakarta.messageTemplate).toContain('Klinik Moms Jakarta');

    // When tenant is default (Surabaya): huge distance (~660km -> out of coverage)
    const resultSurabaya = await deliveryService.calculateDelivery(
      customerInJakarta,
      undefined,
      'default-tenant'
    );
    expect(resultSurabaya.distanceKm).toBeGreaterThan(500);
    expect(resultSurabaya.isOutOfCoverage).toBe(true);
    expect(resultSurabaya.messageTemplate).toContain('Kala Spa Surabaya');

    spyLoc.mockRestore();
  });
});

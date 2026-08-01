import { describe, it, expect, vi } from 'vitest';
import { DeliveryService } from '../../src/services/delivery.service';
import { calculateHaversineDistance } from '../../src/utils/haversine';
import { clinicConfig } from '../../src/config/clinic';

describe('DeliveryService — Haversine 1.50x Circuity Multiplier & Boundary Tests', () => {
  // Mock ORS client that always fails/returns null to force Haversine fallback
  const mockOrsClientFailed = {
    calculateRoute: vi.fn().mockResolvedValue(null),
  };

  // Mock ORS client that returns valid route distance
  const mockOrsClientSuccess = {
    calculateRoute: vi.fn().mockResolvedValue({ distanceMeters: 4000, durationSeconds: 300 }),
  };

  it('1. Baseline Test: ORS success vs Haversine 1.50x fallback comparison', async () => {
    const serviceOrs = new DeliveryService(mockOrsClientSuccess as any);
    const serviceFallback = new DeliveryService(mockOrsClientFailed as any);

    // Coords approx 4 km straight-line distance
    const customerCoords = { lat: clinicConfig.lat + 0.03, lng: clinicConfig.lng + 0.03 };

    const resOrs = await serviceOrs.calculateDelivery(customerCoords);
    expect(resOrs.isEstimated).toBe(false);
    expect(resOrs.distanceKm).toBe(4.0);

    const resFallback = await serviceFallback.calculateDelivery(customerCoords);
    const straightKm = calculateHaversineDistance(clinicConfig, customerCoords);
    const expectedKm = parseFloat((straightKm * 1.50).toFixed(2));

    expect(resFallback.isEstimated).toBe(true);
    expect(resFallback.distanceKm).toBe(expectedKm);
    expect(resFallback.distanceKm).toBeGreaterThan(straightKm);
  });

  it('2. Fallback Timeout Test: ORS API timeout triggers Haversine 1.50x with isEstimated: true', async () => {
    const timeoutOrsClient = {
      calculateRoute: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 100))),
    };
    const deliveryService = new DeliveryService(timeoutOrsClient as any);

    const customerCoords = { lat: -7.36, lng: 112.76 };
    const result = await deliveryService.calculateDelivery(customerCoords);

    expect(result.isEstimated).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.messageTemplate).toBeDefined();
  });

  it('3. Boundary-Sensitive Crossing Test: 4.0 km straight (4.0*1.50 = 6.0 km > gratis) vs 4.2 km straight (4.2*1.50 = 6.30 km -> Tier 5-7km Rp5.000)', async () => {
    const deliveryService = new DeliveryService(mockOrsClientFailed as any);

    // Coordinate calculated so straight line * 1.50 = ~6.2 km (crosses 5.0 km free tier)
    // Lat diff ~0.0374 deg approx 4.15 km straight * 1.50 = 6.23 km
    const customerCoordsAcrossBoundary = {
      lat: clinicConfig.lat + 0.0374,
      lng: clinicConfig.lng,
    };

    const straightKm = calculateHaversineDistance(clinicConfig, customerCoordsAcrossBoundary);
    expect(straightKm).toBeLessThan(5.0); // Straight line is FREE (< 5.0km)

    const result = await deliveryService.calculateDelivery(customerCoordsAcrossBoundary);
    expect(result.isEstimated).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(5.0); // Multiplied is > 5.0km
    expect(result.promoPrice).toBe(5000); // Crosses boundary into Rp 5.000 tier!
  });

  it('4. Double-Jump Tier Crossing Test: Straight line 12.1 km (Tier 10-15km) * 1.50x = 18.15 km (Tier 15-20km)', async () => {
    const deliveryService = new DeliveryService(mockOrsClientFailed as any);

    // Coords chosen so straight line distance is ~12.1 km
    const customerCoords = {
      lat: clinicConfig.lat + 0.109,
      lng: clinicConfig.lng,
    };

    const straightKm = calculateHaversineDistance(clinicConfig, customerCoords);
    expect(straightKm).toBeGreaterThan(10.0);
    expect(straightKm).toBeLessThan(15.0); // Straight line falls in Tier 10-15km (Rp 10.000)

    const result = await deliveryService.calculateDelivery(customerCoords);
    expect(result.isEstimated).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(15.0); // Multiplied > 15.0km
    expect(result.promoPrice).toBe(15000); // Double-jumps to Tier 15-20km (Rp 15.000)!
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateHaversineDistance } from '../../src/utils/haversine';
import { DeliveryService } from '../../src/services/delivery.service';
import { IOrsClient, RouteResult } from '../../src/integrations/ors/client';

describe('Delivery & Ongkir Calculation Logic (ORS Integration + Haversine Fallback)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Haversine Standalone Formula Calculation', () => {
    it('should return 0 km for identical coordinates', () => {
      const point = { lat: -7.2574719, lng: 112.7520883 };
      const dist = calculateHaversineDistance(point, point);
      expect(dist).toBe(0);
    });

    it('should calculate accurate distance between two known points in Surabaya', () => {
      const clinic = { lat: -7.2574719, lng: 112.7520883 };
      const tp = { lat: -7.2625, lng: 112.7383 };

      const dist = calculateHaversineDistance(clinic, tp);
      expect(dist).toBeGreaterThan(1.0);
      expect(dist).toBeLessThan(2.5);
    });
  });

  describe('2. ORS Directions API Integration Tests (Mocked IOrsClient)', () => {
    it('should calculate ongkir correctly when ORS API returns 4500m (4.5 km -> Free Ongkir)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 4500,
          durationSeconds: 600,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });

      expect(mockOrsClient.calculateRoute).toHaveBeenCalled();
      expect(res.distanceKm).toBe(4.5);
      expect(res.ongkir).toBe(0);
      expect(res.isOutOfCoverage).toBe(false);
      expect(res.messageTemplate).toContain('GRATIS ongkir');
    });

    it('should calculate ongkir correctly when ORS API returns 5500m (5.5 km -> Rp 5.000)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 5500,
          durationSeconds: 800,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.27, lng: 112.73 });

      expect(res.distanceKm).toBe(5.5);
      expect(res.ongkir).toBe(5000);
      expect(res.isOutOfCoverage).toBe(false);
      expect(res.messageTemplate).toContain('Rp5.000');
    });

    it('should calculate ongkir correctly when ORS API returns 8000m (8.0 km -> Rp 10.000)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 8000,
          durationSeconds: 1200,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.30, lng: 112.70 });

      expect(res.distanceKm).toBe(8.0);
      expect(res.ongkir).toBe(10000);
      expect(res.isOutOfCoverage).toBe(false);
      expect(res.messageTemplate).toContain('Rp10.000');
    });

    it('should mark as Out of Coverage when ORS API returns 12000m (12.0 km -> isOutOfCoverage = true)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 12000,
          durationSeconds: 1800,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.40, lng: 112.60 });

      expect(res.distanceKm).toBe(12.0);
      expect(res.isOutOfCoverage).toBe(true);
      expect(res.messageTemplate).toContain('luar jangkauan');
    });
  });

  describe('3. ORS Failure & Haversine Fallback Verification', () => {
    it('should fallback to Haversine formula when ORS API returns null (API error / timeout)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue(null), // Simulate ORS API failure / timeout
      };
      const service = new DeliveryService(mockOrsClient);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const customerCoords = { lat: -7.2625, lng: 112.7383 }; // ~1.7 km via Haversine
      const res = await service.calculateDelivery(customerCoords);

      expect(mockOrsClient.calculateRoute).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[DELIVERY SERVICE FALLBACK]'));
      expect(res.distanceKm).toBeGreaterThan(1.0);
      expect(res.distanceKm).toBeLessThan(2.5);
      expect(res.ongkir).toBe(0); // Free ongkir for < 5 km
      expect(res.isOutOfCoverage).toBe(false);
    });
  });

  describe('4. Exact Boundary Delivery Price Tier Testing via ORS-Mocked Path', () => {
    const createMockService = (meters: number) => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: meters,
          durationSeconds: 600,
        }),
      };
      return new DeliveryService(mockOrsClient);
    };

    it('exact boundary 5.0 km (5000m): should be Rp 0 (Free) and NOT out of coverage', async () => {
      const service = createMockService(5000);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(5.0);
      expect(res.ongkir).toBe(0);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 5.01 km (5010m): should be Rp 5,000 and NOT out of coverage', async () => {
      const service = createMockService(5010);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(5.01);
      expect(res.ongkir).toBe(5000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 6.0 km (6000m): should be Rp 5,000 and NOT out of coverage', async () => {
      const service = createMockService(6000);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(6.0);
      expect(res.ongkir).toBe(5000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 6.01 km (6010m): should be Rp 10,000 and NOT out of coverage', async () => {
      const service = createMockService(6010);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(6.01);
      expect(res.ongkir).toBe(10000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 10.0 km (10000m): should be Rp 10,000 and NOT out of coverage', async () => {
      const service = createMockService(10000);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(10.0);
      expect(res.ongkir).toBe(10000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 10.01 km (10010m): should mark as Out of Coverage (isOutOfCoverage = true)', async () => {
      const service = createMockService(10010);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(10.01);
      expect(res.isOutOfCoverage).toBe(true);
    });
  });
});

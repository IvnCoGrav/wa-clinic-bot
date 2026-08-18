import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateHaversineDistance } from '../../src/utils/haversine';
import { DeliveryService } from '../../src/services/delivery.service';
import { IOrsClient } from '../../src/integrations/ors/client';

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
    it('should calculate ongkir correctly when ORS API returns 4500m (raw 4.5 km -> 4.95 km buffered -> Free Ongkir)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 4500,
          durationSeconds: 600,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });

      expect(mockOrsClient.calculateRoute).toHaveBeenCalled();
      expect(res.distanceKm).toBe(4.95);
      expect(res.ongkir).toBe(0);
      expect(res.isOutOfCoverage).toBe(false);
      expect(res.messageTemplate).toContain('GRATIS ongkir');
    });

    it('should calculate ongkir correctly when ORS API returns 5500m (raw 5.5 km -> 6.05 km buffered -> normal Rp 15.000, promo Rp 5.000)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 5500,
          durationSeconds: 800,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.27, lng: 112.73 });

      expect(res.distanceKm).toBe(6.05);
      expect(res.normalPrice).toBe(15000);
      expect(res.promoPrice).toBe(5000);
      expect(res.ongkir).toBe(5000);
      expect(res.isOutOfCoverage).toBe(false);
      expect(res.messageTemplate).toContain('Rp15.000');
      expect(res.messageTemplate).toContain('Rp5.000');
    });

    it('should calculate ongkir correctly when ORS API returns 8000m (raw 8.0 km -> 8.80 km buffered -> normal Rp 15.000, promo Rp 10.000)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 8000,
          durationSeconds: 1200,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.30, lng: 112.70 });

      expect(res.distanceKm).toBe(8.8);
      expect(res.normalPrice).toBe(15000);
      expect(res.promoPrice).toBe(10000);
      expect(res.ongkir).toBe(10000);
      expect(res.isOutOfCoverage).toBe(false);
      expect(res.messageTemplate).toContain('Rp15.000');
      expect(res.messageTemplate).toContain('Rp10.000');
    });

    it('should calculate ongkir correctly when ORS API returns 12000m (raw 12.0 km -> 13.20 km buffered -> normal Rp 25.000, promo Rp 15.000)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 12000,
          durationSeconds: 1800,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.40, lng: 112.60 });

      expect(res.distanceKm).toBe(13.2);
      expect(res.normalPrice).toBe(25000);
      expect(res.promoPrice).toBe(15000);
      expect(res.ongkir).toBe(15000);
      expect(res.isOutOfCoverage).toBe(false);
      expect(res.messageTemplate).toContain('Rp25.000');
      expect(res.messageTemplate).toContain('Rp15.000');
    });

    it('should mark as Out of Coverage when ORS API returns 32000m (raw 32.0 km -> 35.20 km buffered -> isOutOfCoverage = true)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 32000,
          durationSeconds: 3000,
        }),
      };
      const service = new DeliveryService(mockOrsClient);

      const res = await service.calculateDelivery({ lat: -7.50, lng: 112.40 });

      expect(res.distanceKm).toBe(35.2);
      expect(res.isOutOfCoverage).toBe(true);
      expect(res.messageTemplate).toContain('luar jangkauan');
    });
  });

  describe('3. ORS Failure & Haversine Fallback Verification', () => {
    it('should fallback to Haversine formula when ORS API returns null (API error / timeout)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue(null),
      };
      const service = new DeliveryService(mockOrsClient);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const customerCoords = { lat: -7.2625, lng: 112.7383 }; // ~1.7 km via Haversine
      const res = await service.calculateDelivery(customerCoords, { lat: -7.2574719, lng: 112.7520883 });

      expect(mockOrsClient.calculateRoute).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[DELIVERY SERVICE FALLBACK]'));
      expect(res.distanceKm).toBeGreaterThan(1.0);
      expect(res.distanceKm).toBeLessThan(3.0);
      expect(res.ongkir).toBe(0); // Free ongkir for < 5 km
      expect(res.isOutOfCoverage).toBe(false);
    });
  });

  describe('4. Exact Boundary Delivery Price Tier Testing via ORS-Mocked Path', () => {
    const createMockService = (targetKm: number) => {
      // Hitung raw meters agar setelah buffer 1.1x menghasilkan tepat targetKm
      const rawMeters = Math.round((targetKm / 1.1) * 1000);
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: rawMeters,
          durationSeconds: 600,
        }),
      };
      return new DeliveryService(mockOrsClient);
    };

    it('exact boundary 5.0 km: should be Rp 0 (Free) and NOT out of coverage', async () => {
      const service = createMockService(5.0);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(5.0);
      expect(res.ongkir).toBe(0);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 5.01 km: should be Rp 5,000 promo (Rp 15,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(5.01);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(5.01);
      expect(res.normalPrice).toBe(15000);
      expect(res.promoPrice).toBe(5000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 7.0 km: should be Rp 5,000 promo (Rp 15,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(7.0);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(7.0);
      expect(res.normalPrice).toBe(15000);
      expect(res.promoPrice).toBe(5000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 7.01 km: should be Rp 10,000 promo (Rp 15,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(7.01);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(7.01);
      expect(res.normalPrice).toBe(15000);
      expect(res.promoPrice).toBe(10000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 10.0 km: should be Rp 10,000 promo (Rp 15,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(10.0);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(10.0);
      expect(res.normalPrice).toBe(15000);
      expect(res.promoPrice).toBe(10000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 10.01 km: should be Rp 15,000 promo (Rp 25,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(10.01);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(10.01);
      expect(res.normalPrice).toBe(25000);
      expect(res.promoPrice).toBe(15000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 15.0 km: should be Rp 15,000 promo (Rp 25,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(15.0);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(15.0);
      expect(res.normalPrice).toBe(25000);
      expect(res.promoPrice).toBe(15000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 15.01 km: should be Rp 20,000 promo (Rp 25,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(15.01);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(15.01);
      expect(res.normalPrice).toBe(25000);
      expect(res.promoPrice).toBe(20000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 20.0 km: should be Rp 20,000 promo (Rp 25,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(20.0);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(20.0);
      expect(res.normalPrice).toBe(25000);
      expect(res.promoPrice).toBe(20000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 20.01 km: should be Rp 25,000 promo (Rp 35,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(20.01);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(20.01);
      expect(res.normalPrice).toBe(35000);
      expect(res.promoPrice).toBe(25000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 25.0 km: should be Rp 25,000 promo (Rp 35,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(25.0);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(25.0);
      expect(res.normalPrice).toBe(35000);
      expect(res.promoPrice).toBe(25000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 25.01 km: should be Rp 30,000 promo (Rp 35,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(25.01);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(25.01);
      expect(res.normalPrice).toBe(35000);
      expect(res.promoPrice).toBe(30000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 30.0 km: should be Rp 30,000 promo (Rp 35,000 normal) and NOT out of coverage', async () => {
      const service = createMockService(30.0);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(30.0);
      expect(res.normalPrice).toBe(35000);
      expect(res.promoPrice).toBe(30000);
      expect(res.isOutOfCoverage).toBe(false);
    });

    it('exact boundary 30.01 km: should mark as Out of Coverage (isOutOfCoverage = true)', async () => {
      const service = createMockService(30.01);
      const res = await service.calculateDelivery({ lat: -7.26, lng: 112.74 });
      expect(res.distanceKm).toBe(30.01);
      expect(res.isOutOfCoverage).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  GoogleDistanceMatrixClient,
  IGoogleDistanceClient,
} from '../../src/integrations/google-maps/distance-matrix.client';
import { DeliveryService } from '../../src/services/delivery.service';
import { IOrsClient } from '../../src/integrations/ors/client';

vi.mock('axios');
const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

describe('Google Maps Distance Matrix & 3-Tier Fallback Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GoogleDistanceMatrixClient', () => {
    it('returns null when API key is missing or empty', async () => {
      const client = new GoogleDistanceMatrixClient('');
      const res = await client.calculateDistance(-7.2575, 112.7521, -7.2891, 112.7984);
      expect(res).toBeNull();
    });

    it('returns null when API key is a mock key', async () => {
      const client = new GoogleDistanceMatrixClient('mock_key_test');
      const res = await client.calculateDistance(-7.2575, 112.7521, -7.2891, 112.7984);
      expect(res).toBeNull();
    });

    it('extracts distance and duration correctly on OK response', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: {
          status: 'OK',
          rows: [
            {
              elements: [
                {
                  status: 'OK',
                  distance: { value: 7500, text: '7.5 km' },
                  duration: { value: 960, text: '16 mins' },
                },
              ],
            },
          ],
        },
      });

      const client = new GoogleDistanceMatrixClient('AIzaSyValidTestKey');
      const res = await client.calculateDistance(-7.2575, 112.7521, -7.2891, 112.7984);

      expect(res).not.toBeNull();
      expect(res?.distanceMeters).toBe(7500);
      expect(res?.durationSeconds).toBe(960);

      // Pastikan mode driving dan avoid=tolls (khusus motor terapis) dikirimkan
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        expect.objectContaining({
          params: expect.objectContaining({
            mode: 'driving',
            avoid: 'tolls',
            key: 'AIzaSyValidTestKey',
          }),
        })
      );
    });

    it('returns null gracefully on non-OK status or network failure', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: {
          status: 'REQUEST_DENIED',
          error_message: 'The provided API key is invalid.',
        },
      });

      const client = new GoogleDistanceMatrixClient('AIzaSyInvalidKey');
      const res = await client.calculateDistance(-7.2575, 112.7521, -7.2891, 112.7984);
      expect(res).toBeNull();
    });
  });

  describe('DeliveryService 3-Tier Routing Fallback', () => {
    const mockClinicCoords = { lat: -7.2575, lng: 112.7521 };
    const mockCustomerCoords = { lat: -7.2891, lng: 112.7984 };

    it('Tier 1: uses OpenRouteService when available (Google Maps not called)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 8000,
          durationSeconds: 1200,
        }),
      };
      const mockGoogleClient: IGoogleDistanceClient = {
        calculateDistance: vi.fn(),
      };

      const deliveryService = new DeliveryService(mockOrsClient, mockGoogleClient);
      const result = await deliveryService.calculateDelivery(mockCustomerCoords, mockClinicCoords);

      expect(mockOrsClient.calculateRoute).toHaveBeenCalled();
      expect(mockGoogleClient.calculateDistance).not.toHaveBeenCalled();
      expect(result.isEstimated).toBe(false);
      expect(result.distanceKm).toBe(8.8); // 8 km * 1.1x buffer
    });

    it('Tier 2: falls back to Google Maps when ORS fails (Haversine not used)', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue(null), // ORS gagal
      };
      const mockGoogleClient: IGoogleDistanceClient = {
        calculateDistance: vi.fn().mockResolvedValue({
          distanceMeters: 6000,
          durationSeconds: 900,
        }),
      };

      const deliveryService = new DeliveryService(mockOrsClient, mockGoogleClient);
      const result = await deliveryService.calculateDelivery(mockCustomerCoords, mockClinicCoords);

      expect(mockOrsClient.calculateRoute).toHaveBeenCalled();
      expect(mockGoogleClient.calculateDistance).toHaveBeenCalled();
      expect(result.isEstimated).toBe(false);
      expect(result.distanceKm).toBe(6.6); // 6 km * 1.1x buffer
    });

    it('Tier 3: falls back to Haversine formula with circuity multiplier when both ORS and Google Maps fail', async () => {
      const mockOrsClient: IOrsClient = {
        calculateRoute: vi.fn().mockResolvedValue(null), // ORS gagal
      };
      const mockGoogleClient: IGoogleDistanceClient = {
        calculateDistance: vi.fn().mockResolvedValue(null), // Google Maps gagal
      };

      const deliveryService = new DeliveryService(mockOrsClient, mockGoogleClient);
      const result = await deliveryService.calculateDelivery(mockCustomerCoords, mockClinicCoords);

      expect(mockOrsClient.calculateRoute).toHaveBeenCalled();
      expect(mockGoogleClient.calculateDistance).toHaveBeenCalled();
      expect(result.isEstimated).toBe(true);
      expect(result.distanceKm).toBeGreaterThan(0);
    });
  });
});

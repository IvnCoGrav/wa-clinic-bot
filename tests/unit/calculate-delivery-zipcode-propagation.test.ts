import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/utils/google-maps-url-resolver', () => ({
  extractGoogleMapsUrls: vi.fn(),
  resolveGoogleMapsUrl: vi.fn(),
  extractAddressQueryFromUrlString: vi.fn(),
}));

import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { deliveryService } from '../../src/services/delivery.service';
import {
  extractGoogleMapsUrls,
  resolveGoogleMapsUrl,
} from '../../src/utils/google-maps-url-resolver';

const ZIP = '61254';
const BASE_LOCATION = {
  kelurahan: 'Sawotratap',
  kecamatan: 'Gedangan',
  kota: 'Kabupaten Sidoarjo',
  lat: -7.39,
  lng: 112.71,
  isPrecise: true,
};

const DELIVERY = {
  distanceKm: 8.4,
  ongkir: 15000,
  normalPrice: 25000,
  promoPrice: 15000,
  isOutOfCoverage: false,
  maxCoverageKm: 30,
  freeTierKm: 5,
};

describe('calculate_delivery — propagasi zipcode internal (anti-loss CAPI)', () => {
  beforeEach(() => {
    vi.mocked(extractGoogleMapsUrls).mockReset();
    vi.mocked(extractGoogleMapsUrls).mockReturnValue([]);
    vi.mocked(resolveGoogleMapsUrl).mockReset();
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({
      ...BASE_LOCATION,
      zipcode: ZIP,
    } as any);
    vi.spyOn(geocodingService, 'reverseGeocode').mockResolvedValue({
      ...BASE_LOCATION,
      zipcode: ZIP,
    } as any);
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue(DELIVERY as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('jalur teks/geocoding membawa __internalZipcode dan tidak membocorkannya sebagai field publik', async () => {
    const res: any = await executeCalculateDelivery({ locationText: 'Sawotratap' });

    expect(res.success).toBe(true);
    expect(res.__internalZipcode).toBe(ZIP);
    expect(res.zipcode).toBeUndefined();
  });

  it('jalur alamat tersimpan membawa zip dari gazetteer wilayah', async () => {
    const res: any = await executeCalculateDelivery({
      locationText: 'rumah',
      savedAddress: {
        id: 'addr-1',
        label: 'Rumah',
        address: 'Jl. Sawotratap',
        kelurahan: 'Sawotratap',
        kecamatan: 'Gedangan',
        kota: 'Kabupaten Sidoarjo',
        lat: -7.39,
        lng: 112.71,
      },
    });

    expect(res.success).toBe(true);
    expect(res.__internalZipcode).toBe(ZIP);
  });

  it('jalur URL Google Maps membawa zipcode dari reverse geocode', async () => {
    vi.mocked(extractGoogleMapsUrls).mockReturnValue(['https://maps.app.goo.gl/ABC123']);
    vi.mocked(resolveGoogleMapsUrl).mockResolvedValue({
      success: true,
      lat: -7.39,
      lng: 112.71,
    } as any);

    const res: any = await executeCalculateDelivery({
      locationText: 'Shareloc https://maps.app.goo.gl/ABC123',
    });

    expect(res.success).toBe(true);
    expect(res.__internalZipcode).toBe(ZIP);
  });

  it('jalur pin WhatsApp native membawa zipcode dari reverse geocode', async () => {
    const res: any = await executeCalculateDelivery({
      locationText: '[Shared Location: -7.39, 112.71]',
    });

    expect(res.success).toBe(true);
    expect(res.__internalZipcode).toBe(ZIP);
  });

  it('jalur kandidat lokasi yang dikonfirmasi membawa zipcode kandidat', async () => {
    const res: any = await executeCalculateDelivery({
      locationText: 'Sawotratap',
      incomingText: 'iya betul',
      pendingLocation: {
        kelurahan: 'Sawotratap',
        kecamatan: 'Gedangan',
        kota: 'Kabupaten Sidoarjo',
        lat: -7.39,
        lng: 112.71,
        zipcode: ZIP,
      },
    });

    expect(res.success).toBe(true);
    expect(res.__internalZipcode).toBe(ZIP);
  });

  it('reverse geocode tanpa zip tetap fallback ke gazetteer', async () => {
    vi.mocked(geocodingService.reverseGeocode).mockResolvedValue({
      ...BASE_LOCATION,
      zipcode: undefined,
    } as any);
    vi.mocked(extractGoogleMapsUrls).mockReturnValue(['https://maps.app.goo.gl/ABC123']);
    vi.mocked(resolveGoogleMapsUrl).mockResolvedValue({
      success: true,
      lat: -7.39,
      lng: 112.71,
    } as any);

    const res: any = await executeCalculateDelivery({
      locationText: 'Shareloc https://maps.app.goo.gl/ABC123',
    });

    expect(res.success).toBe(true);
    expect(res.__internalZipcode).toBe(ZIP);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { humanBackgroundEnrichmentService } from '../../src/services/human-background-enrichment.service';
import { customerService } from '../../src/services/customer.service';

vi.mock('../../src/services/customer.service', () => ({
  customerService: {
    getCustomerById: vi.fn(),
    updateCustomerLocation: vi.fn(),
    markShareLocationSent: vi.fn(),
  },
}));

vi.mock('../../src/services/delivery.service', () => ({
  getDeliveryTiersFromDb: vi.fn().mockResolvedValue([]),
  deliveryService: {
    calculateDelivery: vi.fn().mockResolvedValue({
      distanceKm: 16,
      ongkir: 20000,
      isOutOfCoverage: false,
    }),
    calculateOngkirByDistance: vi.fn().mockReturnValue({
      normalPrice: 25000,
      promoDiscount: 5000,
      isOutOfCoverage: false,
    }),
  },
}));

vi.mock('../../src/integrations/google-maps/geocoding', () => ({
  geocodingService: {
    reverseGeocode: vi.fn().mockResolvedValue({
      kelurahan: 'Kebraon',
      kecamatan: 'Karangpilang',
      kota: 'Surabaya',
      zipcode: '60222',
    }),
    geocodeText: vi.fn().mockResolvedValue({
      isPrecise: true,
      lat: -7.3278,
      lng: 112.6954,
      kelurahan: 'Kebraon',
      kecamatan: 'Karangpilang',
      kota: 'Surabaya',
    }),
  },
}));

describe('Human Background Enrichment Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enriches location from WhatsApp native GPS location pin', async () => {
    const ctx: any = {
      customer: { id: 'cust-1', phone: '628123456789' },
      incomingMessage: {
        type: 'location',
        location: { latitude: -7.3488, longitude: 112.7516 },
      },
    };

    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');
    expect(res.enriched).toBe(true);
    expect(res.reason).toBe('gps_pin');
    expect(customerService.updateCustomerLocation).toHaveBeenCalledWith(
      'cust-1',
      expect.objectContaining({
        lat: -7.3488,
        lng: 112.7516,
        isNativePin: true,
      }),
      'default-tenant'
    );
  });

  it('enriches location from Google Maps URL in customer text', async () => {
    const ctx: any = {
      customer: { id: 'cust-2', phone: '6281455029665', lat: null, lng: null, distance_km: null },
      incomingMessage: {
        type: 'text',
        text: {
          body: 'Alamat saya di Jl. Griya Kebraon AU 18 https://maps.google.com/?q=-7.3278912,112.6954231',
        },
      },
    };

    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');
    expect(res.enriched).toBe(true);
    expect(res.reason).toBe('google_maps_url');
    expect(customerService.updateCustomerLocation).toHaveBeenCalledWith(
      'cust-2',
      expect.objectContaining({
        lat: expect.closeTo(-7.32789, 4),
        lng: expect.closeTo(112.69542, 4),
        isNativePin: true,
      }),
      'default-tenant'
    );
  });

  it('enriches distance and ongkir from Admin CS outbound chat', async () => {
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: 'cust-3',
      phone: '6285794210526',
      distance_km: null,
      ongkir: null,
    } as any);

    const adminChat = 'Jika dilihat dari jaraknya kurang lebih 16km. Dari pricelist kami 10-20km ada tambahan ongkir 25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi 20.000 saja bunda. Jadi bisa ya bunda ☺️';
    const res = await humanBackgroundEnrichmentService.enrichFromAdminOutbound(adminChat, 'cust-3', 'default-tenant');

    expect(res.enriched).toBe(true);
    expect(res.reason).toBe('admin_chat_captured');
    expect(customerService.updateCustomerLocation).toHaveBeenCalledWith(
      'cust-3',
      expect.objectContaining({
        distanceKm: 16,
        ongkir: 20000,
      }),
      'default-tenant'
    );
  });
});

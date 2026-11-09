import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/utils/google-maps-url-resolver', () => ({
  extractGoogleMapsUrls: vi.fn((text: string) => {
    const matches = String(text || '').match(/https?:\/\/[^\s]+/g) || [];
    return matches.map((url) => url.replace(/[),.;]+$/, ''));
  }),
  resolveGoogleMapsUrl: vi.fn(),
  extractAddressQueryFromUrlString: vi.fn(() => null),
}));

vi.mock('../../src/services/customer.service', () => ({
  customerService: {
    getCustomerById: vi.fn(),
    updateCustomerLocation: vi.fn(),
    updateCustomer: vi.fn(),
    markShareLocationSent: vi.fn(),
    updateCustomerZipcodeIfEmpty: vi.fn(),
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
      zipcode: '60222',
    }),
  },
}));

vi.mock('../../src/services/message.service', () => ({
  messageService: { getRecentMessages: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/services/conversation.service', () => ({
  conversationService: {
    getOrCreateConversation: vi.fn().mockResolvedValue({ id: 'conv-1' }),
  },
}));

vi.mock('../../src/services/entity-extractor.service', () => ({
  EntityExtractor: {
    extract: vi.fn().mockResolvedValue({ intents: ['chitchat'], locationText: null, symptoms: [] }),
    preExtractDeterministic: vi.fn(),
  },
}));

import { humanBackgroundEnrichmentService } from '../../src/services/human-background-enrichment.service';
import { customerService } from '../../src/services/customer.service';
import { resolveGoogleMapsUrl } from '../../src/utils/google-maps-url-resolver';

describe('human-background-enrichment — Google Maps shortlink dengan kata pengantar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveGoogleMapsUrl).mockResolvedValue({
      success: true,
      lat: -7.3488,
      lng: 112.7516,
    } as any);
  });

  it('mengekstrak URL dari teks "Alamat & Shareloc: ..." sebelum resolve', async () => {
    const ctx: any = {
      customer: { id: 'cust-preface-1', phone: '628123456789', lat: null, lng: null, distance_km: null },
      incomingMessage: {
        type: 'text',
        text: {
          body: 'Alamat & Shareloc: https://maps.app.goo.gl/ABC123 ya kak, patokan pagar hitam',
        },
      },
      history: [],
    };

    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');

    expect(res).toEqual({ enriched: true, reason: 'google_maps_url' });
    // Bukti utama: resolver menerima URL bersih, BUKAN seluruh teks pesan.
    expect(resolveGoogleMapsUrl).toHaveBeenCalledWith('https://maps.app.goo.gl/ABC123');
    expect(customerService.updateCustomerLocation).toHaveBeenCalledWith(
      'cust-preface-1',
      expect.objectContaining({
        lat: -7.3488,
        lng: 112.7516,
        zipcode: '60222',
        isNativePin: true,
      }),
      'default-tenant'
    );
  });

  it('mencoba URL kedua bila URL pertama gagal di-resolve', async () => {
    vi.mocked(resolveGoogleMapsUrl).mockImplementation(async (url: string) => {
      if (url.includes('SECOND')) {
        return { success: true, lat: -7.35, lng: 112.75 } as any;
      }
      return { success: false, error: 'unresolvable' } as any;
    });

    const ctx: any = {
      customer: { id: 'cust-preface-2', phone: '628123456780', lat: null, lng: null, distance_km: null },
      incomingMessage: {
        type: 'text',
        text: {
          body: 'Dua shareloc: https://maps.app.goo.gl/FIRST lalu https://maps.app.goo.gl/SECOND',
        },
      },
      history: [],
    };

    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');

    expect(res).toEqual({ enriched: true, reason: 'google_maps_url' });
    expect(resolveGoogleMapsUrl).toHaveBeenCalledTimes(2);
    expect(resolveGoogleMapsUrl).toHaveBeenNthCalledWith(1, 'https://maps.app.goo.gl/FIRST');
    expect(resolveGoogleMapsUrl).toHaveBeenNthCalledWith(2, 'https://maps.app.goo.gl/SECOND');
  });
});

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
    getSavedAddresses: vi.fn(),
    upsertSavedAddress: vi.fn(),
    resolveActiveSavedAddress: vi.fn(),
  },
}));

vi.mock('../../src/services/delivery.service', () => ({
  getDeliveryTiersFromDb: vi.fn().mockResolvedValue([]),
  deliveryService: {
    calculateDelivery: vi.fn().mockResolvedValue({
      distanceKm: 2.43,
      ongkir: 0,
      isOutOfCoverage: false,
    }),
  },
}));

vi.mock('../../src/integrations/google-maps/geocoding', () => ({
  geocodingService: {
    reverseGeocode: vi.fn().mockResolvedValue({}),
    // Insiden 14 Nov: teks tempat dari URL tidak bisa di-geocode presisi.
    geocodeText: vi.fn().mockResolvedValue({ isPrecise: false }),
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
    preExtractDeterministic: vi.fn().mockReturnValue({ intents: ['chitchat'], locationText: null }),
  },
}));

import { humanBackgroundEnrichmentService } from '../../src/services/human-background-enrichment.service';
import { customerService } from '../../src/services/customer.service';
import { resolveGoogleMapsUrl } from '../../src/utils/google-maps-url-resolver';

const TENANT = 'default-tenant';

const cardRumah1: any = {
  id: '8bb123e9-6ffc-4044-8190-e7fd305fbed2',
  label: 'Rumah waru',
  address: 'jl tropodo 1 gg merah delima no.225A (rumah pertama abu putih)',
  kelurahan: 'Tropodo',
  kecamatan: 'waru',
  kota: 'sidoarjo',
  lat: -7.3588392,
  lng: 112.7583752,
  distanceKm: 2.13,
  ongkir: 0,
  locationSource: 'estimated_area',
  isPrimary: true,
  createdAt: '2026-11-08T12:40:36.828Z',
  lastUsedAt: '2026-11-08T13:30:35.326Z',
};

function baseCustomer(overrides: Record<string, any> = {}) {
  return {
    id: 'e3dd4dfc-73c2-4e86-a2a1-29841f93a557',
    phone: '6285852555576',
    kelurahan: 'Tropodo',
    kecamatan: 'waru',
    kota: 'sidoarjo',
    lat: -7.362224,
    lng: 112.754744,
    distance_km: 2.43,
    ongkir: 0,
    zipcode: '61256', // cegah jalur zip-gazetteer agar fokus pada attach alamat
    pending_zipcode: null,
    preferences: {},
    ...overrides,
  };
}

function textCtx(customer: any, body: string): any {
  return {
    customer,
    conversation: { id: 'conv-1' },
    incomingMessage: { type: 'text', text: { body } },
    history: [],
  };
}

describe('HUMAN ENRICH — identitas alamat (regresi 6285852555576)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveGoogleMapsUrl).mockResolvedValue({
      success: false,
      addressQuery: 'Efod Jaya Abadi. CV, Jl. Tropodo 1 No.225, Tropodo, Sidoarjo',
    } as any);
    vi.mocked(customerService.getSavedAddresses).mockResolvedValue([cardRumah1]);
    vi.mocked(customerService.upsertSavedAddress).mockImplementation(async (_id: string, input: any) => ({
      ...cardRumah1,
      ...input,
      id: input.id || 'new-card-id',
    }));
  });

  it('link Maps gagal resolve + teks alamat rumah yang SAMA → perbarui kartu lama, bukan buat kartu kedua', async () => {
    const res = await humanBackgroundEnrichmentService.enrichSync(
      textCtx(
        baseCustomer(),
        'https://maps.app.goo.gl/JTxKqgfNucwmENBG7\ntropodo 1 Gg merah delima no.225A'
      ),
      TENANT
    );

    expect(res).toEqual({ enriched: true, reason: 'address_text_existing_house' });
    expect(customerService.getSavedAddresses).toHaveBeenCalledWith(
      'e3dd4dfc-73c2-4e86-a2a1-29841f93a557',
      TENANT
    );
    expect(customerService.upsertSavedAddress).toHaveBeenCalledTimes(1);
    const [, input] = vi.mocked(customerService.upsertSavedAddress).mock.calls[0];
    expect(input.id).toBe(cardRumah1.id); // memperbarui kartu yang ada
    expect(String(input.address)).not.toMatch(/https?:\/\//); // URL tidak masuk kolom alamat
    expect(input.lat).toBe(cardRumah1.lat); // koordinat kartu lama dipertahankan
    expect(input.ongkir).toBe(cardRumah1.ongkir);
  });

  it('pesan HANYA berisi link (tanpa teks alamat) → tidak menulis kartu apa pun', async () => {
    const res = await humanBackgroundEnrichmentService.enrichSync(
      textCtx(baseCustomer(), 'https://maps.app.goo.gl/JTxKqgfNucwmENBG7'),
      TENANT
    );

    expect(res).toEqual({ enriched: false, reason: 'url_only_no_address' });
    expect(customerService.upsertSavedAddress).not.toHaveBeenCalled();
  });

  it('mencocokkan ke kartu NON-primary (bukan hanya kartu aktif)', async () => {
    const cardPrimaryRumahLain: any = {
      ...cardRumah1,
      id: 'primary-other',
      label: 'Rumah Gubeng',
      address: 'Jl. Jojoran 1 Perintis 2 dlm/25',
      kelurahan: 'Gubeng',
      kecamatan: 'gubeng',
      lat: -7.27384,
      lng: 112.7512,
      isPrimary: true,
    };
    const cardRumahWaru: any = { ...cardRumah1, isPrimary: false };
    vi.mocked(customerService.getSavedAddresses).mockResolvedValue([
      cardPrimaryRumahLain,
      cardRumahWaru,
    ]);

    const res = await humanBackgroundEnrichmentService.enrichSync(
      textCtx(baseCustomer(), 'tropodo 1 gg merah delima no 225a'),
      TENANT
    );

    expect(res.reason).toBe('address_text_existing_house');
    const [, input] = vi.mocked(customerService.upsertSavedAddress).mock.calls[0];
    expect(input.id).toBe(cardRumahWaru.id);
  });

  it('rumah BENAR-BENAR baru (nomor beda) → kartu sekunder tanpa koordinat & tanpa URL', async () => {
    const res = await humanBackgroundEnrichmentService.enrichSync(
      textCtx(
        baseCustomer(),
        'https://maps.app.goo.gl/xyz999\nJl. Tropodo 1 Gg merah delima no.300'
      ),
      TENANT
    );

    expect(res).toEqual({ enriched: true, reason: 'address_text_new_house' });
    const [, input] = vi.mocked(customerService.upsertSavedAddress).mock.calls[0];
    expect(input.id).toBeUndefined();
    expect(input.address).toContain('no.300');
    expect(String(input.address)).not.toMatch(/https?:\/\//);
    expect(input.lat).toBeNull();
    expect(input.lng).toBeNull();
    expect(input.ongkir).toBeNull();
    expect(input.isPrimary).toBe(false);
  });

  it('rumah-2 sah di jalan berbeda tetap dibuat sebagai kartu baru', async () => {
    const res = await humanBackgroundEnrichmentService.enrichSync(
      textCtx(baseCustomer(), 'Jl. Mawar No. 12, Grogol'),
      TENANT
    );

    expect(res.reason).toBe('address_text_new_house');
    const [, input] = vi.mocked(customerService.upsertSavedAddress).mock.calls[0];
    expect(input.id).toBeUndefined();
    expect(input.lat).toBeNull();
  });

  it('obrolan biasa (tanpa angka/blok) tidak melahirkan kartu alamat baru', async () => {
    const res = await humanBackgroundEnrichmentService.enrichSync(
      textCtx(baseCustomer(), 'nanti dikabari ya kak'),
      TENANT
    );

    expect(res.enriched).toBe(false);
    expect(customerService.upsertSavedAddress).not.toHaveBeenCalled();
  });

  it('preamble chat tanpa nomor rumah (hanya "GG") tidak dianggap alamat baru', async () => {
    const res = await humanBackgroundEnrichmentService.enrichSync(
      textCtx(baseCustomer(), 'Sesuai ini masuk GG merah delima rumah pertama putih abu'),
      TENANT
    );

    expect(res.enriched).toBe(false);
    expect(customerService.upsertSavedAddress).not.toHaveBeenCalled();
  });
});

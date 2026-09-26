import { describe, it, expect, vi, beforeEach } from 'vitest';
import { humanBackgroundEnrichmentService } from '../../src/services/human-background-enrichment.service';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';

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

vi.mock('../../src/services/message.service', () => ({
  messageService: {
    getRecentMessages: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/services/conversation.service', () => ({
  conversationService: {
    getOrCreateConversation: vi.fn().mockResolvedValue({ id: 'conv-1' }),
  },
}));

// RC-3: pastikan enrichSync TIDAK memanggil LLM (EntityExtractor.extract) saat lokasi
// sudah bisa diekstrak deterministik dari pesan customer yang sudah di HUMAN_HANDLING.
vi.mock('../../src/services/entity-extractor.service', () => ({
  EntityExtractor: {
    extract: vi.fn().mockResolvedValue({ intents: ['chitchat'], locationText: null, symptoms: [] }),
    preExtractDeterministic: vi.fn(),
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
    // Fase 3 (RC-4): angka chat admin = ESTIMATE → kolom resmi distance_km/ongkir TIDAK ditulis
    const dataArg3 = vi.mocked(customerService.updateCustomerLocation).mock.calls[0][1] as any;
    expect(dataArg3.distanceKm).toBeUndefined();
    expect(dataArg3.ongkir).toBeUndefined();
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({
            distance_estimate: expect.objectContaining({ km: 16, ongkir: 20000, by: 'admin_chat' }),
          }),
        }),
      })
    );
  });

  it('Prioritas 1: lokasi yang disebut Admin ("Wiguna Selatan") langsung di-geocode', async () => {
    const { geocodingService } = await import('../../src/integrations/google-maps/geocoding');
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: 'cust-4',
      phone: '6282245776662',
      kelurahan: null,
      distance_km: null,
      ongkir: null,
    } as any);

    const adminChat = 'Lebih dekat yang Wiguna Selatan Bunda, Jika dilihat dari jaraknya kurang lebih 6.8 km dari klinik ya bunda.';
    const res = await humanBackgroundEnrichmentService.enrichFromAdminOutbound(adminChat, 'cust-4', 'default-tenant');

    expect(res.enriched).toBe(true);
    // Geocode dipanggil langsung dengan lokasi rekomendasi Admin (bukan tebak riwayat)
    expect(geocodingService.geocodeText).toHaveBeenCalledWith('Wiguna Selatan');
    expect(customerService.updateCustomerLocation).toHaveBeenCalledWith(
      'cust-4',
      expect.objectContaining({
        kelurahan: 'Kebraon',
      }),
      'default-tenant'
    );
    // Fase 3 (RC-4): jarak admin = estimate, bukan fakta resmi
    const dataArg4 = vi.mocked(customerService.updateCustomerLocation).mock.calls[0][1] as any;
    expect(dataArg4.distanceKm).toBeUndefined();
    expect(dataArg4.ongkir).toBeUndefined();
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({
            distance_estimate: expect.objectContaining({ km: 6.8 }),
          }),
        }),
      })
    );
  });

  it('Prioritas 2: pesan inbound pertanyaan ("lokasinya dimana...") dilewati, tidak di-geocode', async () => {
    const { geocodingService } = await import('../../src/integrations/google-maps/geocoding');
    const { messageService } = await import('../../src/services/message.service');
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: 'cust-5',
      phone: '6289900112233',
      kelurahan: null,
      distance_km: null,
      ongkir: null,
    } as any);
    vi.mocked(messageService.getRecentMessages).mockResolvedValue([
      { direction: 'INBOUND', content: 'Siang kak mau tanya ini lokasinya dimana yg di sby' },
    ] as any);

    // Chat Admin tanpa sebutan lokasi (hanya jarak) → fallback riwayat, pertanyaan di-skip
    const adminChat = 'Jika dilihat dari jaraknya kurang lebih 6.8 km dari klinik ya bunda.';
    const res = await humanBackgroundEnrichmentService.enrichFromAdminOutbound(adminChat, 'cust-5', 'default-tenant');

    expect(res.enriched).toBe(true);
    expect(res.reason).toBe('admin_chat_captured');
    // Tidak ada geocode dari fragmen tanya; hanya update jarak/ongkir
    expect(geocodingService.geocodeText).not.toHaveBeenCalled();
    // Fase 3 (RC-4): jarak admin = estimate, bukan fakta resmi
    const dataArg5 = vi.mocked(customerService.updateCustomerLocation).mock.calls[0][1] as any;
    expect(dataArg5.distanceKm).toBeUndefined();
    expect(dataArg5.ongkir).toBeUndefined();
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({
            distance_estimate: expect.objectContaining({ km: 6.8 }),
          }),
        }),
      })
    );
  });

  // === RC-3 (Fase 3): enrichment saat HUMAN_HANDLING tidak boleh memanggil LLM ===
  it('RC-3: lokasi terdeteksi deterministik → TIDAK memanggil LLM (EntityExtractor.extract)', async () => {
    const { EntityExtractor } = await import('../../src/services/entity-extractor.service');
    vi.mocked(EntityExtractor.preExtractDeterministic).mockReturnValue({
      intents: ['provide_location'],
      locationText: 'Kebraon, Karangpilang',
      streetDetail: null,
      symptoms: [],
    } as any);

    const ctx: any = {
      customer: {
        id: 'cust-6',
        phone: '6289900112200',
        lat: null,
        lng: null,
        distance_km: null,
        zipcode: null,
        pending_zipcode: null,
      },
      conversation: { id: 'conv-1' },
      incomingMessage: { type: 'text', text: { body: 'Rumah saya di Kebraon Karangpilang ya kak' } },
      history: [],
    };

    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');

    // Jalur deterministik dipakai; LLM TIDAK dipanggil sama sekali.
    expect(EntityExtractor.preExtractDeterministic).toHaveBeenCalled();
    expect(EntityExtractor.extract).not.toHaveBeenCalled();
    expect(res.enriched).toBe(true);
  });

  it('RC-3: deterministik kosong & lokasi sudah ada → tetap TIDAK memanggil LLM', async () => {
    const { EntityExtractor } = await import('../../src/services/entity-extractor.service');
    vi.mocked(EntityExtractor.preExtractDeterministic).mockReturnValue({
      intents: ['chitchat'],
      locationText: null,
      streetDetail: null,
      symptoms: [],
    } as any);

    const ctx: any = {
      customer: {
        id: 'cust-7',
        phone: '6289900112201',
        lat: -7.34,
        lng: 112.75,
        distance_km: 12,
        zipcode: '60222',
        pending_zipcode: null,
      },
      conversation: { id: 'conv-1' },
      incomingMessage: { type: 'text', text: { body: 'nanti dikabari ya kak' } },
      history: [],
    };

    await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');

    expect(EntityExtractor.extract).not.toHaveBeenCalled();
  });

  // === FASE 3 — RC-4 "estimasi admin ≠ fakta" (G3, tanpa migrasi DB) ===
  it('Fase 3.1: belum punya koordinat presisi → distance_km/ongkir resmi TIDAK ditulis; angka jadi preferences.distance_estimate + log', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: 'cust-f3a',
      phone: '628111111111',
      kelurahan: 'Kebraon',
      lat: null,
      lng: null,
      distance_km: 5.1,
      ongkir: 10000,
      is_out_of_coverage: true,
      share_location_sent: false,
      preferences: { existing_key: 'kept' },
    } as any);

    const res = await humanBackgroundEnrichmentService.enrichFromAdminOutbound(
      'Jika dilihat dari jaraknya kurang lebih 6.8 km dari klinik ya bunda.',
      'cust-f3a',
      'default-tenant'
    );

    expect(res.enriched).toBe(true);
    // 1. Kolom fakta resmi TIDAK ditimpa (undefined → dipertahankan oleh updateCustomerLocation),
    //    termasuk flag is_out_of_coverage yang sudah ada (tulis estimate tidak boleh membatalkan fakta).
    const dataArg = vi.mocked(customerService.updateCustomerLocation).mock.calls[0][1] as any;
    expect(dataArg.distanceKm).toBeUndefined();
    expect(dataArg.ongkir).toBeUndefined();
    expect(dataArg.isOutOfCoverage).toBe(true);
    // 2. Angka admin disimpan sebagai ESTIMATE di preferences (merge, key lain tetap utuh)
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({
            existing_key: 'kept',
            distance_estimate: expect.objectContaining({
              km: 6.8,
              ongkir: 20000, // tier fallback mock: 25000 - 5000
              by: 'admin_chat',
              at: expect.any(String),
            }),
          }),
        }),
      })
    );
    // 3. Gagal simpan estimate (DB offline di test = prisma reject) TIDAK mematikan enrich
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[ADMIN DISTANCE ESTIMATE]'));
    logSpy.mockRestore();
  });

  it('Fase 3: sudah punya GPS presisi (share_location_sent) → jarak dihitung ULANG dari koordinat, angka chat admin DIABAIKAN, lat/lng tidak dikirim', async () => {
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: 'cust-f3b',
      phone: '628222222222',
      kelurahan: 'Kebraon',
      lat: -7.3488,
      lng: 112.7516,
      distance_km: 4.9,
      ongkir: 15000,
      is_out_of_coverage: false,
      share_location_sent: true,
      preferences: {},
    } as any);

    const res = await humanBackgroundEnrichmentService.enrichFromAdminOutbound(
      'Jaraknya kurang lebih 6.8 km ya, ongkir 15.000 saja ya bunda.',
      'cust-f3b',
      'default-tenant'
    );

    expect(res.enriched).toBe(true);
    const dataArg = vi.mocked(customerService.updateCustomerLocation).mock.calls[0][1] as any;
    // Nilai mock calculateDelivery (16/20000) — BUKAN angka chat (6.8/15000) BUKAN nilai lama (4.9/15000)
    expect(dataArg.distanceKm).toBe(16);
    expect(dataArg.ongkir).toBe(20000);
    expect(dataArg.isOutOfCoverage).toBe(false);
    // Otoritas koordinat: lat/lng tidak ikut dikirim (admin-geocode area pun tidak menimpa GPS)
    expect(dataArg.lat).toBeUndefined();
    expect(dataArg.lng).toBeUndefined();
    expect(dataArg.isNativePin).toBe(true);
    // Angka chat admin diabaikan total untuk customer GPS (tidak jadi estimate pun)
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('Fase 3: GPS presisi tapi calculateDelivery gagal → kolom jarak tidak ditulis (nilai lama dipertahankan), enrich tetap sukses', async () => {
    const { deliveryService } = await import('../../src/services/delivery.service');
    vi.mocked(deliveryService.calculateDelivery).mockRejectedValueOnce(new Error('ORS down'));
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: 'cust-f3c',
      phone: '628333333333',
      kelurahan: 'Kebraon',
      lat: -7.3488,
      lng: 112.7516,
      distance_km: 4.9,
      ongkir: 15000,
      is_out_of_coverage: true,
      share_location_sent: true,
      preferences: {},
    } as any);

    const res = await humanBackgroundEnrichmentService.enrichFromAdminOutbound(
      'Jaraknya kurang lebih 6.8 km ya dari klinik ya bunda.',
      'cust-f3c',
      'default-tenant'
    );

    expect(res.enriched).toBe(true);
    const dataArg = vi.mocked(customerService.updateCustomerLocation).mock.calls[0][1] as any;
    expect(dataArg.distanceKm).toBeUndefined();
    expect(dataArg.ongkir).toBeUndefined();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('Fase 3 edge: chat admin hanya menyebut ongkir (tanpa jarak) → resmi tidak ditulis, estimate {km:null, ongkir:15000}', async () => {
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: 'cust-f3d',
      phone: '628444444444',
      kelurahan: 'Kebraon',
      lat: null,
      lng: null,
      distance_km: 5.1,
      ongkir: 10000,
      is_out_of_coverage: false,
      share_location_sent: false,
      preferences: {},
    } as any);

    const res = await humanBackgroundEnrichmentService.enrichFromAdminOutbound(
      'Ongkir 15.000 saja ya bunda.',
      'cust-f3d',
      'default-tenant'
    );

    expect(res.enriched).toBe(true);
    const dataArg = vi.mocked(customerService.updateCustomerLocation).mock.calls[0][1] as any;
    expect(dataArg.distanceKm).toBeUndefined();
    expect(dataArg.ongkir).toBeUndefined();
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({
            distance_estimate: expect.objectContaining({ km: null, ongkir: 15000 }),
          }),
        }),
      })
    );
  });
});

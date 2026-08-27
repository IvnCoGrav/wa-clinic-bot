import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/integrations/google-maps/geocoding', () => ({
  geocodingService: {
    geocodeText: vi.fn(async (q: string) => {
      if (q.toLowerCase().includes('sawotratap')) return { isPrecise: true, kelurahan: 'Sawotratap', kecamatan: 'Gedangan', kota: 'Kabupaten Sidoarjo', lat: -7.3708486, lng: 112.7301098, zipcode: '61254' };
      if (q.toLowerCase().includes('medokan')) return { isPrecise: true, kelurahan: 'Medokan Ayu', kecamatan: 'Rungkut', kota: 'Kota Surabaya', lat: -7.32, lng: 112.78, zipcode: '60295' };
      return { isPrecise: false };
    }),
    reverseGeocode: vi.fn(async (lat: number, lng: number) => ({ isPrecise: true, kelurahan: 'Gubeng', kecamatan: 'Gubeng', kota: 'Kota Surabaya', lat, lng, zipcode: '60281' })),
  },
}));
vi.mock('../../src/services/delivery.service', () => ({
  deliveryService: { calculateDelivery: vi.fn(async () => ({ distanceKm: 5.03, ongkir: 5000, normalPrice: 15000, promoPrice: 5000, isOutOfCoverage: false })) },
}));
const mockUpdate = vi.fn(async () => ({}));
const mockMark = vi.fn(async () => ({}));
vi.mock('../../src/services/customer.service', () => ({
  customerService: { updateCustomerLocation: mockUpdate, markShareLocationSent: mockMark },
}));
vi.mock('../../src/slot-engine/entity-extractor', () => ({
  EntityExtractor: {
    extract: vi.fn(async (text: string) => {
      const lower = text.toLowerCase();
      if (lower.includes('sawotratap') || lower.includes('medokan')) return { intents: ['provide_location'], locationText: lower.includes('sawotratap') ? 'Sawotratap' : 'Medokan Ayu', streetDetail: null, childAgeMonths: null, symptoms: [], treatmentReferenced: null, preferredDateText: null, preferredTimeText: null, customerName: null, isMedicalEmergency: false, confidenceScore: 0.9 };
      if (lower.includes('makasih') || lower.includes('oke')) return { intents: ['chitchat'], locationText: null, streetDetail: null, childAgeMonths: null, symptoms: [], treatmentReferenced: null, preferredDateText: null, preferredTimeText: null, customerName: null, isMedicalEmergency: false, confidenceScore: 0.9 };
      return { intents: ['chitchat'], locationText: null, streetDetail: null, childAgeMonths: null, symptoms: [], treatmentReferenced: null, preferredDateText: null, preferredTimeText: null, customerName: null, isMedicalEmergency: false, confidenceScore: 0.9 };
    }),
  },
}));
vi.mock('../../src/utils/reservation-text-parser', async () => {
  const actual: any = await vi.importActual('../../src/utils/reservation-text-parser');
  return actual;
});

import { humanBackgroundEnrichmentService } from '../../src/services/human-background-enrichment.service';

function ctxOf(overrides: any = {}) {
  return {
    customer: { id: 'cust1', phone: '6281111111111', tenant_id: 'default-tenant', lat: null, lng: null, distance_km: null, share_location_sent: false, kecamatan: null, ...overrides.customer },
    conversation: { id: 'conv1', ...overrides.conversation },
    incomingMessage: { text: { body: overrides.text || '' }, type: 'text', ...overrides.incomingMessage },
    history: [],
    tenantId: 'default-tenant',
    ...overrides,
  } as any;
}

describe('human-background-enrichment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enriches text Sawotratap saat human handling', async () => {
    const ctx = ctxOf({ text: 'Jl anusanata No.19 Sawotratap Gedangan Sidoarjo', customer: { lat: null, lng: null, distance_km: null } });
    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');
    expect(res.enriched).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
    const args = mockUpdate.mock.calls[0];
    expect(args[1].kelurahan).toBe('Sawotratap');
    expect(args[1].distanceKm).toBe(5.03);
  });

  it('skip jika sudah punya lokasi', async () => {
    const ctx = ctxOf({ text: 'Sawotratap', customer: { lat: -7.37, lng: 112.73, distance_km: 5.03 } });
    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('already_has_location');
  });

  it('skip filler makasih', async () => {
    const ctx = ctxOf({ text: 'makasih', customer: { lat: null, lng: null, distance_km: null } });
    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');
    expect(res.enriched).toBe(false);
  });

  it('enriches GPS pin', async () => {
    const ctx = ctxOf({ customer: { lat: null, lng: null, distance_km: null }, incomingMessage: { type: 'location', location: { latitude: -7.37, longitude: 112.73 }, text: {} } });
    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');
    expect(res.enriched).toBe(true);
    expect(mockMark).toHaveBeenCalled();
  });

  it('form reservasi geocode jika belum punya lokasi', async () => {
    const form = `Berikut list untuk reservasi :\nNama Bunda: Mukodimatul Hikma\nAlamat & Shareloc : Jl Anusanata No.19\nKec : Sawotratap\nKota : Sidoarjo\nNama Bayi : Jennaira\nUsia Bayi/Anak : 14 Bulan\nTreatment : Pijat bayi ceria + Cukur`;
    const ctx = ctxOf({ text: form, customer: { lat: null, lng: null, distance_km: null, share_location_sent: false } });
    const res = await humanBackgroundEnrichmentService.enrichSync(ctx, 'default-tenant');
    expect(res.enriched).toBe(true);
  });
});

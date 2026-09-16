import { describe, it, expect, beforeEach, vi } from 'vitest';

// PLAN 8 FASE 5a: TIDAK lagi me-mock db/client di level file (menyebabkan instance
// ganda vs mock setup.ts sehingga assignment tak terlihat repository).
// Mengandalkan mock global setup.ts + override per-test via vi.mocked().
import { prisma } from '../../src/db/client';

vi.mock('../../src/services/delivery.service', async () => {
  const actual = await vi.importActual<any>('../../src/services/delivery.service');
  return {
    ...actual,
    deliveryService: {
      calculateDelivery: vi.fn().mockResolvedValue({
        distanceKm: 8.45,
        ongkir: 15000,
        normalPrice: 25000,
        promoPrice: 15000,
        isOutOfCoverage: false,
        promoDiscount: 10000,
        messageTemplate: 'test',
      }),
    },
  };
});

vi.mock('../../src/integrations/google-maps/geocoding', () => ({
  geocodingService: {
    reverseGeocode: vi.fn().mockResolvedValue({ kelurahan: 'Gedangan', kecamatan: 'Gedangan', kota: 'Kabupaten Sidoarjo', zipcode: '61254', isPrecise: true }),
    geocodeText: vi.fn().mockResolvedValue({ isPrecise: true, lat: -7.39, lng: 112.71, kelurahan: 'Gedangan', kecamatan: 'Gedangan', kota: 'Kabupaten Sidoarjo' }),
  },
}));

describe('Customer Location Refresh — Hierarchy of Truth', () => {
  let customerService: any;
  let prisma: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    // PLAN 8 FASE 5a: test ini mengendalikan perilaku via mock prisma.customer langsung,
    // sehingga memakai adapter Postgres (dengan Prisma ter-mock), bukan InMemory.
    const { resetCustomerRepository } = await import('../../src/repositories/customer.repository');
    resetCustomerRepository();
    prisma = (await import('../../src/db/client')).prisma;
    const mod = await import('../../src/services/customer.service');
    customerService = mod.customerService;
    // ensure delivery mock still returns default
    const { deliveryService } = await import('../../src/services/delivery.service');
    (deliveryService.calculateDelivery as any).mockResolvedValue({
      distanceKm: 8.45,
      ongkir: 15000,
      normalPrice: 25000,
      promoPrice: 15000,
      isOutOfCoverage: false,
    });
    const { geocodingService } = await import('../../src/integrations/google-maps/geocoding');
    (geocodingService.reverseGeocode as any).mockResolvedValue({ kelurahan: 'Gedangan', kecamatan: 'Gedangan', kota: 'Kabupaten Sidoarjo', zipcode: '61254', isPrecise: true });
    (geocodingService.geocodeText as any).mockResolvedValue({ isPrecise: true, lat: -7.39, lng: 112.71, kelurahan: 'Gedangan', kecamatan: 'Gedangan', kota: 'Kabupaten Sidoarjo' });
  });

  const baseCustomer = {
    id: 'cust-refresh-1',
    tenant_id: 'default-tenant',
    phone: '6281234567890',
    name: 'Bunda Test',
    kelurahan: 'Gedangan',
    kecamatan: 'Gedangan',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.3,
    lng: 112.7,
    distance_km: 5,
    ongkir: 5000,
    is_out_of_coverage: false,
    share_location_sent: true,
    preferences: {},
  };

  function makeMsg(overrides: any) {
    return {
      id: `msg_${Math.random()}`,
      conversation_id: 'conv1',
      tenant_id: 'default-tenant',
      direction: 'INBOUND',
      content: '',
      sender_type: 'CUSTOMER',
      sender_name: 'Bunda',
      payload_raw: {},
      created_at: new Date(),
      ...overrides,
    };
  }

  it('Tier1: bila ada koordinat dari bidan, pilih bidan (paling valid)', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer);
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([{ id: 'conv1' }]);
    vi.mocked(prisma.customer.update).mockResolvedValue({ ...baseCustomer });
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      makeMsg({ direction: 'INBOUND', content: '[LOCATION SHARE: Lat -7.3900, Lng 112.7300]', sender_type: 'CUSTOMER', created_at: new Date('2026-09-01T10:00:00Z') }),
      makeMsg({ direction: 'OUTBOUND', content: '[LOCATION SHARE: Lat -7.3456, Lng 112.7890]', sender_type: 'STAFF', sender_name: 'Bidan Yusi', created_at: new Date('2026-09-06T10:00:00Z') }),
    ]);

    const res = await customerService.refreshCustomerLocationAndOngkir('cust-refresh-1', 'default-tenant', 'admin@test.com');
    expect(res.success).toBe(true);
    expect(res.data?.source).toBe('bidan_shareloc');
    expect(res.data?.lat).toBeCloseTo(-7.3456);
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cust-refresh-1' }, data: expect.objectContaining({ lat: -7.3456 }) }));
  });

  it('Tier2: bila hanya customer shareloc, pilih customer', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ ...baseCustomer, share_location_sent: false });
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([{ id: 'conv1' }]);
    vi.mocked(prisma.customer.update).mockResolvedValue({ ...baseCustomer });
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      makeMsg({ direction: 'INBOUND', content: 'https://maps.app.goo.gl/test', sender_type: 'CUSTOMER', payload_raw: { location: { latitude: -7.35, longitude: 112.75 } } }),
    ]);

    const res = await customerService.refreshCustomerLocationAndOngkir('cust-refresh-1', 'default-tenant');
    expect(res.success).toBe(true);
    expect(res.data?.source).toBe('customer_shareloc');
  });

  it('Tier3: bila tidak ada shareloc tapi ada DB coords, pakai DB', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer);
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([{ id: 'conv1' }]);
    vi.mocked(prisma.customer.update).mockResolvedValue({ ...baseCustomer });
    vi.mocked(prisma.message.findMany).mockResolvedValue([]);

    const res = await customerService.refreshCustomerLocationAndOngkir('cust-refresh-1', 'default-tenant');
    expect(res.success).toBe(true);
    expect(res.data?.source).toBe('db_coords');
    expect(res.data?.lat).toBe(baseCustomer.lat);
  });

  it('Tier4: bila tidak ada GPS sama sekali, fallback geocoding', async () => {
    const noCoordCustomer = { ...baseCustomer, lat: null, lng: null, kelurahan: 'Gedangan', kecamatan: 'Gedangan', kota: 'Kabupaten Sidoarjo' };
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(noCoordCustomer);
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([{ id: 'conv1' }]);
    vi.mocked(prisma.customer.update).mockResolvedValue({ ...noCoordCustomer });
    vi.mocked(prisma.message.findMany).mockResolvedValue([]);

    const res = await customerService.refreshCustomerLocationAndOngkir('cust-refresh-1', 'default-tenant');
    expect(res.success).toBe(true);
    expect(res.data?.source).toBe('geocoding');
  });

  it('kalkulasi ongkir & jarak ter-update', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer);
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([{ id: 'conv1' }]);
    vi.mocked(prisma.customer.update).mockResolvedValue({ ...baseCustomer });
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      makeMsg({ direction: 'OUTBOUND', sender_type: 'BIDAN', content: '[LOCATION SHARE: Lat -7.4000, Lng 112.8000]' }),
    ]);

    const res = await customerService.refreshCustomerLocationAndOngkir('cust-refresh-1', 'default-tenant');
    expect(res.data?.distanceKm).toBe(8.45);
    expect(res.data?.ongkir).toBe(15000);
    expect(res.data?.isOutOfCoverage).toBe(false);
  });
});

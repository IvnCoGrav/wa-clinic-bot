import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickGpsTier, locationIngestService } from '../../src/services/location-ingest.service';
import { customerService } from '../../src/services/customer.service';

vi.mock('../../src/services/customer.service', () => ({
  customerService: {
    updateCustomerLocation: vi.fn(),
    markShareLocationSent: vi.fn(),
  },
}));

vi.mock('../../src/services/audit.service', () => ({
  auditService: {
    logAdminAction: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../src/services/delivery.service', () => ({
  getDeliveryTiersFromDb: vi.fn().mockResolvedValue([]),
  deliveryService: {
    calculateDelivery: vi.fn().mockResolvedValue({
      distanceKm: 6.86,
      ongkir: 5000,
      isOutOfCoverage: false,
    }),
  },
}));

vi.mock('../../src/integrations/google-maps/geocoding', () => ({
  geocodingService: {
    reverseGeocode: vi.fn().mockResolvedValue({
      kelurahan: 'Sambikerep',
      kecamatan: 'Sambikerep',
      kota: 'Surabaya',
      zipcode: '60219',
    }),
  },
}));

/**
 * Lokasi ingest — kontrak tunggal untuk semua penulis koordinat GPS.
 * Kasus nyata (Bunda Agatha, 25 Sep 2026 13:39:36 UTC):
 *   GPS pin masuk saat customer SUDAH punya lokasi + share_location_sent=true,
 *   updateCustomerLocation gagal, dan kegagalannya ditelan console.warn saja
 *   → admin baru sadar setelah menekan "Refresh & Hitung Ulang" keesokan hari.
 * Invarian wajib:
 *   1. GPS pin BARU selalu menimpa koordinat lama (isNativePin).
 *   2. Kegagalan tulis TIDAK pernah diam — meninggalkan audit persisten.
 *   3. Pemilihan sumber koordinat mengikuti hierarki tier yang tegas.
 */
const TENANT = 'default-tenant';

const agathaExisting = () => ({
  id: 'b30ff1e6-df6c-43bf-ac8b-bf94c286c19d',
  tenant_id: TENANT,
  phone: '6285728800224',
  lat: -7.35,
  lng: 112.78,
  distance_km: 5.1,
  ongkir: 5000,
  share_location_sent: true,
  location_source: 'manual_staff',
});

const gpsPinMessage = () => ({
  type: 'location',
  location: { latitude: -7.3564516847907635, longitude: 112.78985794633627 },
});

describe('pickGpsTier (hierarki pemilihan sumber koordinat)', () => {
  it('bidan_shareloc mengalahkan customer_shareloc meski kandidatnya lebih lama', () => {
    const picked = pickGpsTier([
      { source: 'customer_shareloc', lat: -7.36, lng: 112.79, at: '2026-09-26T01:34:00.000Z' },
      { source: 'bidan_shareloc', lat: -7.35, lng: 112.78, at: '2026-09-25T10:00:00.000Z' },
    ]);
    expect(picked?.source).toBe('bidan_shareloc');
    expect(picked?.lat).toBe(-7.35);
  });

  it('customer_shareloc mengalahkan db_coords dan geocoding', () => {
    const picked = pickGpsTier([
      { source: 'geocoding', lat: -7.4, lng: 112.7, at: '2026-09-26T01:34:00.000Z' },
      { source: 'db_coords', lat: -7.39, lng: 112.71, at: '2026-09-26T01:33:00.000Z' },
      { source: 'customer_shareloc', lat: -7.35, lng: 112.78, at: '2026-09-20T00:00:00.000Z' },
    ]);
    expect(picked?.source).toBe('customer_shareloc');
  });

  it('kandidat TERBARU yang menang di dalam tier yang sama', () => {
    const picked = pickGpsTier([
      { source: 'customer_shareloc', lat: -7.1, lng: 112.1, at: '2026-09-01T00:00:00.000Z' },
      { source: 'customer_shareloc', lat: -7.2, lng: 112.2, at: '2026-09-25T13:39:36.000Z' },
    ]);
    expect(picked?.lat).toBe(-7.2);
  });

  it('daftar kosong → null (bukan kandidat halusinasi)', () => {
    expect(pickGpsTier([])).toBeNull();
  });
});

describe('ingestGpsPin (kasus Agatha: GPS baru saat lokasi sudah ada)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(customerService.updateCustomerLocation).mockResolvedValue({} as any);
    vi.mocked(customerService.markShareLocationSent).mockResolvedValue({} as any);
  });

  it('GPS pin baru MENIMPA koordinat lama walau share_location_sent=true', async () => {
    const res = await locationIngestService.ingestGpsPin({
      customer: agathaExisting(),
      incomingMessage: gpsPinMessage(),
      tenantId: TENANT,
    });

    expect(res.status).toBe('saved');
    expect(customerService.updateCustomerLocation).toHaveBeenCalledWith(
      'b30ff1e6-df6c-43bf-ac8b-bf94c286c19d',
      expect.objectContaining({
        lat: -7.3564516847907635,
        lng: 112.78985794633627,
        distanceKm: 6.86,
        ongkir: 5000,
        isNativePin: true,
      }),
      TENANT
    );
    expect(customerService.markShareLocationSent).toHaveBeenCalledWith(
      'b30ff1e6-df6c-43bf-ac8b-bf94c286c19d',
      TENANT
    );
  });

  it('Kegagalan TULIS tidak pernah diam: audit LOCATION_INGEST_FAILED wajib tercatat', async () => {
    vi.mocked(customerService.updateCustomerLocation).mockRejectedValue(
      new Error('Customer b30ff1e6 not found for tenant default-tenant')
    );
    const { auditService } = await import('../../src/services/audit.service');

    const res = await locationIngestService.ingestGpsPin({
      customer: agathaExisting(),
      incomingMessage: gpsPinMessage(),
      tenantId: TENANT,
    });

    expect(res.status).toBe('error');
    expect(res.reason).toContain('update');
    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOCATION_INGEST_FAILED',
        targetId: 'b30ff1e6-df6c-43bf-ac8b-bf94c286c19d',
        payload: expect.objectContaining({
          error: expect.stringContaining('not found'),
          lat: expect.closeTo(-7.35645, 4),
        }),
      })
    );
  });

  it('Pesan bukan GPS pin di-skip tanpa menyentuh DB', async () => {
    const res = await locationIngestService.ingestGpsPin({
      customer: agathaExisting(),
      incomingMessage: { type: 'text', text: { body: 'iya tidak apa' } },
      tenantId: TENANT,
    });

    expect(res.status).toBe('skipped');
    expect(customerService.updateCustomerLocation).not.toHaveBeenCalled();
    expect(customerService.markShareLocationSent).not.toHaveBeenCalled();
  });

  it('Deteksi GPS pin tidak bergantung pada bentuk payload tunggal (type ATAU location.latitude)', async () => {
    const viaField = await locationIngestService.ingestGpsPin({
      customer: agathaExisting(),
      incomingMessage: { location: { latitude: -7.36, longitude: 112.79 } },
      tenantId: TENANT,
    });
    expect(viaField.status).toBe('saved');

    const viaType = await locationIngestService.ingestGpsPin({
      customer: agathaExisting(),
      incomingMessage: gpsPinMessage(),
      tenantId: TENANT,
    });
    expect(viaType.status).toBe('saved');
  });
});

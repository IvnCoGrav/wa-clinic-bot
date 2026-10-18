import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { deliveryService } from '../../src/services/delivery.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { LocationSource } from '@prisma/client';
import * as syncModule from '../../src/services/reservation-address-sync.service';

const TENANT = DEFAULT_TENANT_ID;

async function seedCustomer(overrides: Record<string, any> = {}): Promise<any> {
  const c: any = await customerService.getOrCreateCustomer(
    `6281${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
    'Bunda Audit',
    TENANT
  );
  Object.assign(c, overrides);
  const mem = customerService.getMemoryCustomers();
  mem.set(c.phone, c);
  mem.set(c.id, c);
  return c;
}

let phoneSeq = 800;
const nextPhone = (): string => `628799${(phoneSeq++).toString().padStart(6, '0')}`;

describe('Fase S-1: Customer Profile Edit Drift & Precision Guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('edit profil (kelurahan) + jadwal aktif → sync relink dipanggil (anti drift)', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Drift', TENANT);
    const syncSpy = vi.spyOn(syncModule, 'syncActiveReservationsForCustomer').mockResolvedValue([] as any);

    await customerService.updateCustomer(
      customer.id,
      {
        kelurahan: 'Gebang Putih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        address: 'Jl. Gebang Putih Baru No. 12',
      },
      TENANT
    );

    expect(syncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        customerId: customer.id,
      })
    );
  });

  it('form kirim ulang koordinat lama → location_source gps_pin TIDAK turun', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda GPS', TENANT);
    const mem = customerService.getMemoryCustomers();
    customer.lat = -7.289199;
    customer.lng = 112.7970673;
    customer.location_source = LocationSource.gps_pin;
    mem.set(customer.phone, customer);
    mem.set(customer.id, customer);

    // Form admin mengirim ulang lat/lng yang sama persis
    await customerService.updateCustomer(
      customer.id,
      {
        name: 'Bunda GPS Updated',
        lat: -7.289199,
        lng: 112.7970673,
      },
      TENANT
    );

    const check = await customerService.getCustomerById(customer.id, TENANT);
    expect(check?.location_source).toBe(LocationSource.gps_pin);
  });

  it('form kirim koordinat baru → location_source turun ke manual_staff', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Move', TENANT);
    const mem = customerService.getMemoryCustomers();
    customer.lat = -7.289199;
    customer.lng = 112.7970673;
    customer.location_source = LocationSource.gps_pin;
    mem.set(customer.phone, customer);
    mem.set(customer.id, customer);

    // Form admin mengirim koordinat baru
    await customerService.updateCustomer(
      customer.id,
      {
        lat: -7.310000,
        lng: 112.750000,
      },
      TENANT
    );

    const check = await customerService.getCustomerById(customer.id, TENANT);
    expect(check?.location_source).toBe(LocationSource.manual_staff);
  });

  it('sync jadwal gagal → updateCustomer tetap resolve (tanpa throw)', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Err', TENANT);
    vi.spyOn(syncModule, 'syncActiveReservationsForCustomer').mockRejectedValue(new Error('Simulasi sync error timeout'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Update customer harus tetap resolve tanpa melempar exception
    await expect(
      customerService.updateCustomer(
        customer.id,
        {
          kelurahan: 'Rungkut Menanggal',
        },
        TENANT
      )
    ).resolves.toBeDefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CustomerService] active reservation sync FAILED:'),
      expect.objectContaining({
        customerId: customer.id,
        message: 'Simulasi sync error timeout',
      })
    );
  });
});

describe('Fase S-2: Gate Koordinat Benar-Benar Berubah (PUT /:id/location)', () => {
  const ADMIN_KEY = 'test_admin_key_s2';

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
  });

  it('ubah landmark saja (koordinat tidak berubah) → updateCustomerLocation TIDAK dipanggil (anti-relink)', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Landmark', TENANT);
    customer.lat = -7.289199;
    customer.lng = 112.7970673;
    customer.preferences = { landmark: 'Pagar hitam lama' };
    const mem = customerService.getMemoryCustomers();
    mem.set(customer.phone, customer);
    mem.set(customer.id, customer);

    const updateLocSpy = vi.spyOn(customerService, 'updateCustomerLocation');
    const { buildApp } = await import('../../src/app');
    const app = buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/location`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        landmark: 'Pagar putih baru (cat ulang)',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateLocSpy).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data?.landmark).toBe('Pagar putih baru (cat ulang)');
  });

  it('ubah koordinat baru → updateCustomerLocation DIPANGGIL', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda New Coords', TENANT);
    customer.lat = -7.289199;
    customer.lng = 112.7970673;
    const mem = customerService.getMemoryCustomers();
    mem.set(customer.phone, customer);
    mem.set(customer.id, customer);

    const updateLocSpy = vi.spyOn(customerService, 'updateCustomerLocation').mockResolvedValue(customer);
    const { buildApp } = await import('../../src/app');
    const app = buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/location`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        lat: -7.310000,
        lng: 112.750000,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateLocSpy).toHaveBeenCalledWith(
      customer.id,
      expect.objectContaining({
        lat: -7.310000,
        lng: 112.750000,
        forceUpdateGps: true,
      }),
      expect.any(String)
    );
  });
});

/**
 * REGRESI (dikembalikan): koreksi drift koordinat saat admin edit wilayah.
 *
 * Kasus nyata Bunda Chris 6281390541340: admin mengedit teks wilayah customer
 * (mis. menjadi "Berbek, Waru") tetapi koordinat lama tetap tersangkut di Suko
 * (estimated_area). Titik estimasi WAJIB ikut terkoreksi; titik PRESISI (gps_pin)
 * HARAM ditimpa. Gerbang recalc DILARANG membaca ulang state SETELAH tulis
 * (read-after-write) karena membuat coordsChanged/kecamatanDrift selalu false.
 */
describe('Regresi: koreksi drift koordinat saat admin edit wilayah', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    // DB "online" agar blok auto-recalc berjalan; getCustomerById via repo mock.
    vi.mocked(prisma.customer.update).mockImplementation((async (args: any) => {
      const mem = customerService.getMemoryCustomers().get(args.where.id);
      return { ...(mem || {}), ...(args.data || {}) };
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('titik estimasi Suko + edit ke Waru → koordinat terkoreksi ke Waru (bukan Suko)', async () => {
    const c = await seedCustomer({
      lat: -7.44615,
      lng: 112.678558,
      distance_km: 14,
      ongkir: 20000,
      location_source: 'estimated_area',
      share_location_sent: false,
      kelurahan: 'Suko',
      kecamatan: 'Sidoarjo',
      kota: 'Kabupaten Sidoarjo',
    });
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(c as any);
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({
      isPrecise: true,
      lat: -7.3427,
      lng: 112.7613,
      kelurahan: 'Berbek',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
    } as any);
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 3.7,
      ongkir: 0,
      normalPrice: 0,
      promoPrice: 0,
      isOutOfCoverage: false,
      isEstimated: false,
      freeTierKm: 5,
      maxCoverageKm: 30,
      messageTemplate: '',
    } as any);

    await customerService.updateCustomer(
      c.id,
      { kelurahan: 'Berbek', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo' },
      TENANT
    );

    // update kedua (auto-recalc) harus menulis koordinat Waru, bukan Suko
    const coordUpdates = vi
      .mocked(prisma.customer.update)
      .mock.calls.map((call) => call[0]?.data)
      .filter((d: any) => d && d.lat != null);
    expect(coordUpdates.length).toBeGreaterThan(0);
    const last = coordUpdates[coordUpdates.length - 1] as any;
    expect(last.lat).toBeCloseTo(-7.3427, 3);
    expect(last.lng).toBeCloseTo(112.7613, 3);
    expect(last.ongkir).toBe(0);
  });

  it('titik presisi gps_pin + edit teks → koordinat TIDAK ditimpa', async () => {
    const c = await seedCustomer({
      lat: -7.4,
      lng: 112.7,
      distance_km: 10,
      ongkir: 15000,
      location_source: 'gps_pin',
      share_location_sent: true,
      kelurahan: 'Suko',
      kecamatan: 'Sidoarjo',
      kota: 'Kabupaten Sidoarjo',
    });
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(c as any);
    const geoSpy = vi.spyOn(geocodingService, 'geocodeText');

    await customerService.updateCustomer(c.id, { kelurahan: 'Berbek', kecamatan: 'Waru' }, TENANT);

    expect(geoSpy).not.toHaveBeenCalled();
    const coordUpdates = vi
      .mocked(prisma.customer.update)
      .mock.calls.map((call) => call[0]?.data)
      .filter((d: any) => d && d.lat != null);
    expect(coordUpdates.length).toBe(0);
  });

  it('edit sesama kecamatan (Waru→Waru) → tidak geocode ulang sia-sia', async () => {
    const c = await seedCustomer({
      lat: -7.348395,
      lng: 112.7494759,
      distance_km: 3.5,
      ongkir: 0,
      location_source: 'estimated_area',
      share_location_sent: false,
      kelurahan: 'Wedoro',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
    });
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(c as any);
    const geoSpy = vi.spyOn(geocodingService, 'geocodeText');

    await customerService.updateCustomer(c.id, { kelurahan: 'Tambaksumur', kecamatan: 'Waru' }, TENANT);

    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('teks kosong / tanpa perubahan → tidak crash', async () => {
    const c = await seedCustomer({
      lat: -7.4,
      lng: 112.7,
      location_source: 'estimated_area',
      kelurahan: 'Suko',
      kecamatan: 'Sidoarjo',
    });
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(c as any);
    await expect(customerService.updateCustomer(c.id, {}, TENANT)).resolves.toBeDefined();
  });

  it('koordinat eksplisit berubah (kecamatan sama) → jarak & ongkir dihitung ulang', async () => {
    const c = await seedCustomer({
      lat: -7.3,
      lng: 112.7,
      distance_km: 10,
      ongkir: 15000,
      location_source: 'estimated_area',
      share_location_sent: false,
      kelurahan: 'Tambaksumur',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
    });
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(c as any);
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({ isPrecise: false } as any);
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 5,
      ongkir: 10000,
      normalPrice: 10000,
      promoPrice: 10000,
      isOutOfCoverage: false,
      isEstimated: false,
      freeTierKm: 5,
      maxCoverageKm: 30,
      messageTemplate: '',
    } as any);

    await customerService.updateCustomer(c.id, { lat: -7.35, lng: 112.75 }, TENANT);

    const coordRecalc = vi
      .mocked(prisma.customer.update)
      .mock.calls.map((call) => call[0]?.data)
      .filter((d: any) => d && d.lat != null && d.distance_km != null);
    expect(coordRecalc.length).toBeGreaterThan(0);
    const last = coordRecalc[coordRecalc.length - 1] as any;
    expect(last.ongkir).toBe(10000);
  });
});


import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { deliveryService } from '../../src/services/delivery.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Audit Kasus Suko (Bunda Chris 6281390541340): admin mengedit teks wilayah
 * customer (mis. menjadi "Berbek, Waru") tetapi koordinat lama tetap tersangkut
 * di Suko (estimated_area). Titik estimasi WAJIB ikut terkoreksi ke wilayah baru;
 * namun titik PRESISI (gps_pin/shareloc) HARAM ditimpa (gerbang existing).
 *
 * Seam: `customerService.updateCustomer` (dipakai Admin Dashboard).
 */
const TENANT = DEFAULT_TENANT_ID;

async function seedCustomer(overrides: Record<string, any> = {}): Promise<any> {
  const c: any = await customerService.getOrCreateCustomer(
    `6281${Date.now().toString().slice(-7)}`,
    'Bunda Audit',
    TENANT
  );
  Object.assign(c, overrides);
  const mem = customerService.getMemoryCustomers();
  mem.set(c.phone, c);
  mem.set(c.id, c);
  return c;
}

describe('updateCustomer — koreksi drift koordinat saat admin edit wilayah', () => {
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
});

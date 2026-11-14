import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { getCustomerRepository } from '../../src/repositories/customer.repository';

/**
 * Component 4 — Invarian Sticky Verified GPS (kasus Bunda Retno).
 * Pin GPS asli (shareloc / link Maps) berstatus VERIFIED_GPS
 * (`share_location_sent = true`): alamat teks belakangan DILARANG mendegradasi
 * lat/lng + jarak + ongkir ke centroid teks, DAN DILARANG menimpa wilayah root
 * (anti data hibrida "koordinat A + teks B"). Override hanya via shareloc baru
 * (`isNativePin: true`), pilih alamat tersimpan, atau dashboard admin.
 */
const TENANT = 'default-tenant';
const dbOffline = () => new Error('Database offline');

describe('Sticky Verified GPS invariant (updateCustomerLocation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(dbOffline());
    vi.mocked(prisma.customer.update).mockRejectedValue(dbOffline());
  });

  const verifiedExisting = () => ({
    id: 'cust-verified-1',
    tenant_id: TENANT,
    phone: '6281000000001',
    kelurahan: 'Punggul',
    kecamatan: 'Gedangan',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.393858,
    lng: 112.745941,
    distance_km: 10.92,
    ongkir: 15000,
    share_location_sent: true,
  });

  it('DB: teks "Alamat saya di Gedangan" tidak mendegradasi GPS 10.92 km', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(verifiedExisting() as any);
    const updateSpy = vi.spyOn(getCustomerRepository(), 'update').mockImplementation(async (_id: string, patch: any) => patch);

    await customerService.updateCustomerLocation(
      'cust-verified-1',
      {
        kelurahan: 'Gedangan',
        kecamatan: 'Gedangan',
        lat: -7.38, // centroid teks (kasar) — wajib DIABAIKAN
        lng: 112.73,
        distanceKm: 8.5,
        ongkir: 20000,
      },
      TENANT,
    );

    // Fire-and-forget google-contacts sync (customer.service.ts:241-247) dapat menambah panggilan
    // repository update di background — assert invarian pada call PERTAMA (update lokasi), bukan hitungan eksak.
    expect(updateSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const data = updateSpy.mock.calls[0][1] as any;
    expect(data.lat).toBeCloseTo(-7.393858, 6);
    expect(data.lng).toBeCloseTo(112.745941, 6);
    expect(data.distance_km).toBe(10.92);
    expect(data.ongkir).toBe(15000);
    // Wilayah root DI-FREEZE selama pin presisi dipertahankan (anti hibrida).
    expect(data.kelurahan).toBe('Punggul');

    updateSpy.mockRestore();
  });

  it('DB: shareloc baru (isNativePin) boleh meng-override GPS lama', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(verifiedExisting() as any);
    const updateSpy = vi.spyOn(getCustomerRepository(), 'update').mockImplementation(async (_id: string, patch: any) => patch);

    await customerService.updateCustomerLocation(
      'cust-verified-1',
      { lat: -7.4, lng: 112.75, distanceKm: 12.1, ongkir: 15000, isNativePin: true },
      TENANT,
    );

    const data = updateSpy.mock.calls[0][1] as any;
    expect(data.lat).toBeCloseTo(-7.4, 6);
    expect(data.lng).toBeCloseTo(112.75, 6);
    expect(data.distance_km).toBe(12.1);

    updateSpy.mockRestore();
  });

  it('DB: tanpa pin terverifikasi, koordinat teks dipakai normal', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      ...verifiedExisting(),
      share_location_sent: false,
    } as any);
    const updateSpy = vi.spyOn(getCustomerRepository(), 'update').mockImplementation(async (_id: string, patch: any) => patch);

    await customerService.updateCustomerLocation(
      'cust-verified-1',
      { lat: -7.38, lng: 112.73, distanceKm: 8.5, ongkir: 20000 },
      TENANT,
    );

    const data = updateSpy.mock.calls[0][1] as any;
    expect(data.lat).toBeCloseTo(-7.38, 6);
    expect(data.distance_km).toBe(8.5);

    updateSpy.mockRestore();
  });

  it('Memory fallback: GPS pin dipertahankan saat DB offline', async () => {
    const phone = `62819${Date.now().toString().slice(-7)}`;
    const seeded: any = await customerService.getOrCreateCustomer(phone, 'Bunda Sticky', TENANT);
    // Simulasikan pin GPS terverifikasi yang sudah tersimpan
    seeded.lat = -7.393858;
    seeded.lng = 112.745941;
    seeded.distance_km = 10.92;
    seeded.ongkir = 15000;
    seeded.share_location_sent = true;

    await customerService.updateCustomerLocation(
      seeded.id,
      {
        kelurahan: 'Gedangan',
        kecamatan: 'Gedangan',
        lat: -7.38, // centroid teks — wajib diabaikan
        lng: 112.73,
        distanceKm: 8.5,
        ongkir: 20000,
      },
      TENANT,
    );

    const after: any = await customerService.getCustomerById(seeded.id, TENANT);
    expect(after.lat).toBeCloseTo(-7.393858, 6);
    expect(after.lng).toBeCloseTo(112.745941, 6);
    expect(after.distance_km).toBe(10.92);
    expect(after.ongkir).toBe(15000);
    // Tanpa region awal, input wilayah saja tidak boleh mengisi root.
    expect(after.kelurahan).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addressesMatch, upsertAddressIntoList, SavedCustomerAddress } from '../../src/domain/customer-address';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';

describe('Adversarial & Regression Test: addressesMatch with NULL / Asymmetric Kelurahan', () => {
  const mkAddr = (over: Partial<SavedCustomerAddress> = {}): SavedCustomerAddress => ({
    id: over.id || 'addr_1',
    label: over.label || 'Rumah Buduran',
    address: over.address !== undefined ? over.address : 'Natura Residence Cluster Summerland C2 - 3A buduran',
    kelurahan: over.kelurahan !== undefined ? over.kelurahan : null,
    kecamatan: over.kecamatan !== undefined ? over.kecamatan : 'Buduran',
    kota: over.kota !== undefined ? over.kota : 'Sidoarjo',
    lat: over.lat !== undefined ? over.lat : -7.4358917,
    lng: over.lng !== undefined ? over.lng : 112.7261417,
    distanceKm: over.distanceKm !== undefined ? over.distanceKm : 13.84,
    ongkir: over.ongkir !== undefined ? over.ongkir : 15000,
    landmark: over.landmark || null,
    locationSource: over.locationSource || 'estimated_area',
    isPrimary: over.isPrimary ?? true,
    createdAt: '2026-10-14T02:31:06.908Z',
    lastUsedAt: '2026-10-14T02:31:06.908Z',
  });

  // a. jalan sama + kec sama + desa NULL dua sisi -> true
  it('(a) jalan sama + kec sama + desa NULL dua sisi -> WAJIB MATCH (true)', () => {
    const a = mkAddr({ address: 'Natura Residence Cluster Summerland C2 - 3A buduran', kelurahan: null, kecamatan: 'Buduran' });
    const b = { address: 'natura residence cluster summerland c2 - 3a buduran', kelurahan: null, kecamatan: 'Buduran' };
    expect(addressesMatch(a, b)).toBe(true);
  });

  // b. jalan sama + kec sama + satu sisi NULL -> true (kompatibel)
  it('(b) jalan sama + kec sama + satu sisi kelurahan NULL, sisi lain terisi -> WAJIB MATCH (true)', () => {
    const a = mkAddr({ address: 'Natura Residence Cluster Summerland C2 - 3A buduran', kelurahan: null, kecamatan: 'Buduran' });
    const b = { address: 'Natura Residence Cluster Summerland C2 - 3A buduran', kelurahan: 'Siwalanpanji', kecamatan: 'Buduran' };
    expect(addressesMatch(a, b)).toBe(true);

    const c = mkAddr({ address: 'Jl. Rungkut Asri Timur XII/48', kelurahan: 'Rungkut Kidul', kecamatan: 'Rungkut' });
    const d = { address: 'jl. rungkut asri timur xii/48', kelurahan: null, kecamatan: 'Rungkut' };
    expect(addressesMatch(c, d)).toBe(true);
  });

  // c. jalan beda + kec sama -> false (Rumah-2 sah tetap pisah)
  it('(c) jalan beda + kec sama -> WAJIB TIDAK MATCH (false) untuk memisahkan Rumah 2 sah', () => {
    const a = mkAddr({ address: 'Natura Residence Cluster Summerland C2 - 3A buduran', kelurahan: null, kecamatan: 'Buduran' });
    const b = { address: 'Perumahan Kahuripan Nirwana Blok C-12', kelurahan: null, kecamatan: 'Buduran' };
    expect(addressesMatch(a, b)).toBe(false);
  });

  // d. jalan sama + kec sama + desa isi beda (A vs B) -> false (jalan nama sama di desa beda)
  it('(d) jalan sama + kec sama + desa isi beda (A vs B) -> WAJIB TIDAK MATCH (false)', () => {
    const a = mkAddr({ address: 'Jl. Mawar No. 10', kelurahan: 'Banjarkemantren', kecamatan: 'Buduran' });
    const b = { address: 'Jl. Mawar No. 10', kelurahan: 'Pagerwojo', kecamatan: 'Buduran' };
    expect(addressesMatch(a, b)).toBe(false);
  });

  // e. upsert lama berkoordinat + input tanpa koordinat -> koordinat utuh, label tetap
  it('(e) upsertAddressIntoList: alamat lama berkoordinat diupdate input tanpa koordinat -> koordinat utuh, label TIDAK jadi "X 2"', () => {
    const existing = mkAddr({
      id: 'addr_buduran_1',
      label: 'Rumah Buduran',
      address: 'Natura Residence Cluster Summerland C2 - 3A buduran',
      kelurahan: null,
      kecamatan: 'Buduran',
      lat: -7.4358917,
      lng: 112.7261417,
      locationSource: 'gps_pin',
      isPrimary: true,
    });

    const candidate = {
      address: 'Natura Residence Cluster Summerland C2 - 3A buduran',
      kelurahan: null,
      kecamatan: 'Buduran',
      kota: 'Sidoarjo',
      lat: null,
      lng: null,
      locationSource: null,
    };

    const res = upsertAddressIntoList([existing], candidate, new Date().toISOString());
    expect(res.list.length).toBe(1); // tidak bertambah jadi 2
    expect(res.entry.id).toBe('addr_buduran_1');
    expect(res.entry.label).toBe('Rumah Buduran'); // tidak jadi Rumah Buduran 2
    expect(res.entry.lat).toBeCloseTo(-7.4358917, 6); // koordinat tidak hilang/null
    expect(res.entry.lng).toBeCloseTo(112.7261417, 6);
    expect(res.entry.locationSource).toBe('gps_pin'); // tidak terdegradasi
  });

  // f. saveReservation alamat identik -> tidak tambah baris customer_addresses
  it('(f) reservationCoreService.saveReservation: booking dengan teks alamat identik saat kelurahan null tidak menambah entri alamat duplikat', async () => {
    const customerId = 'cust_test_null_kelurahan';
    const tenantId = 'default-tenant';

    const existingAddr = mkAddr({
      id: 'addr_existing_1',
      label: 'Rumah Buduran',
      address: 'Natura Residence Cluster Summerland C2 - 3A buduran',
      kelurahan: null,
      kecamatan: 'Buduran',
      lat: -7.4358917,
      lng: 112.7261417,
      locationSource: 'gps_pin',
      isPrimary: true,
    });

    const mockCreated = {
      id: 'res-addr-test-1',
      tenant_id: tenantId,
      customer_id: customerId,
      treatment_detail: 'Pijat Bayi',
      booking_date: new Date('2026-10-20T10:00:00Z'),
      customer_address_id: 'addr_existing_1',
      status: 'confirmed',
    };

    vi.spyOn(prisma.reservation, 'create').mockResolvedValue(mockCreated as any);
    vi.spyOn(prisma.staff, 'count').mockResolvedValue(5 as any);
    vi.spyOn(prisma.reservation, 'count').mockResolvedValue(0 as any);
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.customer, 'findUnique').mockResolvedValue({
      id: customerId,
      tenant_id: tenantId,
      name: 'Bunda Test',
      phone: '628999999999',
      lat: -7.4358917,
      lng: 112.7261417,
      location_source: 'gps_pin',
    } as any);

    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue({
      id: customerId,
      tenant_id: tenantId,
      name: 'Bunda Test',
      phone: '628999999999',
      lat: -7.4358917,
      lng: 112.7261417,
      location_source: 'gps_pin',
      preferences: {},
    } as any);

    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([existingAddr]);
    const upsertSpy = vi.spyOn(customerService, 'upsertSavedAddress');
    const { reservationLifecycleService } = await import('../../src/services/reservation-lifecycle.service');
    vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined as any);

    const result = await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      bookingDate: new Date('2026-10-20T10:00:00Z'),
      treatmentCategory: 'BABY' as any,
      treatmentDetail: 'Pijat Bayi',
      address: 'Natura Residence Cluster Summerland C2 - 3A buduran',
      kecamatan: 'Buduran',
      kota: 'Sidoarjo',
      source: 'ADMIN_PANEL',
    });

    expect(result.reservation).toBeDefined();
    // Menggunakan entri alamat yang sudah ada, BUKAN memanggil upsert untuk membuat Rumah 2
    expect(result.reservation.customer_address_id).toBe('addr_existing_1');
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

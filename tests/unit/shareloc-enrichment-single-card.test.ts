import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  selectEnrichmentTarget,
  upsertAddressIntoList,
  isRegionCompatible,
} from '../../src/domain/customer-address';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { resolveCustomerAddressId } from '../../src/services/reservation-core.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const NOW = '2026-11-03T10:00:00.000Z';
const card = (o: any) => ({
  id: 'c1',
  label: 'Rumah Karah',
  address: 'Jl. Karah Tama No. 10',
  kelurahan: 'Karah',
  kecamatan: 'Jambangan',
  kota: 'Surabaya',
  lat: null,
  lng: null,
  distanceKm: null,
  ongkir: null,
  landmark: null,
  locationSource: null,
  isPrimary: true,
  createdAt: NOW,
  lastUsedAt: NOW,
  ...o,
});

describe('Shareloc pertama wajib memperkaya kartu tunggal (bukan alamat kedua)', () => {
  it('S1. 1 kartu tanpa GPS + pin kelurahan BEDA se-kecamatan → 1 kartu, bukan 2', () => {
    const list = [card({})];
    const input = {
      kelurahan: 'Jambangan',
      kecamatan: 'Jambangan',
      kota: 'Surabaya',
      lat: -7.32,
      lng: 112.72,
      locationSource: 'gps_pin' as const,
    };
    const target = selectEnrichmentTarget(list as any, input);
    expect(target?.id).toBe('c1');
    const { list: next, entry } = upsertAddressIntoList(
      list as any,
      { ...input, id: target!.id },
      NOW
    );
    expect(next).toHaveLength(1);
    expect(entry.id).toBe('c1');
    expect(entry.address).toBe('Jl. Karah Tama No. 10'); // teks lama TIDAK hilang
    expect(entry.lat).toBe(-7.32);
    expect(entry.isPrimary).toBe(true);
  });

  it('S2. pin di kecamatan lain (rumah 2 sah) → TETAP 2 kartu', () => {
    const list = [card({})];
    const input = {
      kelurahan: 'Gadung',
      kecamatan: 'Driyorejo',
      kota: 'Gresik',
      lat: -7.35,
      lng: 112.62,
    };
    expect(selectEnrichmentTarget(list as any, input)).toBeNull();
  });

  it('S3. 2 kartu, pin cocok kartu non-primary tanpa GPS → perkaya kartu itu', () => {
    const list = [
      card({ id: 'a', isPrimary: true, kelurahan: 'Karah', kecamatan: 'Jambangan' }),
      card({
        id: 'b',
        isPrimary: false,
        address: 'Jl. Kenanga 8',
        kelurahan: 'Waru',
        kecamatan: 'Waru',
      }),
    ];
    const input = {
      kelurahan: 'Waru',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.35,
      lng: 112.72,
    };
    expect(selectEnrichmentTarget(list as any, input)?.id).toBe('b');
  });

  it('S4. pin <150 m dari kartu ber-GPS → tetap 1 kartu (ditangani addressesMatch)', () => {
    const list = [card({ lat: -7.32, lng: 112.72, locationSource: 'gps_pin' })];
    const input = {
      kelurahan: 'Karah',
      kecamatan: 'Jambangan',
      lat: -7.3205,
      lng: 112.7205,
      locationSource: 'gps_pin' as const,
    };
    expect(selectEnrichmentTarget(list as any, input)).toBeNull();
  });

  it('S5. id eksplisit menang mutlak', () => {
    const list = [card({}), card({ id: 'z', isPrimary: false })];
    expect(selectEnrichmentTarget(list as any, { id: 'z' } as any)?.id).toBe('z');
  });

  it('S6. input tanpa koordinat → tidak pernah jadi target pengayaan', () => {
    expect(
      selectEnrichmentTarget([card({})] as any, { kelurahan: 'Karah' } as any)
    ).toBeNull();
  });

  it('S7. wilayah kartu kosong + pin baru → perkaya (bukan kartu baru)', () => {
    const list = [card({ kelurahan: null, kecamatan: null })];
    expect(
      selectEnrichmentTarget(list as any, {
        kelurahan: 'Karah',
        kecamatan: 'Jambangan',
        lat: -7.32,
        lng: 112.72,
      })?.id
    ).toBe('c1');
  });

  it('S8. integrasi: updateCustomerLocation(isNativePin) → 1 kartu + root & kartu konsisten', async () => {
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('Database offline'));

    const phone = `628799${Date.now().toString().slice(-6)}`;
    const cust: any = await customerService.getOrCreateCustomer(
      phone,
      'Bunda Agnes Mock',
      DEFAULT_TENANT_ID
    );

    // Kartu awal: intake teks, tanpa GPS
    await customerService.upsertSavedAddress(
      cust.id,
      {
        address: 'Jl. Raya Darmo Baru Barat No. 9',
        kelurahan: 'Darmo',
        kecamatan: 'Sukomanunggal',
        kota: 'Surabaya',
        isPrimary: true,
      },
      DEFAULT_TENANT_ID
    );

    // Shareloc masuk: isNativePin = true, kelurahan reverse-geocode beda (Sonokwijenan vs Darmo)
    const updated: any = await customerService.updateCustomerLocation(
      cust.id,
      {
        kelurahan: 'Sonokwijenan',
        kecamatan: 'Sukomanunggal',
        kota: 'Surabaya',
        lat: -7.2818,
        lng: 112.6986,
        distanceKm: 5.5,
        ongkir: 10000,
        isNativePin: true,
      },
      DEFAULT_TENANT_ID
    );

    const cards = await customerService.getSavedAddresses(cust.id, DEFAULT_TENANT_ID);
    expect(cards).toHaveLength(1);
    expect(cards[0].address).toBe('Jl. Raya Darmo Baru Barat No. 9');
    expect(cards[0].lat).toBeCloseTo(-7.2818, 4);
    expect(cards[0].locationSource).toBe('gps_pin');
    expect(cards[0].isPrimary).toBe(true);

    expect(updated.lat).toBeCloseTo(-7.2818, 4);
    expect(updated.lng).toBeCloseTo(112.6986, 4);
  });

  it('S9. (Kasus Nyata Bunda Agnes): kartu awal ber-estimated_area + pin GPS native se-kecamatan → 1 kartu diperkaya', () => {
    const list = [
      card({
        id: 'c-darmo',
        address: 'jl. Raya Darmo Baru Barat no.9',
        kelurahan: 'Darmo',
        kecamatan: 'Sukomanunggal',
        kota: 'Surabaya',
        lat: -7.2912,
        lng: 112.7345,
        locationSource: 'estimated_area',
        isPrimary: true,
      }),
    ];
    const input = {
      kelurahan: 'Sonokwijenan',
      kecamatan: 'Sukomanunggal',
      kota: 'Kota Surabaya',
      lat: -7.2818,
      lng: 112.6986,
      locationSource: 'gps_pin' as const,
    };
    const target = selectEnrichmentTarget(list as any, input);
    expect(target?.id).toBe('c-darmo');
  });

  it('S10. booking dengan shareloc pada pelanggan 1-kartu-tanpa-GPS → resolveCustomerAddressId pakai kartu lama', async () => {
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('Database offline'));

    const phone = `628788${Date.now().toString().slice(-6)}`;
    const cust: any = await customerService.getOrCreateCustomer(
      phone,
      'Bunda Booking Shareloc',
      DEFAULT_TENANT_ID
    );

    const r1 = await customerService.upsertSavedAddress(
      cust.id,
      {
        address: 'Jl. Raya Darmo Baru Barat No. 9',
        kelurahan: 'Darmo',
        kecamatan: 'Sukomanunggal',
        kota: 'Surabaya',
        isPrimary: true,
      },
      DEFAULT_TENANT_ID
    );

    const candidate = {
      kelurahan: 'Sonokwijenan',
      kecamatan: 'Sukomanunggal',
      kota: 'Surabaya',
      lat: -7.2818,
      lng: 112.6986,
      distanceKm: 5.5,
      ongkir: 10000,
      locationSource: 'gps_pin' as const,
    };

    const resolvedId = await resolveCustomerAddressId({
      customerId: cust.id,
      tenantId: DEFAULT_TENANT_ID,
      candidate,
    });

    expect(resolvedId).toBe(r1!.id);
    const cards = await customerService.getSavedAddresses(cust.id, DEFAULT_TENANT_ID);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(r1!.id);
    expect(cards[0].address).toBe('Jl. Raya Darmo Baru Barat No. 9');
    expect(cards[0].lat).toBeCloseTo(-7.2818, 4);
    expect(cards[0].locationSource).toBe('gps_pin');
  });

  it('S11. dua rumah se-kelurahan, pin dekat rumah B → perkaya rumah B (bukan primary A)', () => {
    const list = [
      card({ id: 'rumahA', isPrimary: true, address: 'Jl. Melati 1', kelurahan: 'Waru', kecamatan: 'Waru', lat: null, lng: null }),
      card({
        id: 'rumahB',
        isPrimary: false,
        address: 'Jl. Kenanga 2',
        kelurahan: 'Waru',
        kecamatan: 'Waru',
        lat: -7.35,
        lng: 112.72,
        locationSource: 'estimated_area',
      }),
    ];
    const input = {
      kelurahan: 'Waru',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.3502,
      lng: 112.7202,
      locationSource: 'gps_pin' as const,
    };
    expect(selectEnrichmentTarget(list as any, input)?.id).toBe('rumahB');
  });

  it('S12. dua rumah se-kelurahan tanpa bukti koordinat → JANGAN menebak (null)', () => {
    const list = [
      card({ id: 'rumahA', isPrimary: true, address: 'Jl. Melati 1', kelurahan: 'Waru', kecamatan: 'Waru' }),
      card({ id: 'rumahB', isPrimary: false, address: 'Jl. Kenanga 2', kelurahan: 'Waru', kecamatan: 'Waru' }),
    ];
    const input = {
      kelurahan: 'Waru',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.35,
      lng: 112.72,
      locationSource: 'gps_pin' as const,
    };
    expect(selectEnrichmentTarget(list as any, input)).toBeNull();
  });

  it('S13. jalur tabel-saja (snake_case) → kartu lama diperkaya tanpa kehilangan label/teks', async () => {
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('Database offline'));

    const phone = `628766${Date.now().toString().slice(-6)}`;
    const cust: any = await customerService.getOrCreateCustomer(
      phone,
      'Bunda Table Only',
      DEFAULT_TENANT_ID
    );

    const tableRow = {
      id: 'tbl-1',
      label: 'Rumah Waru',
      address: 'Jl. Kenanga 8',
      kelurahan: 'Waru',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: null,
      lng: null,
      distance_km: null,
      ongkir: null,
      landmark: null,
      location_source: null,
      is_primary: true,
      created_at: new Date(),
      last_used_at: new Date(),
    };
    const fakeDb: any = {
      customerAddress: { findMany: async () => [tableRow] },
      customer: { findUnique: async () => null },
    };

    const id = await resolveCustomerAddressId({
      customerId: cust.id,
      tenantId: DEFAULT_TENANT_ID,
      db: fakeDb,
      candidate: {
        kelurahan: 'Sonokwijenan',
        kecamatan: 'Waru',
        kota: 'Sidoarjo',
        lat: -7.35,
        lng: 112.72,
        locationSource: 'gps_pin' as const,
      },
    });

    expect(id).toBe('tbl-1');
    const cards = await customerService.getSavedAddresses(cust.id, DEFAULT_TENANT_ID);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('tbl-1');
    expect(cards[0].label).toBe('Rumah Waru');
    expect(cards[0].address).toBe('Jl. Kenanga 8');
    expect(cards[0].lat).toBeCloseTo(-7.35, 4);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const TENANT = DEFAULT_TENANT_ID;
let phoneSeq = 900;

async function seedPreciseCustomer() {
  const phone = `628799${(phoneSeq++).toString().padStart(6, '0')}`;
  const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Preserve GPS', TENANT);
  Object.assign(customer, {
    kelurahan: 'Kebraon',
    kecamatan: 'Karang Pilang',
    kota: 'Surabaya',
    lat: -7.337536811828613,
    lng: 112.6987762451172,
    distance_km: 9.55,
    ongkir: 10000,
    location_source: 'gps_pin',
    preferences: {
      address: 'Kebraon 1/15-A Karangpilang Surabaya',
      saved_addresses: [],
      location_updated_at: '2026-11-13T00:00:00.000Z',
    },
  });
  const mem = customerService.getMemoryCustomers();
  mem.set(customer.phone, customer);
  mem.set(customer.id, customer);

  const gpsCard = await customerService.upsertSavedAddress(customer.id, {
    address: 'Kebraon 1/15-A Karangpilang Surabaya',
    kelurahan: 'Kebraon',
    kecamatan: 'Karang Pilang',
    kota: 'Surabaya',
    lat: -7.337536811828613,
    lng: 112.6987762451172,
    distanceKm: 9.55,
    ongkir: 10000,
    locationSource: 'gps_pin',
    isPrimary: true,
  }, TENANT);

  return { customer, gpsCard };
}

describe('updateCustomerLocation — pagar preserve GPS', () => {
  beforeEach(() => {
    // DB offline di test → jalur memori yang diuji.
  });

  it('input wilayah saja pada customer gps_pin → root & kartu TIDAK berubah', async () => {
    const { customer } = await seedPreciseCustomer();

    await customerService.updateCustomerLocation(customer.id, {
      kelurahan: 'Gading fajar B1/20 buduran sidoarjo',
      kecamatan: 'Buduran',
      kota: 'Sidoarjo',
    }, TENANT);

    const fresh: any = await customerService.getCustomerById(customer.id, TENANT);
    const cards = await customerService.getSavedAddresses(customer.id, TENANT);

    expect(fresh.kelurahan).toBe('Kebraon');
    expect(fresh.kecamatan).toBe('Karang Pilang');
    expect(fresh.kota).toBe('Surabaya');
    expect(cards).toHaveLength(1);
    expect(cards[0].lat).toBe(-7.337536811828613);
    expect(cards[0].lng).toBe(112.6987762451172);
  });

  it('teks alamat rumah kedua eksplisit → kartu baru dibuat, root tetap rumah utama', async () => {
    const { customer } = await seedPreciseCustomer();

    await customerService.updateCustomerLocation(customer.id, {
      address: 'Perum Buduran Indah Blok B-5',
      kelurahan: 'Buduran',
      kecamatan: 'Buduran',
      kota: 'Sidoarjo',
    }, TENANT);

    const fresh: any = await customerService.getCustomerById(customer.id, TENANT);
    const cards = await customerService.getSavedAddresses(customer.id, TENANT);

    // Root tetap rumah utama (koordinat & wilayah presisi).
    expect(fresh.kelurahan).toBe('Kebraon');
    expect(fresh.kecamatan).toBe('Karang Pilang');
    expect(fresh.kota).toBe('Surabaya');

    // Kartu kedua boleh lahir dari teks alamat eksplisit.
    expect(cards.length).toBe(2);
    expect(cards.some((c) => c.address.includes('Buduran Indah'))).toBe(true);
    const primary = cards.find((c) => c.isPrimary);
    expect(primary?.kelurahan).toBe('Kebraon');
  });
});

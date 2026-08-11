import { describe, it, expect, beforeEach, vi } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Koersi lat/lng string → number (Prisma Float guard)', () => {
  const tenantId = DEFAULT_TENANT_ID;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updateCustomerLocation menerima string lat/lng dan menyimpan sebagai number', async () => {
    const customer = await customerService.getOrCreateCustomer('62811112222', 'Bunda Coercion', tenantId);

    const result = await customerService.updateCustomerLocation(
      customer.id,
      {
        kelurahan: 'Gubeng',
        kecamatan: 'Gubeng',
        kota: 'Surabaya',
        lat: '-7.23927',
        lng: '112.7652417',
        distanceKm: 18.42,
        ongkir: 20000,
        isOutOfCoverage: false,
        zipcode: '60281',
      } as any,
      tenantId
    );

    expect(typeof result.lat).toBe('number');
    expect(result.lat).toBeCloseTo(-7.23927, 5);
    expect(typeof result.lng).toBe('number');
    expect(result.lng).toBeCloseTo(112.7652417, 5);
    expect(result.kelurahan).toBe('Gubeng');
    expect(result.zipcode).toBe('60281');
  });

  it('updateCustomerPendingLocation menerima string lat/lng dan menyimpan sebagai number', async () => {
    const customer = await customerService.getOrCreateCustomer('62811113333', 'Bunda Pending', tenantId);

    const result = await customerService.updateCustomerPendingLocation(
      customer.id,
      {
        kelurahan: 'Kebonsari',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: '-7.29',
        lng: '112.79',
        zipcode: '60122',
      } as any,
      tenantId
    );

    expect(typeof result.pending_lat).toBe('number');
    expect(result.pending_lat).toBeCloseTo(-7.29, 5);
    expect(typeof result.pending_lng).toBe('number');
    expect(result.pending_lng).toBeCloseTo(112.79, 5);
  });

  it('promotePendingLocation menerima koordinat string (data lama) dan menghitung ongkir dengan number', async () => {
    const customer = await customerService.getOrCreateCustomer('62811114444', 'Bunda Promote', tenantId);
    await customerService.updateCustomerPendingLocation(
      customer.id,
      {
        kelurahan: 'Kebonsari',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: '-7.29',
        lng: '112.79',
        zipcode: '60122',
      } as any,
      tenantId
    );

    const calc = vi.fn().mockResolvedValue({ distanceKm: 5.2, ongkir: 15000, isOutOfCoverage: false });
    const result = await customerService.promotePendingLocation(
      customer.id,
      {
        pending_kelurahan: 'Kebonsari',
        pending_kecamatan: 'Sukolilo',
        pending_kota: 'Surabaya',
        pending_lat: '-7.29',
        pending_lng: '112.79',
        pending_zipcode: '60122',
      } as any,
      calc,
      tenantId
    );

    expect(result.success).toBe(true);
    expect(calc).toHaveBeenCalledWith({ lat: -7.29, lng: 112.79 });
  });

  it('promotePendingLocation menolak koordinat yang bukan angka', async () => {
    const customer = await customerService.getOrCreateCustomer('62811115555', 'Bunda Invalid', tenantId);

    const result = await customerService.promotePendingLocation(
      customer.id,
      {
        pending_kelurahan: 'X',
        pending_kecamatan: 'Y',
        pending_kota: 'Z',
        pending_lat: 'bukan-angka',
        pending_lng: '112.79',
      } as any,
      vi.fn(),
      tenantId
    );

    expect(result.success).toBe(false);
  });
});

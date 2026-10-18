import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { resolveCustomerAddressId } from '../../src/services/reservation-core.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import {
  InMemoryCustomerRepository,
  setCustomerRepository,
  resetCustomerRepository,
} from '../../src/repositories/customer.repository';

const TENANT = DEFAULT_TENANT_ID;

let phoneSeq = 500;
const nextPhone = (): string => `628795${(phoneSeq++).toString().padStart(6, '0')}`;

describe('Fase 2 — Elevasi Primary yang Aman (state-gated)', () => {
  let repo: InMemoryCustomerRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new InMemoryCustomerRepository();
    setCustomerRepository(repo);
    customerService.getMemoryCustomers().clear();
  });

  afterEach(() => {
    resetCustomerRepository();
  });

  it('Kasus 1: Enrich same-home via updateCustomerLocation (GPS pin) -> kartu tetap/naik jadi primary', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Novi Test', TENANT);

    // 1. Awalnya customer mengisi form perkiraan area (estimated_area) dengan typo kecamatan
    const initialLoc = await customerService.updateCustomerLocation(
      customer.id,
      {
        address: 'jln tambak asri GG 2 no 6',
        kecamatan: 'morokrembangab',
        kelurahan: null,
        kota: 'sby',
        lat: -7.2304601,
        lng: 112.718192,
        locationSource: 'estimated_area' as any,
      },
      TENANT
    );
    expect(initialLoc).not.toBeNull();

    const addressesStep1 = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(addressesStep1).toHaveLength(1);
    expect(addressesStep1[0].isPrimary).toBe(true);
    expect(addressesStep1[0].locationSource).toBe('estimated_area');

    // 2. Kemudian customer mengirimkan shareloc WhatsApp asli (gps_pin)
    // Titik ini memperkaya rumah yang sama (terdeteksi via addressesMatch toponimi)
    await customerService.updateCustomerLocation(
      customer.id,
      {
        address: 'jln tambak asri GG 2 no 6',
        kecamatan: 'Krembangan',
        kelurahan: 'Morokrembangan',
        kota: 'Kota Surabaya',
        lat: -7.23171112,
        lng: 112.71212724,
        locationSource: 'gps_pin' as any,
        isNewGpsInput: true,
      },
      TENANT
    );

    const addressesStep2 = await customerService.getSavedAddresses(customer.id, TENANT);
    // Tidak melahirkan kartu duplikat (dedup sukses)
    expect(addressesStep2).toHaveLength(1);
    // Kartu yang diperkaya tetap primary dan ter-upgrade ke gps_pin
    expect(addressesStep2[0].isPrimary).toBe(true);
    expect(addressesStep2[0].locationSource).toBe('gps_pin');
    expect(addressesStep2[0].lat).toBeCloseTo(-7.23171112, 6);
  });

  it('Kasus 2: Penambahan rumah kedua (new-home beda jalan) -> Rumah 2 tetap non-primary, Rumah 1 tetap primary', async () => {
    const phone = nextPhone();
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Dua Rumah', TENANT);

    // Rumah 1 (primary)
    await customerService.upsertSavedAddress(customer.id, {
      address: 'Jl. Rungkut Asri Timur No. 10',
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      lat: -7.320000,
      lng: 112.775000,
      locationSource: 'gps_pin',
      isPrimary: true,
    }, TENANT);

    // Tambah Rumah 2 via intake reservasi (beda jalan di kecamatan berbeda)
    const candidateRumah2 = {
      address: 'Jl. Ahmad Yani No. 88',
      kelurahan: 'Gayungan',
      kecamatan: 'Gayungan',
      kota: 'Surabaya',
      lat: -7.335000,
      lng: 112.730000,
      locationSource: 'gps_pin' as const,
    };

    const resolvedId = await resolveCustomerAddressId({
      customerId: customer.id,
      tenantId: TENANT,
      candidate: candidateRumah2,
    });

    const addresses = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(addresses).toHaveLength(2);

    const r1 = addresses.find((a) => a.address.includes('Rungkut'));
    const r2 = addresses.find((a) => a.id === resolvedId);

    // Invarian multi-rumah terjaga: Rumah 1 tetap primary, Rumah 2 tetap non-primary
    expect(r1?.isPrimary).toBe(true);
    expect(r2?.isPrimary).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { splitWilayahComposite } from '../../src/utils/wilayah-normalizer';
import { parseReservationText } from '../../src/utils/reservation-text-parser';
import { addressesMatch, wilayahTokenMatch, upsertAddressIntoList, type SavedCustomerAddress } from '../../src/domain/customer-address';

describe('Wilayah Composite Split & Token Match (Bunda Haniyyah Defense)', () => {
  it('1. splitWilayahComposite memisahkan "pacar Keling, Tambaksari" menjadi kelurahan dan kecamatan resmi', () => {
    const res = splitWilayahComposite('pacar Keling, Tambaksari');
    expect(res.kecamatan).toBe('Tambaksari');
    expect(res.kelurahan).toBe('pacar Keling');
  });

  it('2. splitWilayahComposite level-aware: "Tambaksari, Surabaya" tidak salah pecah menjadi kelurahan', () => {
    const res = splitWilayahComposite('Tambaksari, Surabaya');
    expect(res.kecamatan).toBe('Tambaksari');
    expect(res.kota).toBe('Surabaya');
    expect(res.kelurahan).toBeUndefined();
  });

  it('3. splitWilayahComposite level-aware: "Waru, Sidoarjo" mengenali Sidoarjo sebagai kota (bukan homonim kecamatan)', () => {
    const res = splitWilayahComposite('Waru, Sidoarjo');
    expect(res.kecamatan).toBe('Waru');
    expect(res.kota).toBe('Sidoarjo');
    expect(res.kelurahan).toBeUndefined();
  });

  it('4. wilayahTokenMatch memecah token koma/slash dan mencocokkan exact token', () => {
    expect(wilayahTokenMatch('pacar Keling, Tambaksari', 'Tambaksari')).toBe(true);
    expect(wilayahTokenMatch('Tambaksari', 'pacar Keling, Tambaksari')).toBe(true);
    // Anti-false positive substring:
    expect(wilayahTokenMatch('sukomanunggal', 'manunggal')).toBe(false);
  });

  it('5. addressesMatch menggabungkan kartu ghost form dengan kartu pin GPS Bunda Haniyyah', () => {
    const ghostCard = {
      address: '',
      kelurahan: null,
      kecamatan: 'pacar Keling, Tambaksari',
      kota: 'Surabaya',
      lat: null,
      lng: null,
    };
    const gpsCard = {
      address: 'jl.gersikan VI no 8',
      kelurahan: 'Pacarkembang',
      kecamatan: 'Tambaksari',
      kota: 'Kota Surabaya',
      lat: -7.2556424,
      lng: 112.7640328,
    };

    expect(addressesMatch(ghostCard as any, gpsCard as any)).toBe(true);
    expect(addressesMatch(gpsCard as any, ghostCard as any)).toBe(true);
  });

  it('6. upsertAddressIntoList menggabungkan kartu ghost dengan input GPS menjadi tepat 1 entri', () => {
    const nowIso = new Date().toISOString();
    const ghost: SavedCustomerAddress = {
      id: 'ghost-1',
      label: 'Rumah pacar Keling, Tambaksari',
      address: '',
      kelurahan: null,
      kecamatan: 'pacar Keling, Tambaksari',
      kota: 'Surabaya',
      lat: null,
      lng: null,
      distanceKm: null,
      ongkir: null,
      landmark: null,
      locationSource: null,
      isPrimary: true,
      createdAt: nowIso,
      lastUsedAt: nowIso,
    };

    const gpsInput = {
      address: 'jl.gersikan VI no 8',
      kelurahan: 'Pacarkembang',
      kecamatan: 'Tambaksari',
      kota: 'Kota Surabaya',
      lat: -7.2556424,
      lng: 112.7640328,
      distanceKm: 16.72,
      ongkir: 25000,
      locationSource: 'gps_pin' as const,
      isPrimary: true,
    };

    const { list, entry } = upsertAddressIntoList([ghost], gpsInput, nowIso);
    expect(list).toHaveLength(1);
    expect(entry.id).toBe('ghost-1');
    expect(entry.address).toBe('jl.gersikan VI no 8');
    expect(entry.kelurahan).toBe('Pacarkembang');
    expect(entry.kecamatan).toBe('Tambaksari');
    expect(entry.lat).toBe(-7.2556424);
  });

  it('7. parseReservationText mengekstrak kecamatan dan kelurahan saat format koma diisi di baris Kec', () => {
    const raw = `Berikut list untuk reservasi : 
Hari dan tanggal : Sabtu 31 Oktober 2026 jam 09.30
Nama Bunda: Haniyyah
Alamat & Shareloc : jl.gersikan VI no 8
Kec : pacar Keling, Tambaksari
Kota : Surabaya
No. Hp : 087788800765
Nama Bayi : Reyza
Usia Bayi/Anak : 7 bln
Treatment : baby pijat pulih ceria`;

    const res = parseReservationText(raw);
    expect(res.success).toBe(true);
    expect(res.reservation?.name).toBe('Haniyyah');
    expect(res.reservation?.address).toBe('jl.gersikan VI no 8');
    expect(res.reservation?.kec).toBe('Tambaksari');
    expect(res.reservation?.kelurahan).toBe('pacar Keling');
    expect(res.reservation?.kota).toBe('Surabaya');
  });

  it('8. Anti-Overmerge Guard: dua rumah beda nomor/jalan di kecamatan yang sama TETAP terpisah 2 entri', () => {
    const nowIso = new Date().toISOString();
    const house1: SavedCustomerAddress = {
      id: 'house-1',
      label: 'Rumah 1',
      address: 'Jl. Gersikan VI No. 8',
      kelurahan: 'Pacarkembang',
      kecamatan: 'Tambaksari',
      kota: 'Kota Surabaya',
      lat: -7.255,
      lng: 112.764,
      distanceKm: 16.7,
      ongkir: 25000,
      landmark: null,
      locationSource: 'gps_pin',
      isPrimary: true,
      createdAt: nowIso,
      lastUsedAt: nowIso,
    };

    const house2Input = {
      address: 'Jl. Ploso Baru No. 20',
      kelurahan: 'Ploso',
      kecamatan: 'Tambaksari',
      kota: 'Kota Surabaya',
      lat: -7.260,
      lng: 112.770,
      distanceKm: 17.0,
      ongkir: 25000,
      locationSource: 'gps_pin' as const,
      isPrimary: false,
    };

    const { list } = upsertAddressIntoList([house1], house2Input, nowIso);
    expect(list).toHaveLength(2);
    expect(list.find((a) => a.id === 'house-1')?.isPrimary).toBe(true);
  });

  it('9. parseReservationText menangani label gabungan "Kel / Kec" atau "Kec/Kel" secara aman', () => {
    const raw = `Berikut reservasi:
Nama Bunda: Siti
Alamat: Jl. Melati 10
Kel / Kec: Pacar Keling, Tambaksari
Kota: Surabaya
Treatment: baby massage`;

    const res = parseReservationText(raw);
    expect(res.success).toBe(true);
    expect(res.reservation?.kec).toBe('Tambaksari');
    expect(res.reservation?.kelurahan).toBe('Pacar Keling');
  });

  it('10. customerService.updateCustomerLocation dual-write: safeKelurahan masuk ke customers DAN syncSavedAddressFromLocation, serta preferences.full_address terisi', async () => {
    const { customerService } = await import('../../src/services/customer.service');
    const tenantId = 'default-tenant';

    // Seed mock customer in memory
    const existing = await customerService.getOrCreateCustomer('628111222333', 'Bunda Test', tenantId);
    const custId = existing.id;

    let savedLocCapture: any = null;
    const spySync = (customerService as any).syncSavedAddressFromLocation;
    (customerService as any).syncSavedAddressFromLocation = async (cust: any, tId: string, writeLoc: any) => {
      savedLocCapture = writeLoc;
      return spySync.call(customerService, cust, tId, writeLoc);
    };

    try {
      const updated = await customerService.updateCustomerLocation(custId, {
        address: 'Jl. Test No. 123',
        kecamatan: 'pacar Keling, Tambaksari',
      }, tenantId);

      // 1. customers.kelurahan harus berisi hasil split
      expect(updated.kelurahan).toBe('pacar Keling');
      expect(updated.kecamatan).toBe('Tambaksari');

      // 2. preferences.address & full_address keduanya harus terisi
      const prefs = (updated.preferences as any) || {};
      expect(prefs.address).toBe('Jl. Test No. 123');
      expect(prefs.full_address).toBe('Jl. Test No. 123');

      // 3. writeLoc (buku alamat) harus memakai safeKelurahan, BUKAN undefined/null
      expect(savedLocCapture).not.toBeNull();
      expect(savedLocCapture.kelurahan).toBe('pacar Keling');
      expect(savedLocCapture.kecamatan).toBe('Tambaksari');
      expect(savedLocCapture.address).toBe('Jl. Test No. 123');
    } finally {
      (customerService as any).syncSavedAddressFromLocation = spySync;
    }
  });
});

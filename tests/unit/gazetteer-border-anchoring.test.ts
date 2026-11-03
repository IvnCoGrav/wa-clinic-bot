import { describe, it, expect } from 'vitest';
import { findNearestSubdistrict, haversineKm } from '../../src/utils/gazetteer';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { customerService } from '../../src/services/customer.service';
import { LocationSource } from '@prisma/client';

describe('Gazetteer Border-Margin Disambiguation & Semantic Anchoring', () => {
  const PAKUWON_LAT = -7.238602638244629;
  const PAKUWON_LNG = 112.67414855957031;

  it('1. Tanpa hint: koordinat Grand Pakuwon tetap memilih Tambak Sarioso (backward compatibility aman)', () => {
    const res = findNearestSubdistrict(PAKUWON_LAT, PAKUWON_LNG);
    expect(res).not.toBeNull();
    expect(res!.kelurahan).toBe('Tambak Sarioso');
    expect(res!.kecamatan).toBe('Asemrowo');
    expect(res!.distanceKm).toBeCloseTo(1.753, 2);
    expect(res!.isHintMatched).toBe(false);
  });

  it('2. Dengan hint kecamatan "Tandes": memilih Manukan Wetan (centroid terdekat di Tandes dalam border margin)', () => {
    const res = findNearestSubdistrict(PAKUWON_LAT, PAKUWON_LNG, 35, {
      preferredKecamatan: 'Tandes',
    });
    expect(res).not.toBeNull();
    expect(res!.kelurahan).toBe('Manukan Wetan');
    expect(res!.kecamatan).toBe('Tandes');
    expect(res!.distanceKm).toBeCloseTo(1.814, 2);
    expect(res!.isHintMatched).toBe(true);
  });

  it('3. Dengan hint teks alamat "Banjar Sugihan": memilih Banjar Sugihan (kelurahan exact match)', () => {
    const res = findNearestSubdistrict(PAKUWON_LAT, PAKUWON_LNG, 35, {
      addressTextHint: 'Grand Pakuwon Cluster Adelaide JF9/11, Banjar Sugihan',
    });
    expect(res).not.toBeNull();
    expect(res!.kelurahan).toBe('Banjar Sugihan');
    expect(res!.kecamatan).toBe('Tandes');
    expect(res!.distanceKm).toBeCloseTo(2.179, 2);
    expect(res!.isHintMatched).toBe(true);
  });

  it('4. Dengan hint wilayah jauh ("Rungkut"): hint diabaikan dan fallback ke titik terdekat nyata (anti-bias teks palsu)', () => {
    const res = findNearestSubdistrict(PAKUWON_LAT, PAKUWON_LNG, 35, {
      preferredKecamatan: 'Rungkut',
    });
    expect(res).not.toBeNull();
    expect(res!.kelurahan).toBe('Tambak Sarioso');
    expect(res!.kecamatan).toBe('Asemrowo');
    expect(res!.isHintMatched).toBe(false);
  });

  it('5. Kontrak geocodingService.reverseGeocode mengembalikan labelSource centroid & isEstimatedCentroid', async () => {
    const res = await geocodingService.reverseGeocode(PAKUWON_LAT, PAKUWON_LNG, {
      preferredKecamatan: 'Tandes',
    });
    expect(res.isPrecise).toBe(true);
    expect(res.kecamatan).toBe('Tandes');
    expect(res.isEstimatedCentroid).toBe(true);
    expect(res.labelSource).toBe('centroid');
  });

  it('6. Titik invalid atau di luar jangkauan tetap aman (fail-closed)', async () => {
    expect(findNearestSubdistrict(NaN, PAKUWON_LNG)).toBeNull();
    expect(findNearestSubdistrict(PAKUWON_LAT, NaN)).toBeNull();
    expect(findNearestSubdistrict(-15.0, 110.0)).toBeNull();

    const farRes = await geocodingService.reverseGeocode(-15.0, 110.0);
    expect(farRes.isPrecise).toBe(false);
    expect(farRes.kecamatan).toBeUndefined();
  });
});

describe('updateCustomerLocation Write Seam Label Overwrite Guard', () => {
  it('7. Estimasi centroid tidak boleh menimpa kecamatan lama yang sudah valid', async () => {
    const testPhone = '6289999111222';
    const cust = await customerService.getOrCreateCustomer(testPhone, 'Bunda Test Guard', 'default-tenant');

    // Set awal: Kecamatan Tandes
    await customerService.updateCustomerLocation(
      cust.id,
      {
        address: 'Grand Pakuwon',
        kelurahan: 'Banjar Sugihan',
        kecamatan: 'Tandes',
        kota: 'Kota Surabaya',
      },
      'default-tenant'
    );

    // Update berikutnya dari estimasi centroid (misal reverse geocode menghasilkan Asemrowo)
    const updated = await customerService.updateCustomerLocation(
      cust.id,
      {
        kelurahan: 'Tambak Sarioso',
        kecamatan: 'Asemrowo',
        kota: 'Kota Surabaya',
        lat: -7.2386,
        lng: 112.6741,
        isNativePin: true,
        isEstimatedCentroid: true,
        labelSource: 'centroid',
      },
      'default-tenant'
    );

    // Kecamatan lama (Tandes) WAJIB dipertahankan
    expect(updated.kecamatan).toBe('Tandes');
  });
});

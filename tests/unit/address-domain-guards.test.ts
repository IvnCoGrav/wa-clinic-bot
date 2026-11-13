import { describe, it, expect } from 'vitest';
import {
  addressesMatch,
  selectEnrichmentTarget,
  upsertAddressIntoList,
  type SavedCustomerAddress,
} from '../../src/domain/customer-address';

function card(over: Partial<SavedCustomerAddress> = {}): SavedCustomerAddress {
  return {
    id: over.id || 'card-1',
    label: over.label || 'Rumah',
    address: over.address ?? 'Jl. Melati No. 10',
    kelurahan: over.kelurahan ?? 'Kebraon',
    kecamatan: over.kecamatan ?? 'Karang Pilang',
    kota: over.kota ?? 'Surabaya',
    lat: over.lat ?? -7.3375,
    lng: over.lng ?? 112.6988,
    distanceKm: over.distanceKm ?? 9.5,
    ongkir: over.ongkir ?? 10000,
    landmark: over.landmark ?? null,
    locationSource: over.locationSource ?? 'gps_pin',
    isPrimary: over.isPrimary ?? true,
    createdAt: over.createdAt || '2026-01-01T00:00:00.000Z',
    lastUsedAt: over.lastUsedAt || '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('addressesMatch — pagar wilayah', () => {
  it('jalan + nomor sama tetapi kecamatan jelas berbeda → TIDAK match', () => {
    expect(addressesMatch(
      { address: 'Jl. Melati No. 10', kecamatan: 'Karang Pilang', kota: 'Surabaya' },
      { address: 'Jl. Melati No. 10', kecamatan: 'Buduran', kota: 'Surabaya' }
    )).toBe(false);
  });

  it('jalan + nomor + kecamatan sama → match', () => {
    expect(addressesMatch(
      { address: 'Jl. Melati No. 10', kecamatan: 'Karang Pilang', kota: 'Surabaya' },
      { address: 'Jl. Melati No. 10', kecamatan: 'Karang Pilang', kota: 'Surabaya' }
    )).toBe(true);
  });

  it('titik ≤150 m tetapi kota berbeda → TIDAK match', () => {
    expect(addressesMatch(
      { lat: -7.3375, lng: 112.6988, kota: 'Surabaya' },
      { lat: -7.3375, lng: 112.6998, kota: 'Sidoarjo' }
    )).toBe(false);
  });

  it('titik ≤150 m dan kota sama → match (bukti fisik)', () => {
    expect(addressesMatch(
      { lat: -7.3375, lng: 112.6988, kota: 'Surabaya' },
      { lat: -7.3375, lng: 112.6998, kota: 'Surabaya' }
    )).toBe(true);
  });
});

describe('upsertAddressIntoList — anti-downgrade GPS', () => {
  it('kartu gps_pin + input manual/estimasi → koordinat presisi dipertahankan', () => {
    const prev = card({ lat: -7.3375, lng: 112.6988 });
    const result = upsertAddressIntoList(
      [prev],
      {
        id: prev.id,
        address: 'Jl. Melati No. 10 (koreksi teks)',
        lat: -7.4255,
        lng: 112.7214,
        locationSource: 'estimated_area',
      },
      '2026-11-13T00:00:00.000Z'
    );

    expect(result.entry.address).toBe('Jl. Melati No. 10 (koreksi teks)');
    expect(result.entry.lat).toBe(-7.3375);
    expect(result.entry.lng).toBe(112.6988);
    expect(result.entry.locationSource).toBe('gps_pin');
  });

  it('kartu gps_pin + input pin GPS baru → koordinat boleh berubah', () => {
    const prev = card({ lat: -7.3375, lng: 112.6988 });
    const result = upsertAddressIntoList(
      [prev],
      {
        id: prev.id,
        address: 'Jl. Melati No. 10',
        lat: -7.4255,
        lng: 112.7214,
        locationSource: 'gps_pin',
      },
      '2026-11-13T00:00:00.000Z'
    );

    expect(result.entry.lat).toBe(-7.4255);
    expect(result.entry.lng).toBe(112.7214);
    expect(result.entry.locationSource).toBe('gps_pin');
  });

  it('selectEnrichmentTarget tidak menjadikan kartu gps_pin target input estimasi', () => {
    const gpsCard = card({ locationSource: 'gps_pin', lat: -7.3375, lng: 112.6988 });
    const target = selectEnrichmentTarget([gpsCard], {
      lat: -7.3380,
      lng: 112.6990,
      kelurahan: 'Kebraon',
      kecamatan: 'Karang Pilang',
      locationSource: 'estimated_area',
    });
    expect(target).toBeNull();
  });
});

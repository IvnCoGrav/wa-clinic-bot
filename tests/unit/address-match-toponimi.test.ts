import { describe, it, expect } from 'vitest';
import { addressesMatch } from '../../src/domain/customer-address';

/**
 * Mikro 1.1 — Tes adversarial toponimi & anti-over-merge (Fase 1 Plan Revisi-1)
 *
 * Mencegah split-brain kartu alamat akibat:
 *  - Typo penulisan toponimi / nama kecamatan-kelurahan
 *  - Form intake yang menukar posisi kelurahan dan kecamatan
 *  - Selisih jarak sentroid geocoding dengan titik GPS fisik hingga toleransi 3 km
 *
 * Sekaligus menjaga INVARIAN MUTLAK:
 *  - Anti-over-merge: jalan berbeda dalam kecamatan/kota sama HARUS TETAP 2 entri
 *    (perlindungan multi-rumah / Rumah 2).
 *  - Jarak >3.000 m walau nama jalan identik HARUS TETAP 2 entri (beda cabang/kota).
 */

describe('Mikro 1.1 — addressesMatch toponimi & anti-over-merge', () => {
  it('Kasus 1: Jalan sama + typo toponimi kecamatan (morokrembangab vs Krembangan) + kelurahan Morokrembangan + jarak 680m -> MATCH', () => {
    // Data riil Bunda Novi Hariyanti
    const formEstimated = {
      address: 'jln tambak asri GG 2 no 6',
      kelurahan: null,
      kecamatan: 'morokrembangab',
      kota: 'sby',
      lat: -7.2304601,
      lng: 112.718192,
    };
    const gpsShareloc = {
      address: 'jln tambak asri GG 2 no 6',
      kelurahan: 'Morokrembangan',
      kecamatan: 'Krembangan',
      kota: 'Kota Surabaya',
      lat: -7.23171112,
      lng: 112.71212724,
    };

    expect(addressesMatch(formEstimated, gpsShareloc)).toBe(true);
    // Simetri (b, a)
    expect(addressesMatch(gpsShareloc, formEstimated)).toBe(true);
  });

  it('Kasus 2: Jalan sama + kelurahan tertukar ke kecamatan pada form intake -> MATCH', () => {
    const intakeSwap = {
      address: 'Jl. Rungkut Asri Timur No. 12',
      kelurahan: 'Rungkut', // tertukar: kecamatan ditaruh di kelurahan
      kecamatan: 'Rungkut Kidul', // tertukar: kelurahan ditaruh di kecamatan
      kota: 'Surabaya',
      lat: -7.320100,
      lng: 112.775000,
    };
    const officialAddress = {
      address: 'Jl. Rungkut Asri Timur No. 12',
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      lat: -7.321200,
      lng: 112.776100,
    };

    expect(addressesMatch(intakeSwap, officialAddress)).toBe(true);
    expect(addressesMatch(officialAddress, intakeSwap)).toBe(true);
  });

  it('Kasus 3: Jalan BERBEDA di kecamatan sama & kota sama -> TETAP BEDA (anti-regresi rumah-2)', () => {
    const rumah1 = {
      address: 'Jl. Kedungklinter 1 No. 80',
      kelurahan: 'Keputih',
      kecamatan: 'Sukolilo',
      kota: 'Surabaya',
      lat: -7.289199,
      lng: 112.7970673,
    };
    const rumah2 = {
      address: 'Jl. Klampis Jaya No. 25',
      kelurahan: 'Klampis Ngasem',
      kecamatan: 'Sukolilo',
      kota: 'Surabaya',
      lat: -7.295000,
      lng: 112.780000,
    };

    expect(addressesMatch(rumah1, rumah2)).toBe(false);
    expect(addressesMatch(rumah2, rumah1)).toBe(false);
  });

  it('Kasus 4: Jalan beda + kota beda -> TETAP BEDA', () => {
    const alamatSurabaya = {
      address: 'Jl. Ahmad Yani No. 1',
      kecamatan: 'Wonokromo',
      kota: 'Surabaya',
      lat: -7.305000,
      lng: 112.735000,
    };
    const alamatSidoarjo = {
      address: 'Jl. Pahlawan No. 10',
      kecamatan: 'Sidoarjo',
      kota: 'Sidoarjo',
      lat: -7.450000,
      lng: 112.715000,
    };

    expect(addressesMatch(alamatSurabaya, alamatSidoarjo)).toBe(false);
    expect(addressesMatch(alamatSidoarjo, alamatSurabaya)).toBe(false);
  });

  it('Kasus 5: Jalan sama persis tetapi jarak > 3.000 m (misal Jl. Pahlawan di area berbeda/jauh) -> TETAP BEDA', () => {
    const titikUtara = {
      address: 'Jl. Pahlawan No. 5',
      kecamatan: 'Bubutan',
      kota: 'Surabaya',
      lat: -7.245000,
      lng: 112.738000,
    };
    const titikSelatan = {
      address: 'Jl. Pahlawan No. 5',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.355000, // selisih ~12 km
      lng: 112.725000,
    };

    expect(addressesMatch(titikUtara, titikSelatan)).toBe(false);
    expect(addressesMatch(titikSelatan, titikUtara)).toBe(false);
  });

  it('Kasus 6 (A-005): Nama perumahan tanpa nomor di kecamatan berbeda, jarak < 3 km -> TIDAK MATCH', () => {
    const rumahA = {
      address: 'Perumahan Mutiara Indah',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.350000,
      lng: 112.720000,
    };
    const rumahB = {
      address: 'Perumahan Mutiara Indah',
      kecamatan: 'Gedangan',
      kota: 'Sidoarjo',
      lat: -7.355000, // jarak ~600 m
      lng: 112.720000,
    };

    expect(addressesMatch(rumahA, rumahB)).toBe(false);
    expect(addressesMatch(rumahB, rumahA)).toBe(false);
  });

  it('Kasus 7 (A-005): Jalan dengan nomor eksplisit (No. 12) di kecamatan berbeda, jarak < 3 km -> MATCH', () => {
    const rumahA = {
      address: 'Jl. Mutiara Indah No. 12',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.350000,
      lng: 112.720000,
    };
    const rumahB = {
      address: 'Jl. Mutiara Indah No. 12',
      kecamatan: 'Gedangan',
      kota: 'Sidoarjo',
      lat: -7.355000, // jarak ~600 m (pergeseran reverse geocoding batas kec)
      lng: 112.720000,
    };

    expect(addressesMatch(rumahA, rumahB)).toBe(true);
    expect(addressesMatch(rumahB, rumahA)).toBe(true);
  });

  it('Kasus 8 (A-005): Jalan dengan blok/nomor (Blok C7) di kecamatan berbeda, jarak < 3 km -> MATCH', () => {
    const rumahA = {
      address: 'Jl. Mutiara Indah Blok C7',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.350000,
      lng: 112.720000,
    };
    const rumahB = {
      address: 'Jl. Mutiara Indah Blok C7',
      kecamatan: 'Gedangan',
      kota: 'Sidoarjo',
      lat: -7.355000,
      lng: 112.720000,
    };

    expect(addressesMatch(rumahA, rumahB)).toBe(true);
    expect(addressesMatch(rumahB, rumahA)).toBe(true);
  });

  it('Kasus 9 (A-005): Dua rumah nomor berbeda (No. 12 vs No. 14) di jalan sama, kecamatan beda -> TIDAK MATCH', () => {
    const rumahA = {
      address: 'Jl. Mutiara Indah No. 12',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.350000,
      lng: 112.720000,
    };
    const rumahB = {
      address: 'Jl. Mutiara Indah No. 14',
      kecamatan: 'Gedangan',
      kota: 'Sidoarjo',
      lat: -7.355000, // jarak ~550m (>150m agar menguji dedup teks, bukan GPS pin point)
      lng: 112.720000,
    };

    expect(addressesMatch(rumahA, rumahB)).toBe(false);
    expect(addressesMatch(rumahB, rumahA)).toBe(false);
  });
});

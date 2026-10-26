import { describe, it, expect } from 'vitest';
import { addressesMatch as backendMatch, SAME_POINT_MAX_METERS as BE_MAX } from '../../src/domain/customer-address';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { addressesMatch as mirrorMatch, SAME_POINT_MAX_METERS as FE_MAX } from '../../packages/admin-dashboard/src/utils/addressMatch';

/**
 * F3 — Tes paritas drift util cermin FE
 * (`packages/admin-dashboard/src/utils/addressMatch.ts` vs
 * `src/domain/customer-address.ts`).
 *
 * Kedua implementasi HARUS menjawab SEMUA vektor secara IDENTIK. Bila salah
 * satu sisi berubah tanpa melengkapi sisanya, tes ini MERAH di CI — mencegah
 * badge "rumah baru" FE menebak beda dengan dedup server.
 */

const VECTORS: { name: string; a: any; b: any; expected: boolean }[] = [
  {
    name: 'koordinat sama <150 m (beda tulisan jalan) → match',
    a: { address: 'Jl. Rungkut Asri 10', lat: -7.289199, lng: 112.7970673 },
    b: { address: 'Jl Rungkut Asri X', lat: -7.289250, lng: 112.7970300 },
    expected: true, // ~6 m
  },
  {
    name: 'koordinat beda >150 m → fallback teks; jalan beda → NO match',
    a: { address: 'Jl. Rungkut Asri 10', lat: -7.289199, lng: 112.7970673 },
    b: { address: 'Jl. Kedungklinter 1 No. 80', lat: -7.291500, lng: 112.8050000 },
    expected: false,
  },
  {
    name: 'jalan + kecamatan identik, kelurahan kompatibel → match',
    a: { address: 'Jl. Kedungklinter 1 No. 80', kelurahan: null, kecamatan: 'Keputih', kota: 'Surabaya' },
    b: { address: 'Jl. Kedungklinter 1 No. 80', kelurahan: 'Keputih', kecamatan: 'Keputih', kota: 'Surabaya' },
    expected: true,
  },
  {
    name: 'jalan beda dalam kecamatan SAMA (keduanya ber-teks) → NO match (rumah-2 aman)',
    a: { address: 'Jl. Kedungklinter 1 No. 80', kelurahan: 'Keputih', kecamatan: 'Sukolilo', kota: 'Surabaya' },
    b: { address: 'Jl. Klampis Jaya 20', kelurahan: 'Keputih', kecamatan: 'Sukolilo', kota: 'Surabaya' },
    expected: false,
  },
  {
    name: 'tanpa teks jalan di kedua sisi + kelurahan+kecamatan identik → match',
    a: { address: '', kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya' },
    b: { address: null, kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya' },
    expected: true,
  },
  {
    name: 'pengayaan asimetris: tepat SATU sisi ber-teks jalan + kecamatan sama → match (rumah sama sedang dilengkapi)',
    a: { address: 'Jl. Kedungklinter 1 No. 80', kelurahan: 'Keputih', kecamatan: 'Sukolilo', kota: 'Surabaya' },
    b: { address: null, kelurahan: 'Keputih', kecamatan: 'Sukolilo', kota: 'Surabaya' },
    expected: true,
  },
  {
    name: 'pengayaan asimetris: kecamatan beda → NO match',
    a: { address: 'Jl. Kedungklinter 1 No. 80', kelurahan: 'Keputih', kecamatan: 'Sukolilo', kota: 'Surabaya' },
    b: { address: null, kelurahan: 'Runghut', kecamatan: 'Rungkut', kota: 'Surabaya' },
    expected: false,
  },
  {
    name: 'kapitalisasi & spasi berantakan → tetap match (norm)',
    a: { address: '  Jl. KEDUNGKLINTER  1 No. 80 ', kecamatan: 'Sukolilo' },
    b: { address: 'jl. kedungklinter 1 no. 80', kecamatan: 'sukolilo' },
    expected: true,
  },
  {
    name: 'semua kosong → NO match',
    a: {},
    b: {},
    expected: false,
  },
  // ── Vektor Toponimi & Anti-Over-Merge (Fase 1 Plan Revisi-1) ─────────────
  {
    name: 'jalan sama + typo toponimi kecamatan (morokrembangab vs Krembangan) + kelurahan Morokrembangan + jarak 680m → match',
    a: {
      address: 'jln tambak asri GG 2 no 6',
      kelurahan: null,
      kecamatan: 'morokrembangab',
      kota: 'sby',
      lat: -7.2304601,
      lng: 112.718192,
    },
    b: {
      address: 'jln tambak asri GG 2 no 6',
      kelurahan: 'Morokrembangan',
      kecamatan: 'Krembangan',
      kota: 'Kota Surabaya',
      lat: -7.23171112,
      lng: 112.71212724,
    },
    expected: true,
  },
  {
    name: 'jalan sama + kelurahan tertukar ke kecamatan pada intake → match',
    a: {
      address: 'Jl. Rungkut Asri Timur No. 12',
      kelurahan: 'Rungkut',
      kecamatan: 'Rungkut Kidul',
      kota: 'Surabaya',
      lat: -7.320100,
      lng: 112.775000,
    },
    b: {
      address: 'Jl. Rungkut Asri Timur No. 12',
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      lat: -7.321200,
      lng: 112.776100,
    },
    expected: true,
  },
  {
    name: 'jalan berbeda di kecamatan sama & kota sama → TETAP BEDA (anti-regresi rumah-2)',
    a: {
      address: 'Jl. Kedungklinter 1 No. 80',
      kelurahan: 'Keputih',
      kecamatan: 'Sukolilo',
      kota: 'Surabaya',
      lat: -7.289199,
      lng: 112.7970673,
    },
    b: {
      address: 'Jl. Klampis Jaya No. 25',
      kelurahan: 'Klampis Ngasem',
      kecamatan: 'Sukolilo',
      kota: 'Surabaya',
      lat: -7.295000,
      lng: 112.780000,
    },
    expected: false,
  },
  {
    name: 'jalan beda + kota beda → TETAP BEDA',
    a: {
      address: 'Jl. Ahmad Yani No. 1',
      kecamatan: 'Wonokromo',
      kota: 'Surabaya',
      lat: -7.305000,
      lng: 112.735000,
    },
    b: {
      address: 'Jl. Pahlawan No. 10',
      kecamatan: 'Sidoarjo',
      kota: 'Sidoarjo',
      lat: -7.450000,
      lng: 112.715000,
    },
    expected: false,
  },
  {
    name: 'jalan sama persis tetapi jarak > 3.000 m → TETAP BEDA',
    a: {
      address: 'Jl. Pahlawan No. 5',
      kecamatan: 'Bubutan',
      kota: 'Surabaya',
      lat: -7.245000,
      lng: 112.738000,
    },
    b: {
      address: 'Jl. Pahlawan No. 5',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.355000,
      lng: 112.725000,
    },
    expected: false,
  },
  {
    name: 'tanpa teks jalan di kedua sisi + kelurahan null di kedua sisi + kecamatan sama → match (anti duplikat Rumah Sedati 2)',
    a: { address: '', kelurahan: null, kecamatan: 'Sedati', kota: 'Sidoarjo' },
    b: { address: '', kelurahan: null, kecamatan: 'Sedati', kota: 'Sidoarjo' },
    expected: true,
  },
  {
    name: 'alamat jalan spesifik sama persis (<3km) di kota sama beda kecamatan karena pergeseran batas peta → match',
    a: {
      address: 'Grand Pakuwon Cluster Adelaide JF9/11',
      kelurahan: 'Banjar Sugihan',
      kecamatan: 'Tandes',
      kota: 'Surabaya',
      lat: -7.252370,
      lng: 112.660090,
    },
    b: {
      address: 'Grand Pakuwon Cluster Adelaide JF9/11',
      kelurahan: 'Tambak Sarioso',
      kecamatan: 'Asemrowo',
      kota: 'Surabaya',
      lat: -7.238602,
      lng: 112.674148,
    },
    expected: true,
  },
];

describe('F3 — paritas cermin addressMatch (backend domain vs FE mirror)', () => {
  it('konstanta threshold identik', () => {
    expect(FE_MAX).toBe(BE_MAX);
  });

  for (const v of VECTORS) {
    it(`vektor: ${v.name}`, () => {
      const be = backendMatch(v.a, v.b);
      const fe = mirrorMatch(v.a, v.b);
      expect({ fe, be }).toEqual({ fe: v.expected, be: v.expected });
      // Simetri (a,b) vs (b,a) harus konsisten di kedua implementasi.
      expect(backendMatch(v.b, v.a)).toBe(be);
      expect(mirrorMatch(v.b, v.a)).toBe(fe);
    });
  }
});

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

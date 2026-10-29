import { describe, expect, it } from 'vitest';
import {
  formatReservationArea,
  formatReservationKelurahan,
} from '../../packages/admin-dashboard/src/utils/reservationAddress';

/**
 * F-33 (lanjutan): kartu view Harian cukup menampilkan KELURAHAN, bukan
 * gabungan "kelurahan, kecamatan" yang memakan lebar.
 *
 * Catatan data produksi (30 hari): 337/1001 customer punya `kelurahan`,
 * 413/1001 punya `kecamatan`. Karena itu cadangan ke kecamatan WAJIB ada —
 * tanpa cadangan, 2 dari 3 kartu kehilangan label wilayah sama sekali.
 */
describe('formatReservationKelurahan', () => {
  it('mengembalikan kelurahan saja (tanpa koma, tanpa kecamatan)', () => {
    expect(
      formatReservationKelurahan({
        customer: { kelurahan: 'Mulyorejo', kecamatan: 'Mulyorejo', kota: 'Surabaya' },
      })
    ).toBe('Mulyorejo');

    expect(
      formatReservationKelurahan({
        customer: { kelurahan: 'Karang Pilang', kecamatan: 'Karangpilang' },
      })
    ).toBe('Karang Pilang');
  });

  it('jatuh ke kecamatan bila kelurahan kosong (kasus mayoritas produksi)', () => {
    expect(
      formatReservationKelurahan({ customer: { kelurahan: null, kecamatan: 'Rungkut' } })
    ).toBe('Rungkut');
    expect(
      formatReservationKelurahan({ customer: { kelurahan: '   ', kecamatan: 'Wonokromo' } })
    ).toBe('Wonokromo');
  });

  it('mengembalikan string kosong bila tidak ada data wilayah', () => {
    expect(formatReservationKelurahan({ customer: { kelurahan: null, kecamatan: null } })).toBe('');
    expect(formatReservationKelurahan({ customer: {} })).toBe('');
    expect(formatReservationKelurahan({})).toBe('');
    expect(formatReservationKelurahan(null)).toBe('');
    expect(formatReservationKelurahan(undefined)).toBe('');
  });

  it('memangkas spasi berlebih dari data lama', () => {
    expect(formatReservationKelurahan({ customer: { kelurahan: '  Gubeng  ' } })).toBe('Gubeng');
  });

  it('tidak crash untuk tipe data salah', () => {
    expect(
      formatReservationKelurahan({
        customer: { kelurahan: 123 as unknown as string, kecamatan: {} as unknown as string },
      })
    ).toBe('');
  });

  it('tidak mengubah perilaku formatReservationArea (dipakai Bulanan & Mingguan)', () => {
    const res = { customer: { kelurahan: 'Mulyorejo', kecamatan: 'Mulyorejo' } };
    // Duplikasi dilebur, bukan dihapus: perilaku lama wajib tetap.
    expect(formatReservationArea(res)).toBe('Mulyorejo');
    expect(formatReservationKelurahan(res)).toBe('Mulyorejo');

    const dua = { customer: { kelurahan: 'Gubeng', kecamatan: 'Gubeng Barat' } };
    expect(formatReservationArea(dua)).toBe('Gubeng, Gubeng Barat');
    expect(formatReservationKelurahan(dua)).toBe('Gubeng');
  });
});

import { describe, expect, it } from 'vitest';
import {
  filterActiveStaff,
  isActiveStaff,
} from '../../packages/admin-dashboard/src/utils/staffColors';

/**
 * F-35: `GET /api/admin/staff` mengembalikan SELURUH staff tenant tanpa filter
 * `active`, sehingga akun uji nonaktif ikut tampil sebagai "bidan" di legenda.
 *
 * Daftar di bawah meniru data produksi apa adanya:
 *   3ee09a0b Bidan Testing Yusi  active=false THERAPIST
 *   303695b1 Staff Bidan         active=true  THERAPIST
 *   f88cedf5 Bidan Yusi F        active=true  ADMIN_CS
 *   38319d02 Bidan Hanifah       active=true  THERAPIST
 *   2eef2d61 Bidan Thabita       active=true  THERAPIST
 *   8c04602f Admin               active=true  SUPER_ADMIN
 */
const STAFF_PRODUKSI = [
  { id: '3ee09a0b', name: 'Bidan Testing Yusi', active: false },
  { id: '303695b1', name: 'Staff Bidan', active: true },
  { id: 'f88cedf5', name: 'Bidan Yusi F', active: true },
  { id: '38319d02', name: 'Bidan Hanifah', active: true },
  { id: '2eef2d61', name: 'Bidan Thabita', active: true },
  { id: '8c04602f', name: 'Admin', active: true },
];

describe('isActiveStaff', () => {
  it('menolak staff dengan active=false', () => {
    expect(isActiveStaff({ active: false })).toBe(false);
  });

  it('menerima staff aktif', () => {
    expect(isActiveStaff({ active: true })).toBe(true);
  });

  it('menganggap aktif bila field active tidak dikirim (backward compatible)', () => {
    // Endpoint lama / payload parsial tidak boleh menyembunyikan seluruh legenda.
    expect(isActiveStaff({})).toBe(true);
    expect(isActiveStaff({ active: null })).toBe(true);
    expect(isActiveStaff({ active: undefined })).toBe(true);
  });

  it('menolak entri korup', () => {
    expect(isActiveStaff(null)).toBe(false);
    expect(isActiveStaff(undefined)).toBe(false);
  });
});

describe('filterActiveStaff', () => {
  it('membuang akun nonaktif dari data produksi', () => {
    const aktif = filterActiveStaff(STAFF_PRODUKSI);
    expect(aktif.map((s) => s.name)).toEqual([
      'Staff Bidan',
      'Bidan Yusi F',
      'Bidan Hanifah',
      'Bidan Thabita',
      'Admin',
    ]);
    expect(aktif.some((s) => s.name === 'Bidan Testing Yusi')).toBe(false);
  });

  it('mempertahankan urutan asli (indeks warna tidak berubah)', () => {
    const aktif = filterActiveStaff(STAFF_PRODUKSI);
    expect(aktif.map((s) => s.id)).toEqual([
      '303695b1',
      'f88cedf5',
      '38319d02',
      '2eef2d61',
      '8c04602f',
    ]);
  });

  it('tidak crash untuk daftar kosong / null', () => {
    expect(filterActiveStaff(null)).toEqual([]);
    expect(filterActiveStaff(undefined)).toEqual([]);
    expect(filterActiveStaff([])).toEqual([]);
  });

  it('tidak memutasi daftar asli', () => {
    const salinan = [...STAFF_PRODUKSI];
    filterActiveStaff(salinan);
    expect(salinan).toEqual(STAFF_PRODUKSI);
  });
});

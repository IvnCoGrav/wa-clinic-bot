import { describe, expect, it } from 'vitest';
import {
  staffDisplayName,
  staffShortName,
  resolveStaffName,
} from '../../packages/admin-dashboard/src/utils/resolveStaffName';
import { shortStaffLabel } from '../../packages/admin-dashboard/src/utils/staffColors';

/**
 * F-31: nama bidan dipotong jadi kata pertama mentah (`split(' ')[0]`).
 *
 * Semua nama staff di produksi diawali gelar/jabatan ("Bidan", "Staff"),
 * sehingga yang tampil di legenda & kartu kalender hanya kata "Bidan".
 * Nama di bawah ini diambil apa adanya dari tabel `staff` produksi.
 */
const NAMA_PRODUKSI = [
  'Bidan Testing Yusi',
  'Staff Bidan',
  'Bidan Yusi F',
  'Bidan Hanifah',
  'Bidan Thabita',
  'Admin',
];

describe('staffDisplayName — buang gelar/jabatan di depan nama', () => {
  it('membuang gelar Bidan pada seluruh nama produksi', () => {
    expect(staffDisplayName('Bidan Hanifah')).toBe('Hanifah');
    expect(staffDisplayName('Bidan Thabita')).toBe('Thabita');
    expect(staffDisplayName('Bidan Testing Yusi')).toBe('Testing Yusi');
    expect(staffDisplayName('Bidan Yusi F')).toBe('Yusi F');
  });

  it('mempertahankan nama yang memang bernama satu kata (Admin)', () => {
    // "Admin" adalah nama staff sungguhan (SUPER_ADMIN) — jangan dikosongkan.
    expect(staffDisplayName('Admin')).toBe('Admin');
  });

  it('tidak mengarang nama bila isinya hanya gelar', () => {
    // "Staff Bidan" tidak punya nama diri — kembalikan apa adanya, jangan jadi "".
    expect(staffDisplayName('Staff Bidan')).toBe('Staff Bidan');
    expect(staffDisplayName('Bidan')).toBe('Bidan');
  });

  it('menangani gelar lain dan huruf kecil', () => {
    expect(staffDisplayName('Ibu Siti Aminah')).toBe('Siti Aminah');
    expect(staffDisplayName('Ny. Rina')).toBe('Rina');
    expect(staffDisplayName('Sdri. Dewi')).toBe('Dewi');
    expect(staffDisplayName('bidan hanifah')).toBe('hanifah');
    expect(staffDisplayName('Suster Melati')).toBe('Melati');
  });

  it('tidak memotong nama yang kebetulan mengandung kata gelar di tengah', () => {
    expect(staffDisplayName('Ani Bidan Sari')).toBe('Ani Bidan Sari');
    expect(staffDisplayName('Retno Bidani')).toBe('Retno Bidani');
  });

  it('rapi terhadap spasi berlebih dan input kosong', () => {
    expect(staffDisplayName('   Bidan   Hanifah   ')).toBe('Hanifah');
    expect(staffDisplayName('')).toBe('');
    expect(staffDisplayName('   ')).toBe('');
    expect(staffDisplayName(null)).toBe('');
    expect(staffDisplayName(undefined)).toBe('');
  });

  it('tidak crash untuk tipe data salah', () => {
    expect(staffDisplayName(123 as unknown as string)).toBe('');
    expect(staffDisplayName({} as unknown as string)).toBe('');
  });
});

describe('staffShortName — nama pendek untuk ruang sempit', () => {
  it('mengambil kata pertama dari nama yang SUDAH bersih', () => {
    expect(staffShortName('Bidan Hanifah')).toBe('Hanifah');
    expect(staffShortName('Bidan Testing Yusi')).toBe('Testing');
    expect(staffShortName('Bidan Yusi F')).toBe('Yusi');
    expect(staffShortName('Admin')).toBe('Admin');
  });

  it('setiap bidan produksi menghasilkan label yang berbeda', () => {
    const labels = NAMA_PRODUKSI.map((n) => staffShortName(n));
    // "Staff Bidan" satu-satunya yang tidak punya nama diri; sisanya wajib unik.
    const withRealName = labels.filter((l) => l !== 'Staff Bidan');
    expect(new Set(withRealName).size).toBe(withRealName.length);
  });

  it('mengembalikan string kosong (bukan "undefined") untuk input kosong', () => {
    expect(staffShortName(null)).toBe('');
    expect(staffShortName('')).toBe('');
  });
});

describe('shortStaffLabel — delegasi ke seam kanonis (tidak ada logika ganda)', () => {
  it('tidak lagi mengembalikan kata "Bidan"', () => {
    expect(shortStaffLabel('Bidan Ani Suryani')).toBe('Ani');
    expect(shortStaffLabel('Bidan Hanifah')).toBe('Hanifah');
  });

  it('tetap memberi label cadangan untuk nama kosong', () => {
    expect(shortStaffLabel(null)).toBe('Tanpa nama');
    expect(shortStaffLabel('   ')).toBe('Tanpa nama');
  });
});

describe('integrasi: resolveStaffName → staffShortName', () => {
  const staffList = [
    { id: 'st-1', name: 'Bidan Hanifah' },
    { id: 'st-2', name: 'Bidan Thabita' },
  ];

  it('kartu kalender menampilkan nama diri, bukan "Bidan"', () => {
    const res = { assigned_staff_id: 'st-1' };
    expect(staffShortName(resolveStaffName(res, staffList))).toBe('Hanifah');
  });

  it('reservasi tanpa bidan tidak menampilkan teks palsu', () => {
    expect(staffShortName(resolveStaffName({}, staffList))).toBe('');
  });
});

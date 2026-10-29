import { describe, expect, it } from 'vitest';
import { stripHonorific } from '../../packages/admin-dashboard/src/utils/patientName';

/**
 * F-24 lanjutan: view Bulanan masih memakai `customer.name` MENTAH, sehingga pill
 * 390px menampilkan "Bunda Annisa…" yang terpotong jadi "Bu…".
 *
 * Data produksi: 276/1001 customer memakai gelar di depan nama.
 * Seam ini menggantikan regex inline yang sebelumnya diduplikasi di
 * DayScheduleGrid & WeekScheduleGrid.
 */
describe('stripHonorific', () => {
  it('membuang gelar sapaan di depan nama asli produksi', () => {
    expect(stripHonorific('Bunda Annisa Radearilla')).toBe('Annisa Radearilla');
    expect(stripHonorific('Bunda Shendi Kharisma')).toBe('Shendi Kharisma');
    expect(stripHonorific('Bunda Retno')).toBe('Retno');
    expect(stripHonorific('Bunda Tri Yuli Astutik')).toBe('Tri Yuli Astutik');
  });

  it('membuang variasi gelar lain', () => {
    expect(stripHonorific('Ibu Siti Aminah')).toBe('Siti Aminah');
    expect(stripHonorific('Ny. Ayu')).toBe('Ayu');
    expect(stripHonorific('Nn. Dewi')).toBe('Dewi');
    expect(stripHonorific('Sdri. Rina')).toBe('Rina');
    expect(stripHonorific('Mama Lisa')).toBe('Lisa');
    expect(stripHonorific('Moms Wulan')).toBe('Wulan');
    expect(stripHonorific('Mom Okta')).toBe('Okta');
    expect(stripHonorific('Kak Dina')).toBe('Dina');
    expect(stripHonorific('Kakak Sherly')).toBe('Sherly');
  });

  it('tidak peka huruf besar/kecil', () => {
    expect(stripHonorific('bunda ayu')).toBe('ayu');
    expect(stripHonorific('BUNDA AYU')).toBe('AYU');
    expect(stripHonorific('BuNdA Ayu')).toBe('Ayu');
  });

  it('mengosongkan nama yang SELURUHNYA gelar (pemanggil memakai fallback "Pasien")', () => {
    expect(stripHonorific('Bunda')).toBe('');
    expect(stripHonorific('Ibu')).toBe('');
    expect(stripHonorific('Ny.')).toBe('');
  });

  it('TIDAK memotong nama yang kebetulan mengandung kata gelar', () => {
    expect(stripHonorific('Ani Bunda')).toBe('Ani Bunda');
    expect(stripHonorific('Retno Ibu Sari')).toBe('Retno Ibu Sari');
    expect(stripHonorific('Bundaku')).toBe('Bundaku');
    expect(stripHonorific('Bunda2')).toBe('Bunda2');
    expect(stripHonorific('Ibunda Rina')).toBe('Ibunda Rina');
  });

  it('mempertahankan nama tanpa gelar apa adanya', () => {
    expect(stripHonorific('Retno')).toBe('Retno');
    expect(stripHonorific('Admin Klinik')).toBe('Admin Klinik');
  });

  it('merapikan spasi berlebih', () => {
    expect(stripHonorific('   Bunda    Ayu   Lestari  ')).toBe('Ayu Lestari');
    expect(stripHonorific('Bunda\tAyu')).toBe('Ayu');
  });

  it('aman untuk input kosong dan tipe salah', () => {
    expect(stripHonorific('')).toBe('');
    expect(stripHonorific('   ')).toBe('');
    expect(stripHonorific(null)).toBe('');
    expect(stripHonorific(undefined)).toBe('');
    expect(stripHonorific(42 as unknown as string)).toBe('');
    expect(stripHonorific({} as unknown as string)).toBe('');
  });

  it('tidak memutilasi nama berkarakter khusus', () => {
    expect(stripHonorific("Bunda Nur'aini")).toBe("Nur'aini");
    expect(stripHonorific('Bunda Siti-Nurhaliza')).toBe('Siti-Nurhaliza');
    expect(stripHonorific('Bunda Ayu (Kakak)')).toBe('Ayu (Kakak)');
  });
});

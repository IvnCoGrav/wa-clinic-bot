import { describe, expect, it } from 'vitest';
import { cleanBundaName } from '../../packages/admin-dashboard/src/utils/paymentInvoiceFormatter';

/**
 * F-29: `cleanBundaName()` di `paymentInvoiceFormatter` menyisipkan nama
 * kecamatan/kota langsung ke `new RegExp(...)`. Nama wilayah yang mengandung
 * karakter regex bisa melempar `SyntaxError` dan menggagalkan invoice.
 *
 * Test ini adversarial: memakai nama wilayah yang benar-benar merusak regex
 * (`(`, `)`, `+`, `*`, `[`, `?`, `\`), bukan hanya huruf biasa.
 */
describe('cleanBundaName — wilayah dengan karakter regex (F-29)', () => {
  it('tidak melempar error untuk wilayah bertanda kurung', () => {
    expect(() => cleanBundaName('Bunda Sari Wonokromo (Baru)', 'Wonokromo (Baru)', 'Surabaya')).not.toThrow();
    expect(cleanBundaName('Bunda Sari Wonokromo (Baru)', 'Wonokromo (Baru)', 'Surabaya')).toBe('Sari');
  });

  it('tidak melempar error untuk wilayah bertanda plus/asterisk/titik', () => {
    expect(cleanBundaName('Bunda Ayu Surabaya+Barat', null, 'Surabaya+Barat')).toBe('Ayu');
    expect(cleanBundaName('Bunda Ayu Sidoarjo*Utara', null, 'Sidoarjo*Utara')).toBe('Ayu');
    expect(cleanBundaName('Bunda Ayu Waru.Barat', 'Waru.Barat', null)).toBe('Ayu');
  });

  it('tidak melempar error untuk wilayah dengan kurung siku & backslash', () => {
    expect(cleanBundaName('Bunda Rina Kec [X]', 'Kec [X]', null)).toBe('Rina');
    expect(cleanBundaName('Bunda Rina Kota A\\B', null, 'A\\B')).toBe('Rina');
  });

  it('tidak melempar error untuk wilayah bertanda tanya', () => {
    expect(cleanBundaName('Bunda Nia Daerah?', 'Daerah?', null)).toBe('Nia');
  });

  it('tetap memotong wilayah biasa (perilaku lama tidak berubah)', () => {
    expect(cleanBundaName('Bunda Vita Sidoarjo', 'Waru', 'Sidoarjo')).toBe('Vita');
    expect(cleanBundaName('Bunda Sari Wonokromo', 'Wonokromo', 'Surabaya')).toBe('Sari');
  });

  it('prefix gelar/kecamatan/kota dinormalisasi sebelum dicocokkan', () => {
    expect(cleanBundaName('Ibu Sari Kec. Wonokromo', 'Kec. Wonokromo', null)).toBe('Sari');
    expect(cleanBundaName('Mama Sari Kota Surabaya', null, 'Kota Surabaya')).toBe('Sari');
  });

  it('tidak memotong di tengah kata', () => {
    // "Surabaya" bukan akhiran berbatas kata dari "SurabayaBarat".
    expect(cleanBundaName('Bunda Ayu SurabayaBarat', null, 'Surabaya')).toBe('Ayu SurabayaBarat');
  });

  it('tidak memotong bila wilayah bukan di ekor nama', () => {
    expect(cleanBundaName('Bunda Sari Wonokromo Putri', 'Wonokromo', null)).toBe('Sari Wonokromo Putri');
  });

  it('nama yang seluruhnya wilayah tidak dihabiskan', () => {
    expect(cleanBundaName('Wonokromo', 'Wonokromo', null)).toBe('Wonokromo');
    expect(cleanBundaName('Bunda Wonokromo', 'Wonokromo', null)).toBe('Wonokromo');
  });

  it('case-insensitive seperti perilaku lama', () => {
    expect(cleanBundaName('Bunda Sari wonokromo', 'WONOKROMO', null)).toBe('Sari');
  });

  it('input kosong/null tidak melempar error', () => {
    expect(cleanBundaName('')).toBe('');
    expect(cleanBundaName(null)).toBe('');
    expect(cleanBundaName(undefined, 'Wonokromo', 'Surabaya')).toBe('');
    expect(cleanBundaName('   ')).toBe('');
  });

  it('wilayah kosong/spasi diabaikan', () => {
    expect(cleanBundaName('Bunda Sari', '   ', '')).toBe('Sari');
  });

  it('label wilayah yang tertinggal ikut dibersihkan (Kec./Kel./Kab.)', () => {
    expect(cleanBundaName('Bunda Sari Kel. Wonokromo', 'Wonokromo', null)).toBe('Sari');
    expect(cleanBundaName('Bunda Sari kabupaten Sidoarjo', null, 'Sidoarjo')).toBe('Sari');
    expect(cleanBundaName('Bunda Sari Kecamatan Waru', 'Waru', null)).toBe('Sari');
  });

  it('nama yang hanya berisi label wilayah tidak diosongkan', () => {
    expect(cleanBundaName('Bunda Kota', 'Kota', null)).toBe('Kota');
    expect(cleanBundaName('Bunda Kec', 'Kec', null)).toBe('Kec');
  });
});

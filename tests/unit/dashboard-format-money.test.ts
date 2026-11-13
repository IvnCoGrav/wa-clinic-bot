import { describe, expect, it } from 'vitest';
import {
  formatGratis,
  formatRupiah,
  formatRupiahPresisi,
  formatRupiahRingkas,
} from '../../packages/admin-dashboard/src/utils/money';

describe('formatRupiah', () => {
  it('memformat nominal bulat dengan pemisah ribuan Indonesia', () => {
    expect(formatRupiah(0)).toBe('Rp 0');
    expect(formatRupiah(1500)).toBe('Rp 1.500');
    expect(formatRupiah(1500000)).toBe('Rp 1.500.000');
  });

  it('mengembalikan tanda hubung untuk nilai yang tidak bisa dihitung', () => {
    expect(formatRupiah(null)).toBe('-');
    expect(formatRupiah(undefined)).toBe('-');
    expect(formatRupiah('')).toBe('-');
    expect(formatRupiah('bukan angka')).toBe('-');
    expect(formatRupiah(Number.NaN)).toBe('-');
    expect(formatRupiah(Number.POSITIVE_INFINITY)).toBe('-');
  });

  it('menerima nominal dalam bentuk string dari API', () => {
    expect(formatRupiah('250000')).toBe('Rp 250.000');
  });

  it('mempertahankan tanda negatif (refund/koreksi)', () => {
    expect(formatRupiah(-125000)).toBe('Rp -125.000');
  });

  it('tidak menampilkan desimal untuk rupiah', () => {
    expect(formatRupiah(1500.6)).toBe('Rp 1.501');
  });
});

describe('formatRupiahPresisi', () => {
  it('menampilkan biaya token di bawah satu rupiah', () => {
    expect(formatRupiahPresisi(0.42)).toBe('Rp 0,42');
    expect(formatRupiahPresisi(12.5)).toBe('Rp 12,5');
  });

  it('tetap memakai tanda hubung untuk nilai tidak valid', () => {
    expect(formatRupiahPresisi(null)).toBe('-');
    expect(formatRupiahPresisi('x')).toBe('-');
  });
});

describe('formatRupiahRingkas', () => {
  it('meringkas ribuan, jutaan, dan miliaran', () => {
    expect(formatRupiahRingkas(250000)).toBe('Rp 250 rb');
    expect(formatRupiahRingkas(1500000)).toBe('Rp 1,5 jt');
    expect(formatRupiahRingkas(2000000)).toBe('Rp 2 jt');
    expect(formatRupiahRingkas(2500000000)).toBe('Rp 2,5 M');
  });

  it('tidak meringkas nominal kecil', () => {
    expect(formatRupiahRingkas(750)).toBe('Rp 750');
    expect(formatRupiahRingkas(0)).toBe('Rp 0');
  });

  it('mempertahankan tanda negatif', () => {
    expect(formatRupiahRingkas(-1500000)).toBe('-Rp 1,5 jt');
  });
});

describe('formatGratis', () => {
  it('nol menjadi label gratis', () => {
    expect(formatGratis(0)).toBe('Gratis');
    expect(formatGratis(0, 'Bebas biaya')).toBe('Bebas biaya');
  });

  it('nominal bukan nol memakai format rupiah', () => {
    expect(formatGratis(35000)).toBe('Rp 35.000');
  });

  it('nilai tidak valid tidak dianggap gratis', () => {
    expect(formatGratis(null)).toBe('-');
    expect(formatGratis('x')).toBe('-');
  });
});

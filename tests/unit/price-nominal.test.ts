/**
 * price-nominal.test.ts — Unit test parser nominal rupiah scorer D1.
 *
 * Prinsip Adversarial (MANDATORY): tidak hanya happy path.
 * Wajib tahan terhadap tanggal, jam, durasi, usia, suhu, tahun, nomor HP,
 * alamat (RT/RW/blok), dan format desimal — semua BUKAN harga.
 *
 * Komentar Bahasa Indonesia (konsisten repo).
 */
import { describe, it, expect } from 'vitest';
import { parseNominalRibu } from '../../scripts/lib/price-nominal';

describe('parseNominalRibu — kontrol negatif (angka non-harga)', () => {
  it('tanggal/bulan/tahun bukan nominal', () => {
    expect(parseNominalRibu('Sabtu, 26 September 2026')).toEqual([]);
    expect(parseNominalRibu('jadwal 28 juli, hari jumat')).toEqual([]);
    expect(parseNominalRibu('tgl 8 kak')).toEqual([]);
  });

  it('jam/durasi/menit bukan nominal', () => {
    expect(parseNominalRibu('jam 10 pagi, durasi 40 menit')).toEqual([]);
    expect(parseNominalRibu('jam 9 pagi, 1 jam, 1/2 jam')).toEqual([]);
    expect(parseNominalRibu('pukul 08.00-17.00 WIB')).toEqual([]);
  });

  it('usia/suhu/berat bukan nominal', () => {
    expect(parseNominalRibu('anak 14 bulan, bayi 10 hari')).toEqual([]);
    expect(parseNominalRibu('suhu 38.2, demam 39')).toEqual([]);
    expect(parseNominalRibu('Baby gemoy 3,9kg')).toEqual([]);
  });

  it('campuran tanggal+jam+durasi+usia+suhu bersih total', () => {
    expect(
      parseNominalRibu('Sabtu, 26 September 2026 jam 10 pagi, durasi 40 menit, suhu 38.2, anak 14 bulan')
    ).toEqual([]);
  });

  it('nomor HP dan alamat bukan nominal', () => {
    expect(parseNominalRibu('HP 6281234567890')).toEqual([]);
    // "RT3/RW5", "Blok F16", "No 1A" — awalan huruf = bukan nominal
    expect(parseNominalRibu('RT3 RW5 blok F16 no 1A')).toEqual([]);
  });
});

describe('parseNominalRibu — happy path (harga asli)', () => {
  it('prefix Rp/IDR eksplisit', () => {
    expect(parseNominalRibu('ongkir Rp 15.000')).toEqual([15000]);
    expect(parseNominalRibu('Biaya Rp 60.000')).toEqual([60000]);
    expect(parseNominalRibu('total Rp.15000')).toEqual([15000]);
    expect(parseNominalRibu('IDR 100rb')).toEqual([100000]);
  });

  it('suffix satuan tanpa Rp', () => {
    expect(parseNominalRibu('ongkir 5rb')).toEqual([5000]);
    expect(parseNominalRibu('total 65k')).toEqual([65000]);
    expect(parseNominalRibu('paket 100ribu')).toEqual([100000]);
    expect(parseNominalRibu('borongan 2juta')).toEqual([2000000]);
  });

  it('format ribuan bertitik', () => {
    expect(parseNominalRibu('totalnya 165.000 ya')).toEqual([165000]);
  });

  it('desimal dengan satuan', () => {
    expect(parseNominalRibu('borongan 1.5 juta')).toEqual([1500000]);
    expect(parseNominalRibu('paket 2.5jt')).toEqual([2500000]);
  });

  it('kombinasi multi-nominal (promo + ongkir + total)', () => {
    expect(parseNominalRibu('Biaya promo Rp 60.000 dan ongkir 5rb, total 65k')).toEqual([60000, 5000, 65000]);
  });

  it('nominal kecil < 1000 diabaikan', () => {
    expect(parseNominalRibu('Rp 500 perak')).toEqual([]);
  });
});

describe('parseNominalRibu — adversarial (parafrase & typo nyata)', () => {
  it('varian tulis Rp (spasi/titik/kapital)', () => {
    expect(parseNominalRibu('RP 25.000')).toEqual([25000]);
    expect(parseNominalRibu('rp25000')).toEqual([25000]);
    expect(parseNominalRibu('Rp. 35.000')).toEqual([35000]);
  });

  it('varian satuan (ribu/RB/K/jt/JUTA)', () => {
    expect(parseNominalRibu('50 RIBU')).toEqual([50000]);
    expect(parseNominalRibu('75K')).toEqual([75000]);
    expect(parseNominalRibu('1 JUTA')).toEqual([1000000]);
  });

  it('harga dalam kalimat negosiasi paket (konteks CASE-001)', () => {
    const nominals = parseNominalRibu('Kalau 900k apakah boleh kak? Klo 975k bisa 90 menit kak persesi? 850k ya');
    expect(nominals).toContain(900000);
    expect(nominals).toContain(975000);
    expect(nominals).toContain(850000);
    // "90 menit" BUKAN nominal — tidak boleh ikut
    expect(nominals).not.toContain(90);
  });

  it('tidak false-positive pada kode promo iklan', () => {
    // "Promo [1X2]" = header atribusi iklan, bukan harga
    expect(parseNominalRibu('PROMO [ 1X2 ] Halo Bu Bidan')).toEqual([]);
  });

  it('input kosong / non-string aman', () => {
    expect(parseNominalRibu('')).toEqual([]);
    expect(parseNominalRibu('halo bunda apa kabar')).toEqual([]);
  });
});

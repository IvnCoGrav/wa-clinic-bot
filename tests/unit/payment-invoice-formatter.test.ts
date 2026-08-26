import { describe, it, expect } from 'vitest';
import { generateReservationInvoiceText } from '../../packages/admin-dashboard/src/utils/paymentInvoiceFormatter';

describe('Payment Invoice Formatter Unit Tests', () => {
  it('should generate invoice text matching exact user specifications for baby treatment with free ongkir', () => {
    const text = generateReservationInvoiceText({
      reservation: {
        booking_date: '2026-08-27T05:00:00.000Z', // 12:00 WIB
        treatment_detail: 'pijat ceria',
        treatment_category: 'BABY',
        purchase_value: 60000,
        raw_text: 'Jadwal jam 12.00-12.30',
      },
      customer: {
        name: 'Karmila',
        phone: '081280482533',
        address: 'infesta residense/homestay alas tipis pabean lantai 3 no 301',
        kecamatan: 'Sedati',
        kota: 'Sidoarjo',
        distance_km: 3.0,
        ongkir: 0,
        children: [
          {
            name: 'leo',
            current_age: '3tahun 7 bulan',
          },
        ],
      },
    });

    expect(text).toContain('Berikut reservasi 🐣');
    expect(text).toContain('Hari dan tanggal : Kamis 27 Agustus 2026 jam 12.00-12.30');
    expect(text).toContain('Nama Bunda: Karmila');
    expect(text).toContain('Alamat & Shareloc : infesta residense/homestay alas tipis pabean lantai 3 no 301');
    expect(text).toContain('Kec : Sedati');
    expect(text).toContain('Kota : Sidoarjo');
    expect(text).toContain('No. Hp : 081280482533');
    expect(text).toContain('Pilihan treatment (Baby & Kids)');
    expect(text).toContain('Nama Bayi : leo');
    expect(text).toContain('Usia Bayi/Anak : 3tahun 7 bulan');
    expect(text).toContain('Treatment : pijat ceria');
    expect(text).toContain('Payment : ');
    expect(text).toContain('Treatment = 60.000');
    expect(text).toContain('Ongkir 3,0 km = free');
    expect(text).toContain('Total = 60.000');
    expect(text).toContain('H-1 sebelum treatment akan kami reminder kembali bunda 🥰');
    expect(text).toContain('Terimakasih.  ☺️');
  });

  it('should correctly format charged ongkir when distance > 3km', () => {
    const text = generateReservationInvoiceText({
      reservation: {
        booking_date: '2026-08-28T02:00:00.000Z', // 09:00 WIB
        treatment_detail: 'Baby Hydrotherapy & Spa',
        treatment_category: 'BABY',
        purchase_value: 120000,
      },
      customer: {
        name: 'Bunda Maya',
        phone: '081234567890',
        address: 'Jl. Rungkut Asri Timur No. 10',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
        distance_km: 7.5,
        ongkir: 15000,
        children: [
          {
            name: 'Dedek Arka',
            current_age: '6 bulan',
          },
        ],
      },
    });

    expect(text).toContain('Hari dan tanggal : Jumat 28 Agustus 2026 jam 09.00');
    expect(text).toContain('Nama Bunda: Maya');
    expect(text).toContain('Ongkir 7,5 km = 15.000');
    expect(text).toContain('Treatment = 120.000');
    expect(text).toContain('Total = 135.000');
  });

  it('should format Moms category without baby fields', () => {
    const text = generateReservationInvoiceText({
      reservation: {
        booking_date: '2026-08-29T07:00:00.000Z', // 14:00 WIB
        treatment_detail: 'Pijat Laktasi & Breast Care',
        treatment_category: 'MOMS',
        purchase_value: 135000,
      },
      customer: {
        name: 'Bunda Rani',
        phone: '081987654321',
        address: 'Perumahan Pondok Jati',
        kecamatan: 'Sidoarjo',
        kota: 'Sidoarjo',
        distance_km: 2.5,
        ongkir: 0,
      },
    });

    expect(text).toContain('Pilihan treatment (Moms & Hamil)');
    expect(text).not.toContain('Nama Bayi :');
    expect(text).toContain('Treatment : Pijat Laktasi & Breast Care');
    expect(text).toContain('Total = 135.000');
  });

  it('should extract baby info from raw_text fallback if children array is empty', () => {
    const text = generateReservationInvoiceText({
      reservation: {
        booking_date: '2026-08-30T09:00:00.000Z',
        treatment_detail: 'Pijat Bayi Sehat',
        treatment_category: 'BABY',
        purchase_value: 75000,
        raw_text: `Nama Bunda: Siti
Nama Bayi: Kenzo
Usia Bayi: 8 bulan
Alamat: Jl. Tropodo`,
      },
      customer: {
        phone: '081211112222',
      },
    });

    expect(text).toContain('Nama Bunda: Siti');
    expect(text).toContain('Nama Bayi : Kenzo');
    expect(text).toContain('Usia Bayi/Anak : 8 bulan');
  });
});

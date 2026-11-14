import { describe, it, expect } from 'vitest';
import {
  generateReservationInvoiceText,
  generateSeriesInvoiceText,
  seriesInvoiceParamsFromApi,
} from '../../packages/admin-dashboard/src/utils/paymentInvoiceFormatter';

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

    expect(text).toContain('Berikut reservasi');
    expect(text).toContain('Hari dan tanggal : Kamis 27 Agustus 2026 jam 12.00-12.30');
    expect(text).toContain('Nama Bunda: Karmila');
    expect(text).toContain('Alamat Lengkap & Patokan : infesta residense/homestay alas tipis pabean lantai 3 no 301');
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
    expect(text).toContain('H-1 sebelum treatment akan kami reminder kembali bunda');
    expect(text).toContain('Terimakasih.');
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
        address: 'Jl. Raya Darmo Permai No. 12',
        kecamatan: 'Sukomanunggal',
        kota: 'Surabaya',
        distance_km: 7.5,
        ongkir: 15000,
        children: [
          {
            name: 'Kenzie',
            current_age: '6 bulan',
          },
        ],
      },
    });

    expect(text).toContain('Ongkir 7,5 km = 15.000');
    expect(text).toContain('Treatment = 120.000');
    expect(text).toContain('Total = 135.000');
  });

  it('should correctly format Moms treatment without baby details', () => {
    const text = generateReservationInvoiceText({
      reservation: {
        booking_date: '2026-08-29T07:00:00.000Z',
        treatment_detail: 'Pijat Laktasi & Breast Care',
        treatment_category: 'MOMS',
        purchase_value: 135000,
      },
      customer: {
        name: 'Bunda Sarah',
        phone: '081987654321',
        address: 'Cluster Florencia Blok A',
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

  it('should format single reservation with series badge if series_id is present', () => {
    const text = generateReservationInvoiceText({
      reservation: {
        booking_date: '2026-09-01T02:00:00.000Z',
        treatment_detail: 'Paket Newborn Care',
        treatment_category: 'BABY',
        purchase_value: 100000,
        series_id: 'series-123',
        session_number: 2,
        total_sessions: 7,
      } as any,
      customer: {
        name: 'Bunda Rini',
        phone: '081234567890',
        address: 'Jl. Rungkut Asri No. 5',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
      },
    });

    expect(text).toContain('Treatment : Paket Newborn Care [Paket Berseri Sesi 2/7]');
  });

  it('should generate comprehensive series invoice with per-visit ongkir breakdown', () => {
    const text = generateSeriesInvoiceText({
      series: {
        treatment_name: 'Paket Newborn 7 Hari (2 Hari Sekali)',
        total_sessions: 7,
        purchase_value: 700000,
        delivery_fee: 15000, // ongkir per kunjungan
        reservations: [
          { session_number: 1, booking_date: '2026-09-01T02:00:00.000Z' },
          { session_number: 2, booking_date: '2026-09-03T02:00:00.000Z' },
          { session_number: 3, booking_date: '2026-09-05T02:00:00.000Z' },
          { session_number: 4, booking_date: '2026-09-07T02:00:00.000Z' },
          { session_number: 5, booking_date: '2026-09-09T02:00:00.000Z' },
          { session_number: 6, booking_date: '2026-09-11T02:00:00.000Z' },
          { session_number: 7, booking_date: '2026-09-13T02:00:00.000Z' },
        ],
      },
      customer: {
        name: 'Bunda Sinta',
        phone: '081938252933',
        address: 'Perumahan Delta Sari Blok AB-10',
        kecamatan: 'Waru',
        kota: 'Sidoarjo',
        children: [{ name: 'Baby Rayyan', current_age: '7 hari' }],
      },
      discount: 20000,
    });

    expect(text).toContain('Berikut reservasi Paket Berseri 🐣');
    expect(text).toContain('Paket : Paket Newborn 7 Hari (2 Hari Sekali) (7 Sesi)');
    expect(text).toContain('Nama Bunda : Sinta');
    expect(text).toContain('Alamat & Shareloc : Perumahan Delta Sari Blok AB-10');
    expect(text).toContain('Nama Bayi : Baby Rayyan');
    expect(text).toContain('Usia Bayi/Anak : 7 hari');
    expect(text).toContain('Rincian Jadwal Sesi :');
    expect(text).toContain('• Sesi 1:');
    expect(text).toContain('• Sesi 7:');
    expect(text).toContain('Paket (7 Sesi) = 700.000');
    expect(text).toContain('Ongkir (7 kunjungan @ 15.000) = 105.000');
    expect(text).toContain('Diskon = - 20.000');
    // 700.000 + 105.000 - 20.000 = 785.000
    expect(text).toContain('Total = 785.000');
  });

  it('should support dual-case camelCase payload from Dashboard API in generateSeriesInvoiceText', () => {
    const text = generateSeriesInvoiceText({
      series: {
        treatmentName: 'Paket Terapi Tumbuh Kembang (4 Sesi)',
        totalSessions: 4,
        purchaseValue: 400000,
        deliveryFee: 10000,
        discountAmount: 10000,
        reservations: [
          { sessionNumber: 1, bookingDate: '2026-10-01T02:00:00.000Z' },
          { sessionNumber: 2, bookingDate: '2026-10-08T02:00:00.000Z' },
          { sessionNumber: 3, bookingDate: '2026-10-15T02:00:00.000Z' },
          { sessionNumber: 4, bookingDate: '2026-10-22T02:00:00.000Z' },
        ],
      },
      customer: {
        name: 'Bunda Rina',
        phone: '081234567890',
        address: 'Jl. Melati No. 5',
        kecamatan: 'Taman',
        kota: 'Sidoarjo',
      },
    });

    expect(text).toContain('Berikut reservasi Paket Berseri 🐣');
    expect(text).toContain('Paket : Paket Terapi Tumbuh Kembang (4 Sesi) (4 Sesi)');
    expect(text).toContain('• Sesi 1:');
    expect(text).toContain('• Sesi 4:');
    expect(text).toContain('Paket (4 Sesi) = 400.000');
    expect(text).toContain('Ongkir (4 kunjungan @ 10.000) = 40.000');
    expect(text).toContain('Diskon = - 10.000');
    // 400.000 + 40.000 - 10.000 = 430.000
    expect(text).toContain('Total = 430.000');
  });

  it('should adapt raw API response safely via seriesInvoiceParamsFromApi', () => {
    const rawApiData = {
      id: 'series_abc',
      treatment_name: 'Paket Baby Spa Ceria',
      total_sessions: 3,
      purchase_value: 300000,
      delivery_fee: 15000,
      discount_amount: 0,
      sessions: [
        { sessionNumber: 1, bookingDate: '2026-11-01T03:00:00.000Z' },
        { sessionNumber: 2, bookingDate: '2026-11-08T03:00:00.000Z' },
      ],
    };

    const params = seriesInvoiceParamsFromApi(rawApiData, {
      name: 'Bunda Gita',
      phone: '081122334455',
    });

    expect(params.series.treatment_name).toBe('Paket Baby Spa Ceria');
    expect(params.series.treatmentName).toBe('Paket Baby Spa Ceria');
    expect(params.series.totalSessions).toBe(3);
    expect(params.series.purchaseValue).toBe(300000);
    expect(params.series.reservations?.length).toBe(2);
    expect(params.series.reservations?.[0].sessionNumber).toBe(1);

    // Edge case: null apiSeries
    const emptyParams = seriesInvoiceParamsFromApi(null);
    expect(emptyParams.series.treatmentName).toBe('');
    expect(emptyParams.series.totalSessions).toBe(1);
  });
});

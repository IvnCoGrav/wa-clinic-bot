import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages, formatIndonesianDate, parsePriceText } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

describe('Chat Schedule & Context Extractor Unit Tests', () => {
  it('should extract relative date "besok", time range "12.00-12.30", and treatment from conversation', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Halo kak mau tanya pricelist baby massage' },
      { direction: 'OUTBOUND', content: 'Halo Bunda! Untuk baby ada pijat ceria 60rb ya bun' },
      { direction: 'INBOUND', content: 'Bisa besok kamis jam 12.00-12.30 ya kak?' },
      { direction: 'OUTBOUND', content: 'Bisa Bunda, untuk adik Leo ya?' },
      { direction: 'INBOUND', content: 'Iya betul dedek leo usia 3tahun 7 bulan' },
    ];

    const customer = {
      name: 'Bunda Karmila',
      phone: '081280482533',
      address: 'infesta residense/homestay alas tipis pabean lantai 3 no 301',
      kecamatan: 'Sedati',
      kota: 'Sidoarjo',
      distance_km: 3.0,
      ongkir: 0,
    };

    const extracted = extractScheduleFromMessages(messages, customer);

    expect(extracted.isExtractedFromChat).toBe(true);
    expect(extracted.timeDisplay).toBe('12.00-12.30');
    expect(extracted.treatmentName.toLowerCase()).toContain('pijat ceria');
    expect(extracted.treatmentPrice).toBe(60000);
    expect(extracted.bundaName).toBe('Karmila');
    expect(extracted.childName.toLowerCase()).toContain('leo');
    expect(extracted.childAge).toContain('3tahun 7 bulan');
    expect(extracted.ongkir).toBe(0);
    expect(extracted.distanceKm).toBe(3.0);
  });

  it('should extract specific date "28 agustus", time "jam 10 pagi", and custom ongkir', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Mbak mau booking tgl 28 agustus jam 10 pagi untuk Baby Massage & Gym' },
      { direction: 'OUTBOUND', content: 'Baik bunda, ongkir ke lokasi bunda 15rb ya bun' },
      { direction: 'INBOUND', content: 'Oke deal mbak' },
    ];

    const customer = {
      name: 'Maya',
      phone: '08123456789',
      address: 'Jl. Rungkut Asri Timur No. 10',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      distance_km: 6.5,
    };

    const clinicServices = [
      { name: 'Baby Massage & Gym', price: 75000, category: 'BABY' },
      { name: 'pijat ceria', price: 60000, category: 'BABY' },
    ];

    const extracted = extractScheduleFromMessages(messages, customer, clinicServices);

    expect(extracted.timeDisplay).toBe('10.00');
    expect(extracted.treatmentName).toBe('Baby Massage & Gym');
    expect(extracted.treatmentPrice).toBe(75000);
    expect(extracted.ongkir).toBe(15000);
    expect(extracted.bundaName).toBe('Maya');
  });

  it('should accurately parse confirmed reservation block from Vita Sidoarjo without any hardcoded leaks', () => {
    const confirmationText = `Berikut reservasi 🐣

Hari dan tanggal :  Kamis, 27 Agustus 2026 jam 16.30-17.00
Nama Bunda: Vita
Alamat & Shareloc :Jln gang sempati 158c, kec. Gedangan, kec. Gedangan, kab. Sidoarjo
Kec & Kota : Sidoarjo
No. Hp : 082140771756

Pilihan treatment (Baby & Kids)

Nama Bayi : Arviano Rizqi Al-Fatih
Usia Bayi/Anak : 1 bulan
Treatment : pijat bayi pulih ceria & sinar moksa

Payment : 
Treatment = 80.000
Ongkir 6,8km = 15.000
Promo ongkir = - 5.000
*Total = 90.000*

Terimakasih.  ☺️`;

    const messages = [
      { direction: 'INBOUND', content: 'Halo kak mau reservasi' },
      { direction: 'OUTBOUND', content: confirmationText },
    ];

    const customer = {
      id: 'c659eba2-14bd-4f8f-9b6f-5ae7a4eceb32',
      name: 'Bunda Vita Sidoarjo',
      phone: '6282140771756',
      kelurahan: 'Jln gang sempati 158c, kec. Gedangan, kec. Gedangan, kab. Sidoarjo',
      kecamatan: 'Sidoarjo',
      children: [
        { name: 'Arviano Rizqi Al-Fatih', raw_age_text: '1 bulan' },
      ],
    };

    const extracted = extractScheduleFromMessages(messages, customer);

    expect(extracted.bundaName).toBe('Vita');
    expect(extracted.phone).toBe('082140771756');
    expect(extracted.address).toBe('Jln gang sempati 158c, kec. Gedangan, kec. Gedangan, kab. Sidoarjo');
    expect(extracted.childName).toBe('Arviano Rizqi Al-Fatih');
    expect(extracted.childAge).toBe('1 bulan');
    expect(extracted.treatmentName).toBe('pijat bayi pulih ceria & sinar moksa');
    expect(extracted.treatmentPrice).toBe(80000);
    expect(extracted.distanceKm).toBe(6.8);
    expect(extracted.ongkir).toBe(15000);
    expect(extracted.timeDisplay).toBe('16.30-17.00');
    expect(extracted.dateDisplay).toContain('27 Agustus 2026');
  });

  it('should ignore empty form labels and not capture "Usia Bayi" as child name', () => {
    const emptyFormText = `Berikut list untuk reservasi :

Hari dan tanggal :
Nama Bunda:
Alamat & Shareloc :
Kec & Kota :
No. Hp :

Pilihan treatment (Baby & Kids)

Nama Bayi :
Usia Bayi/Anak :
Treatment :`;

    const messages = [
      { direction: 'OUTBOUND', content: emptyFormText },
    ];

    const customer = {
      name: 'Fitri',
      phone: '081999888777',
      address: 'Jl Mawar 123',
      children: [
        { name: 'Kenzo', raw_age_text: '6 bulan' },
      ],
    };

    const extracted = extractScheduleFromMessages(messages, customer);

    expect(extracted.childName).toBe('Kenzo'); // Should fallback to DB child name, NOT "Usia Bayi"
    expect(extracted.childAge).toBe('6 bulan');
    expect(extracted.bundaName).toBe('Fitri');
    expect(extracted.address).toBe('Jl Mawar 123');
  });

  it('should format Indonesian date string accurately', () => {
    const testDate = new Date(2026, 7, 27); // 27 Agustus 2026
    const str = formatIndonesianDate(testDate);
    expect(str).toContain('27 Agustus 2026');
    expect(str).toContain('Kamis');
  });

  it('should accurately parse customer filled dual-section form (Baby filled, Moms empty)', () => {
    const rawCustomerMessage = `Berikut list untuk reservasi : 

Hari dan tanggal :  Kamis, 27 Agustus 2026
Nama Bunda: Vita
Alamat & Shareloc :Jln gang sempati 158c, kec. Gedangan, kec. Gedangan, kab. Sidoarjo 
Kec & Kota : Sidoarjo 
No. Hp : 082140771756

Pilihan treatment (Baby & Kids)

Nama Bayi : Arviano Rizqi Al-Fatih
Usia Bayi/Anak : 1 bulan
Treatment : pijat bayi pulih ceria & sinar moksa

Pilihan treatment (Moms) : 

Usia Kehamilan (Jika hamil): 
Treatment :


Mohon bisa diisi Bunda 😊
Cancel / Pembatalan Harap minimal H-3 jam

H-1 sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️`;

    const messages = [
      { direction: 'INBOUND', content: rawCustomerMessage },
    ];

    const customer = {
      name: 'Bunda Vita Sidoarjo',
      phone: '6282140771756',
      kecamatan: 'Gedangan',
      kota: 'Sidoarjo',
    };

    const extracted = extractScheduleFromMessages(messages, customer);

    expect(extracted.bundaName).toBe('Vita'); // Cleaned, NOT "Vita Sidoarjo"
    expect(extracted.treatmentCategory).toBe('BABY'); // NOT MOMS!
    expect(extracted.treatmentName).toBe('pijat bayi pulih ceria & sinar moksa');
    expect(extracted.childName).toBe('Arviano Rizqi Al-Fatih');
    expect(extracted.childAge).toBe('1 bulan');
    expect(extracted.address).toContain('Jln gang sempati 158c');
    expect(extracted.phone).toBe('082140771756');
  });

  it('should not extract conversational well-wishes like "sehat selalu yaa" as child name', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Kak mau tanya treatment baby' },
      { direction: 'OUTBOUND', content: 'Halo bunda! Ada promo baby massage ya' },
      { direction: 'INBOUND', content: 'Oke kak besok kamis jam 15.00 ya' },
      { direction: 'OUTBOUND', content: 'Baik bunda, semoga si kecil sehat selalu yaa 🥰' },
    ];

    const customer = {
      name: 'Bunda Vita Sidoarjo',
      phone: '6282140771756',
      children: [
        { name: 'Arviano Rizqi Al-Fatih', raw_age_text: '1 bulan' },
      ],
    };

    const extracted = extractScheduleFromMessages(messages, customer);

    expect(extracted.childName).toBe('Arviano Rizqi Al-Fatih'); // MUST be database child name, NOT "sehat selalu yaa"
    expect(extracted.childName).not.toContain('sehat');
  });

  it('should parse various price strings accurately', () => {
    expect(parsePriceText('80.000')).toBe(80000);
    expect(parsePriceText('80rb')).toBe(80000);
    expect(parsePriceText('80k')).toBe(80000);
    expect(parsePriceText('80 ribu')).toBe(80000);
    expect(parsePriceText('free')).toBe(0);
    expect(parsePriceText('gratis')).toBe(0);
    expect(parsePriceText('0')).toBe(0);
    expect(parsePriceText('')).toBeNull();
  });
});

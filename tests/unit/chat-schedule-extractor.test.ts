import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages, formatIndonesianDate } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

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

  it('should format Indonesian date string accurately', () => {
    const testDate = new Date(2026, 7, 27); // 27 Agustus 2026
    const str = formatIndonesianDate(testDate);
    expect(str).toContain('27 Agustus 2026');
    expect(str).toContain('Kamis');
  });
});

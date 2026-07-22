import { describe, it, expect, beforeEach } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

describe('Geocoding Service: 20 Kecamatan & City/Regency Rejection Tests', () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock_google_maps_key';
  });

  const kecamatansToTest = [
    'Waru',
    'Candi',
    'Gedangan',
    'Sedati',
    'Sukodono',
    'Buduran',
    'Wonoayu',
    'Taman',
    'Krian',
    'Balongbendo',
    'Tulangan',
    'Krembung',
    'Porong',
    'Tanggulangin',
    'Tarik',
    'Prambon',
    'Jabon',
    'Rungkut',
    'Wonocolo',
    'Gubeng'
  ];

  const citiesToTest = [
    'Sidoarjo',
    'Surabaya',
    'Kabupaten Sidoarjo',
    'Kota Surabaya',
    'Gresik',
    'Malang'
  ];

  // Test case untuk 20 Kecamatan berbeda
  describe('1. Uji Coba 20 Kecamatan Berbeda (Harus Ditolak / Impresise)', () => {
    kecamatansToTest.forEach((kecamatan) => {
      it(`should reject Kecamatan name "${kecamatan}" without explicit prefix`, async () => {
        const res = await geocodingService.geocodeText(kecamatan);
        expect(res.isPrecise).toBe(false);
      });

      it(`should reject Kecamatan name "${kecamatan}" with conversational suffix/prefix`, async () => {
        const res = await geocodingService.geocodeText(`saya di ${kecamatan} bund`);
        expect(res.isPrecise).toBe(false);
      });
    });
  });

  // Test case untuk Nama Kota/Kabupaten saja
  describe('2. Uji Coba Nama Kota/Kabupaten Saja (Harus Ditolak / Impresise)', () => {
    citiesToTest.forEach((city) => {
      it(`should reject City/Regency name "${city}"`, async () => {
        const res = await geocodingService.geocodeText(city);
        expect(res.isPrecise).toBe(false);
      });

      it(`should reject City/Regency name "${city}" with prefix/suffix`, async () => {
        const res = await geocodingService.geocodeText(`saya tinggal di ${city} ya min`);
        expect(res.isPrecise).toBe(false);
      });
    });
  });
});

import { describe, it, expect } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

describe('Surabaya & Sidoarjo Major Apartments & Landmarks Geocoding', () => {
  const testApartments = [
    {
      query: 'CitraLand Vittorio - Wiyung Surabaya',
      expectedKelurahan: 'Babatan',
      expectedKecamatan: 'Wiyung',
    },
    {
      query: 'Gunawangsa Tidar apartemen',
      expectedKelurahan: 'Tembok Dukuh',
      expectedKecamatan: 'Bubutan',
    },
    {
      query: 'Anderson Tower (Pakuwon Mall)',
      expectedKelurahan: 'Babatan',
      expectedKecamatan: 'Wiyung',
    },
    {
      query: 'Klaska Residence',
      expectedKelurahan: 'Jagir',
      expectedKecamatan: 'Wonokromo',
    },
    {
      query: 'Grand Sungkono Lagoon',
      expectedKelurahan: 'Dukuh Pakis',
      expectedKecamatan: 'Dukuh Pakis',
    },
    {
      query: 'Grand Dharmahusada Lagoon',
      expectedKelurahan: 'Mulyorejo',
      expectedKecamatan: 'Mulyorejo',
    },
    {
      query: 'The Rosebay Apartment',
      expectedKelurahan: 'Pradah Kalikendal',
      expectedKecamatan: 'Dukuh Pakis',
    },
    {
      query: 'Grand Shamaya',
      expectedKelurahan: 'Embong Kaliasin',
      expectedKecamatan: 'Genteng',
    },
    {
      query: 'Apartemen Taman Melati',
      expectedKelurahan: 'Mulyorejo',
      expectedKecamatan: 'Mulyorejo',
    },
    {
      query: 'Kyo Society',
      expectedKelurahan: 'Panjang Jiwo',
      expectedKecamatan: 'Tenggilis Mejoyo',
    },
    {
      query: 'One Icon Residence',
      expectedKelurahan: 'Kedungdoro',
      expectedKecamatan: 'Tegalsari',
    },
    {
      query: 'Apartemen Waterplace Tower C',
      expectedKelurahan: 'Babatan',
      expectedKecamatan: 'Wiyung',
    },
    {
      query: 'Apartment Taman Beverly',
      expectedKelurahan: 'Pradah Kalikendal',
      expectedKecamatan: 'Dukuh Pakis',
    },
    {
      query: 'Ascott Waterplace Surabaya',
      expectedKelurahan: 'Babatan',
      expectedKecamatan: 'Wiyung',
    },
    {
      query: 'The Galaxy Residences',
      expectedKelurahan: 'Mulyorejo',
      expectedKecamatan: 'Mulyorejo',
    },
    {
      query: 'Metropolis Apartemen Surabaya',
      expectedKelurahan: 'Tenggilis Mejoyo',
      expectedKecamatan: 'Tenggilis Mejoyo',
    },
    {
      query: 'Apartemen (Anderson Benson Orchard Tanglin) Pakuwon Mall by Mansionkusby',
      expectedKelurahan: 'Babatan',
      expectedKecamatan: 'Wiyung',
    },
    {
      query: 'Apartment Pavilion Permata',
      expectedKelurahan: 'Dukuh Pakis',
      expectedKecamatan: 'Dukuh Pakis',
    },
    {
      query: 'Waterplace Apartment',
      expectedKelurahan: 'Babatan',
      expectedKecamatan: 'Wiyung',
    },
    {
      query: 'Puri Darmo Service Apartment',
      expectedKelurahan: 'Sonokwijenan',
      expectedKecamatan: 'Sukomanunggal',
    },
  ];

  testApartments.forEach((apt) => {
    it(`resolves "${apt.query}" to ${apt.expectedKelurahan}, ${apt.expectedKecamatan}`, async () => {
      const result = await geocodingService.geocodeText(apt.query);
      expect(result).toBeDefined();
      expect(result.isPrecise).toBe(true);
      expect(result.kelurahan?.toLowerCase()).toBe(apt.expectedKelurahan.toLowerCase());
      expect(result.kecamatan?.toLowerCase()).toBe(apt.expectedKecamatan.toLowerCase());
      expect(result.lat).toBeDefined();
      expect(result.lng).toBeDefined();
    });
  });
});

import { Client, AddressComponent } from '@googlemaps/google-maps-services-js';
import dotenv from 'dotenv';
dotenv.config();

export interface ResolvedLocation {
  isPrecise: boolean;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

const googleMapsClient = new Client({});

/**
 * Service untuk menangani Geocoding (Teks -> Koordinat/Kelurahan)
 * dan Reverse Geocoding (Koordinat Lat/Lng -> Kelurahan/Alamat).
 */
export class GeocodingService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  }

  /**
   * Geocode teks lokasi yang diketik customer (misal: "Gubeng, Surabaya").
   * Memeriksa apakah komponen alamat sudah mencapai tingkat Kelurahan/Desa 
   * (administrative_area_level_4, sublocality_level_1, atau neighborhood).
   */
  public async geocodeText(locationText: string): Promise<ResolvedLocation> {
    if (!this.apiKey || this.apiKey.startsWith('mock')) {
      return this.mockGeocodeText(locationText);
    }

    try {
      const response = await googleMapsClient.geocode({
        params: {
          address: locationText,
          key: this.apiKey,
          components: { country: 'ID' }, // Batasi pencarian ke Indonesia
        },
      });

      if (!response.data.results || response.data.results.length === 0) {
        return { isPrecise: false };
      }

      const topResult = response.data.results[0];
      const components = topResult.address_components;

      const kelurahan = this.extractComponent(components, [
        'administrative_area_level_4', // Tingkat Kelurahan / Desa di Indonesia
        'sublocality_level_1',          // Alternatif sublocality
        'neighborhood',
      ]);

      const kecamatan = this.extractComponent(components, [
        'administrative_area_level_3', // Tingkat Kecamatan
        'sublocality',
      ]);

      const kota = this.extractComponent(components, [
        'administrative_area_level_2', // Tingkat Kota / Kabupaten
        'locality',
      ]);

      const lat = topResult.geometry.location.lat;
      const lng = topResult.geometry.location.lng;

      // Presisi jika kelurahan/desa berhasil terdeteksi
      const isPrecise = Boolean(kelurahan);

      return {
        isPrecise,
        kelurahan,
        kecamatan,
        kota,
        lat,
        lng,
        formattedAddress: topResult.formatted_address,
      };
    } catch (error) {
      console.error('Error in Google Maps geocodeText:', error);
      return { isPrecise: false };
    }
  }

  /**
   * Reverse Geocode koordinat native WhatsApp share location (Latitude & Longitude).
   */
  public async reverseGeocode(lat: number, lng: number): Promise<ResolvedLocation> {
    if (!this.apiKey || this.apiKey.startsWith('mock')) {
      return this.mockReverseGeocode(lat, lng);
    }

    try {
      const response = await googleMapsClient.reverseGeocode({
        params: {
          latlng: { lat, lng },
          key: this.apiKey,
        },
      });

      if (!response.data.results || response.data.results.length === 0) {
        return {
          isPrecise: true, // Native coordinates always have lat/lng
          lat,
          lng,
        };
      }

      const topResult = response.data.results[0];
      const components = topResult.address_components;

      const kelurahan = this.extractComponent(components, [
        'administrative_area_level_4',
        'sublocality_level_1',
        'neighborhood',
      ]);

      const kecamatan = this.extractComponent(components, [
        'administrative_area_level_3',
        'sublocality',
      ]);

      const kota = this.extractComponent(components, [
        'administrative_area_level_2',
        'locality',
      ]);

      return {
        isPrecise: true,
        kelurahan: kelurahan || 'Area Terdaftar',
        kecamatan,
        kota,
        lat,
        lng,
        formattedAddress: topResult.formatted_address,
      };
    } catch (error) {
      console.error('Error in Google Maps reverseGeocode:', error);
      return {
        isPrecise: true,
        lat,
        lng,
      };
    }
  }

  /**
   * Helper untuk mengekstrak komponen alamat spesifik berdasarkan type tags Google Maps
   */
  private extractComponent(components: AddressComponent[], targetTypes: string[]): string | undefined {
    for (const type of targetTypes) {
      const found = components.find((comp) => comp.types.includes(type as any));
      if (found) {
        return found.long_name;
      }
    }
    return undefined;
  }

  /**
   * Mocking fallback saat API Key belum diisi / untuk unit test offline
   */
  private mockGeocodeText(text: string): ResolvedLocation {
    const lower = text.toLowerCase();
    
    // Jika user mengetik hanya nama kota tanpa detail kelurahan
    if (lower === 'surabaya' || lower === 'jakarta' || lower === 'bandung') {
      return {
        isPrecise: false,
        kota: text,
      };
    }

    // Jika user memberikan detail kelurahan (misal "Kelurahan Gubeng", "Gubeng, Surabaya")
    return {
      isPrecise: true,
      kelurahan: 'Gubeng',
      kecamatan: 'Gubeng',
      kota: 'Surabaya',
      lat: -7.2721,
      lng: 112.7578,
      formattedAddress: `${text}, Surabaya, Jawa Timur`,
    };
  }

  private mockReverseGeocode(lat: number, lng: number): ResolvedLocation {
    return {
      isPrecise: true,
      kelurahan: 'Gubeng',
      kecamatan: 'Gubeng',
      kota: 'Surabaya',
      lat,
      lng,
      formattedAddress: `Lat: ${lat}, Lng: ${lng}, Gubeng, Surabaya`,
    };
  }
}

export const geocodingService = new GeocodingService();

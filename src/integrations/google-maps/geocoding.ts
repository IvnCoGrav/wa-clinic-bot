import { Client, AddressComponent } from '@googlemaps/google-maps-services-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getStringSimilarity } from '../../utils/similarity';
import { CircuitBreaker } from '../../utils/circuit-breaker';
dotenv.config();

export interface ResolvedLocation {
  isPrecise: boolean;
  isFuzzyMatch?: boolean;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
  ambiguityResults?: any[];
  zipcode?: string;
}

const googleMapsClient = new Client({});

/**
 * Service untuk memproses input lokasi teks dari customer.
 * Mengintegrasikan Google Maps Geocoding API sebagai default provider,
 * dengan mock local database fallback untuk testing offline.
 */
export class GeocodingService {
  private apiKey: string;
  public geocodeBreaker: CircuitBreaker<[any], any>;
  public reverseGeocodeBreaker: CircuitBreaker<[any], any>;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';

    this.geocodeBreaker = new CircuitBreaker(
      async (params: any) => googleMapsClient.geocode(params),
      // Cast to any: fallback returns ResolvedLocation which callers detect via 'isPrecise' in response.
      // This avoids needing to fake GeocodeResponseData shape while preserving runtime correctness.
      async (params: any): Promise<any> => {
        const locationText = params.params.address.replace(', Surabaya', '');
        return this.mockGeocodeText(locationText);
      }
    );

    this.reverseGeocodeBreaker = new CircuitBreaker(
      async (params: any) => googleMapsClient.reverseGeocode(params),
      async (params: any): Promise<any> => {
        const { lat, lng } = params.params.latlng;
        return this.mockReverseGeocode(lat, lng);
      }
    );

  }

  /**
   * Mengambil koordinat & informasi administratif dari input teks.
   */
  public async geocodeText(locationText: string): Promise<ResolvedLocation> {
    if (!this.apiKey || this.apiKey.startsWith('mock')) {
      return this.mockGeocodeText(locationText);
    }

    try {
      const queryText = locationText.toLowerCase().includes('surabaya') 
        ? locationText 
        : `${locationText}, Surabaya`;

      const response = await this.geocodeBreaker.execute({
        params: {
          address: queryText,
          key: this.apiKey,
          components: { country: 'ID' }, // Batasi pencarian ke Indonesia
        },
      });

      if (response && 'isPrecise' in response) {
        return response;
      }

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
      const zipcode = this.extractComponent(components, ['postal_code']);

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
        zipcode,
      };
    } catch (error) {
      console.error('Error in Google Maps geocodeText, falling back to local database:', error);
      return this.mockGeocodeText(locationText);
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
      const response = await this.reverseGeocodeBreaker.execute({
        params: {
          latlng: { lat, lng },
          key: this.apiKey,
        },
      });

      if (response && 'isPrecise' in response) {
        return response;
      }

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

      const zipcode = this.extractComponent(components, ['postal_code']);

      return {
        isPrecise: true,
        kelurahan: kelurahan || 'Area Terdaftar',
        kecamatan,
        kota,
        lat,
        lng,
        formattedAddress: topResult.formatted_address,
        zipcode,
      };
    } catch (error) {
      console.error('Error in Google Maps reverseGeocode, falling back to mockReverseGeocode:', error);
      return this.mockReverseGeocode(lat, lng);
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
   * Geocode Mock Local Database Fallback untuk testing tanpa API key.
   */
  private async mockGeocodeText(locationText: string): Promise<ResolvedLocation> {
    const lower = locationText.toLowerCase().trim();
    
    // Pembersihan prefix/suffix teks lokasi
    let cleanText = lower
      .replace(/^(saya\s+)?di\s+/, '')
      .replace(/^alamat\s+saya\s+di\s+/, '')
      .replace(/^rumah\s+saya\s+di\s+/, '')
      .replace(/^kelurahan\s+/, '')
      .replace(/^desa\s+/, '')
      .replace(/^kel\s+/, '')
      .replace(/^ds\s+/, '')
      .replace(/\s+(bund|bunda|ya|kak|min|mbak|mas|gan|sis|aja|saja|dong|kok|deh)\b/g, '')
      .trim();

    // Hapus conversational redirect wrappers (seperti "ganti ke", "salah alamat di")
    cleanText = cleanText
      .replace(/.*(ganti|pindah|ubah|salah|yang\s+bener|alamat)\s+(ke|di|hanya|saja)\s+/i, '')
      .trim();

    // 1. Coba cocokkan dengan local subdistricts JSON database
    try {
      const filePath = path.join(process.cwd(), 'src', 'config', 'surabaya_sidoarjo_subdistricts.json');
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // Cek jika input customer sama dengan nama Kecamatan luas
        const kecNames = new Set(data.map((d: any) => d.Kecamatan.toLowerCase()));
        const hasExplicitKelurahan = lower.includes('kelurahan') || lower.includes('desa') || lower.includes('kel') || lower.includes('ds');
        if (kecNames.has(cleanText) && !hasExplicitKelurahan) {
          return {
            isPrecise: false,
            kota: cleanText,
          };
        }

        // --- ATURAN PRESEDEN 1: EXACT MATCH ---
        const exactMatches = data.filter((d: any) => d.Kelurahan_Desa.toLowerCase() === cleanText);
        if (exactMatches.length > 0) {
          if (exactMatches.length === 1) {
            const match = exactMatches[0];
            const coords = match.Koordinat.split(',');
            const lat = parseFloat(coords[0].trim());
            const lng = parseFloat(coords[1].trim());
            return {
              isPrecise: true,
              kelurahan: match.Kelurahan_Desa,
              kecamatan: match.Kecamatan,
              kota: match.Kabupaten_Kota,
              lat,
              lng,
              formattedAddress: `${match.Kelurahan_Desa}, ${match.Kecamatan}, ${match.Kabupaten_Kota}`,
              zipcode: match.Kode_Pos,
            };
          } else {
            return {
              isPrecise: false,
              ambiguityResults: exactMatches,
            };
          }
        }

        // --- ATURAN PRESEDEN 2: FUZZY MATCH (Sorensen-Dice >= 0.80) ---
        const fuzzyCandidates = data.map((d: any) => {
          const kelName = d.Kelurahan_Desa.toLowerCase();
          const similarity = getStringSimilarity(cleanText, kelName);
          return { item: d, similarity };
        }).filter((c: any) => c.similarity >= 0.80);

        if (fuzzyCandidates.length > 0) {
          // Kelompokkan kandidat berdasarkan kombinasi Kelurahan + Kecamatan unik
          const uniqueCombinations = new Map<string, any>();
          for (const cand of fuzzyCandidates) {
            const key = `${cand.item.Kelurahan_Desa.toLowerCase()}_${cand.item.Kecamatan.toLowerCase()}`;
            if (!uniqueCombinations.has(key)) {
              uniqueCombinations.set(key, cand.item);
            }
          }

          if (uniqueCombinations.size === 1) {
            // Tepat 1 kelurahan unik -> single fuzzy match confirmation
            const match = Array.from(uniqueCombinations.values())[0];
            const coords = match.Koordinat.split(',');
            const lat = parseFloat(coords[0].trim());
            const lng = parseFloat(coords[1].trim());
             return {
              isPrecise: false,
              isFuzzyMatch: true,
              kelurahan: match.Kelurahan_Desa,
              kecamatan: match.Kecamatan,
              kota: match.Kabupaten_Kota,
              lat,
              lng,
              formattedAddress: `${match.Kelurahan_Desa}, ${match.Kecamatan}, ${match.Kabupaten_Kota}`,
              zipcode: match.Kode_Pos,
            };
          } else if (uniqueCombinations.size > 1) {
            // Lebih dari 1 kelurahan unik -> alur ambiguitas pilih-kecamatan
            return {
              isPrecise: false,
              ambiguityResults: Array.from(uniqueCombinations.values()),
            };
          }
        }

        // --- ATURAN PRESEDEN 3: SUBSTRING MATCH / SCORING LAMA ---
        const candidates = data.map((d: any) => {
          const kelName = d.Kelurahan_Desa.toLowerCase();
          const kecName = d.Kecamatan.toLowerCase();
          const kotaName = d.Kabupaten_Kota.toLowerCase();
          
          let score = 0;
          if (cleanText.includes(kelName)) {
            score += 10;
            if (cleanText.startsWith(kelName)) {
              score += 5;
            }
          }
          if (score === 0) return { item: d, score: 0 };

          if (cleanText.includes(kecName)) {
            score += 2;
          }
          if (cleanText.includes(kotaName)) {
            score += 1;
          }
          return { item: d, score };
        }).filter((c: any) => c.score >= 10);

        if (candidates.length > 0) {
          const maxScore = Math.max(...candidates.map((c: any) => c.score));
          const bestCandidates = candidates.filter((c: any) => c.score === maxScore).map((c: any) => c.item);

          if (bestCandidates.length === 1) {
            const match = bestCandidates[0];
            const coords = match.Koordinat.split(',');
            const lat = parseFloat(coords[0].trim());
            const lng = parseFloat(coords[1].trim());
            return {
              isPrecise: true,
              kelurahan: match.Kelurahan_Desa,
              kecamatan: match.Kecamatan,
              kota: match.Kabupaten_Kota,
              lat,
              lng,
              formattedAddress: `${match.Kelurahan_Desa}, ${match.Kecamatan}, ${match.Kabupaten_Kota}`,
              zipcode: match.Kode_Pos,
            };
          }

          if (bestCandidates.length > 1) {
            return {
              isPrecise: false,
              ambiguityResults: bestCandidates,
            };
          }
        }
      }
    } catch (e) {
      console.error('[LOCAL GEOCODING ERROR]', e);
    }

    // 2. Cek apakah ini kata yang tidak presisi (nama kota atau kecamatan luas)
    const impreciseWords = ['surabaya', 'jakarta', 'bandung', 'sidoarjo', 'gresik', 'malang', 'rungkut', 'gubeng', 'waru'];
    if (impreciseWords.includes(cleanText)) {
      return {
        isPrecise: false,
        kota: cleanText,
      };
    }

    // Default fallback: kembalikan isPrecise: false jika tidak ada kecocokan
    return {
      isPrecise: false,
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
      zipcode: '60281',
    };
  }
}

export const geocodingService = new GeocodingService();

import { Client, AddressComponent } from '@googlemaps/google-maps-services-js';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getStringSimilarity } from '../../utils/similarity';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { measure } from '../../utils/timer';
import { callChatCompletionsWithFallback, getFallbackModel } from '../llm/model-fallback';
import { findPopularLandmark } from '../../config/landmarks';
import { escapeRegex } from '../../utils/gazetteer';
dotenv.config();

const INDONESIAN_STOP_WORDS = new Set([
  'saya', 'kamu', 'dia', 'mereka', 'kita', 'kami', 'anda', 'bunda', 'bund', 'kak', 'kakak', 'min', 'admin', 'sis', 'gan', 'mbak', 'mas', 'ya', 'ampun', 'elah', 'yaelah', 'yaampun', 'kok', 'gitu', 'sih', 'dong', 'saja', 'aja', 'mahal', 'murah', 'ongkir', 'ongkirnya', 'tarif', 'tarifnya', 'biaya', 'biayanya', 'ongkos', 'ongkosnya', 'harga', 'harganya', 'berapa', 'berapaan', 'kena', 'hitung', 'itung', 'cek', 'info', 'tanya', 'lokasi', 'alamat', 'rumah', 'jalan', 'gang', 'no', 'nomor', 'rt', 'rw', 'kelurahan', 'kecamatan', 'kabupaten', 'kota', 'desa', 'dusun', 'provinsi', 'homecare', 'spa', 'treatment', 'massage', 'pijat', 'booking', 'reservasi', 'jadwal', 'hari', 'tanggal', 'bulan', 'tahun', 'jam', 'waktu', 'bisa', 'mau', 'ingin', 'akan', 'sudah', 'belum', 'tidak', 'bukan', 'ada', 'tidakada', 'gratis', 'free', 'promo', 'diskon', 'banget', 'sangat', 'sekali', 'itu', 'ini', 'yang', 'dari', 'ke', 'di', 'pada', 'untuk', 'dengan', 'atau', 'dan', 'adalah', 'seperti', 'kalau', 'kalo', 'jika', 'bila', 'karena', 'sebab', 'tetapi', 'tapi', 'namun', 'melayani', 'panggil', 'datang', 'selamat', 'pagi', 'siang', 'sore', 'malam', 'halo', 'hola', 'hei', 'helo', 'assalamualaikum', 'salam', 'permisi', 'terima', 'kasih', 'terimakasih', 'thank', 'you'
]);

export interface ResolvedLocation {
  isPrecise: boolean;
  isFuzzyMatch?: boolean;
  isLlmResolved?: boolean;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
  ambiguityResults?: any[];
  zipcode?: string;
  matchedSpan?: string;
}

function getSubdistrictsFilePath(): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'config', 'surabaya_sidoarjo_subdistricts.json'),
    path.join(process.cwd(), 'dist', 'config', 'surabaya_sidoarjo_subdistricts.json'),
    path.resolve(__dirname, '../../config/surabaya_sidoarjo_subdistricts.json'),
    path.resolve(__dirname, '../../../src/config/surabaya_sidoarjo_subdistricts.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
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
      },
      { name: 'Google Geocoding' }
    );

    this.reverseGeocodeBreaker = new CircuitBreaker(
      async (params: any) => googleMapsClient.reverseGeocode(params),
      async (params: any): Promise<any> => {
        const { lat, lng } = params.params.latlng;
        return this.mockReverseGeocode(lat, lng);
      },
      { name: 'Google Reverse Geocoding' }
    );

  }

  /**
   * Mengambil koordinat & informasi administratif dari input teks.
   * LOCAL-FIRST ARCHITECTURE:
   * Tier 1: Periksa database gazetteer resmi (3.748 kelurahan/desa Surabaya & Sidoarjo) -> 0ms, 100% akurat.
   * Tier 2: Fallback ke Google Maps Geocoding API jika input berupa nama jalan/perumahan spesifik.
   */
  public async geocodeText(locationText: string): Promise<ResolvedLocation> {
    return measure('GEOCODING_TOTAL', async () => {
      try {
        // --- TIER 1: LOCAL GAZETTEER & LANDMARK MATCHER (PRIMARY) ---
        const landmarkMatch = findPopularLandmark(locationText);
        const localMatch = await this.mockGeocodeText(locationText);
        const hasSpecificStreetOrEstate = /\b(jalan|jl|jln|gang|gg|perum|perumahan|komplek|kompleks|blok|residence|residences|regency|cluster|villa|apartemen|apartment|mansion|estate|graha|griya|taman\s+\w+)\b/i.test(locationText);

        // Jika cocok sebagai landmark spesifik atau kelurahan presisi tanpa nama perumahan/jalan spesifik lain, gunakan localMatch
        if (localMatch.isPrecise && localMatch.lat != null && localMatch.lng != null && (landmarkMatch || !hasSpecificStreetOrEstate || !this.apiKey || this.apiKey.startsWith('mock'))) {
          console.log(`[GEOCODING LOCAL HIT] Resolved "${locationText}" via local gazetteer -> ${localMatch.kelurahan || '-'}, ${localMatch.kecamatan || '-'}, ${localMatch.kota || '-'}`);
          return localMatch;
        }

        // Jika localMatch mengembalikan ambiguitas nama kecamatan/wilayah luas (misal "Kenjeran", "Jambangan", "Waru") tanpa nama perumahan spesifik,
        // JANGAN fallback ke Google Maps API untuk menebak koordinat acak!
        // Pertahankan ambiguitas agar DecisionMatrix meminta detail kelurahan sesuai SOP.
        if (!localMatch.isPrecise && (localMatch as any).ambiguityResults && (localMatch as any).ambiguityResults.length > 1 && !hasSpecificStreetOrEstate) {
          return localMatch;
        }

        // --- TIER 2: GOOGLE MAPS API (FALLBACK UNTUK NAMA JALAN/PERUMAHAN) ---
        if (!this.apiKey || this.apiKey.startsWith('mock')) {
          return localMatch;
        }

        const lower = locationText.toLowerCase();
        let queryText = locationText;
        // Lapis 3: Territory-biased — bias ke Surabaya/Sidoarjo unless eksplisit kota luar
        const hasExplicitOutsideCity = /\b(jakarta|bandung|yogyakarta|yogya|semarang|malang|bojonegoro|kediri|mojokerto|pasuruan|probolinggo|jember|banyuwangi|madura|bangkalan|sampang|pamekasan|sumenep|tulungagung|blitar|madiun|nganjuk|jombang|lamongan|tuban|gresik\s*luar|gresik kota luar)\b/i.test(lower);
        if (!lower.includes('surabaya') && !lower.includes('sidoarjo') && !lower.includes('gresik') && !lower.includes('jawa timur')) {
          if (!hasExplicitOutsideCity) {
            queryText = `${locationText}, Surabaya, Jawa Timur, Indonesia`;
          } else {
            queryText = `${locationText}, Jawa Timur, Indonesia`;
          }
        }

        // =========================================================================
        // GAZETTEER PRE-VALIDATION GATE
        // Mencegah blind geocoding ke Google Maps ketika input tidak memiliki
        // kemiripan kata sama sekali dengan basis data wilayah riil (kelurahan/kecamatan).
        // Jika input sepenuhnya generik/tanya (misal "dmn ya", "lokasi dimana") tanpa
        // nama wilayah konkret, batalkan ke-Google dan kembalikan isPrecise: false
        // agar DecisionMatrix tidak memicu kalkulasi ongkir salah.
        // =========================================================================
        try {
          const filePathForGate = getSubdistrictsFilePath();
          const dataForGate = fs.existsSync(filePathForGate)
            ? JSON.parse(fs.readFileSync(filePathForGate, 'utf-8'))
            : [];

          const lowerNorm = locationText.toLowerCase().replace(/\s+/g, '');
          const hasGazetteerMatch = dataForGate.some((entry: any) => {
            const kelLower = entry.Kelurahan_Desa.toLowerCase().replace(/\s+/g, '');
            const kecLower = entry.Kecamatan.toLowerCase().replace(/\s+/g, '');
            // Cek kecocokan eksak nama kelurahan
            if (kelLower === lowerNorm) return true;
            // Cek kecocokan eksak nama kecamatan
            if (kecLower === lowerNorm) return true;
            // Cek kecocokan n-gram singkat (minimal 3 huruf) untuk typo/alias
            if (kelLower.length >= 3 && lowerNorm.includes(kelLower)) return true;
            if (kecLower.length >= 3 && lowerNorm.includes(kecLower)) return true;
            return false;
          });

          const isStreetOrLandmark = /\b(jalan|jl|jln|gang|gg|no|nomor|rt|rw|perum|perumahan|komplek|ruko|apart|apartemen|villa|residence|cluster|masjid|rs|spbu|pasar|stasiun|terminal|mall|plaza)\b/i.test(locationText);
          if (!hasGazetteerMatch && !isStreetOrLandmark && locationText.trim().split(/\s+/).length <= 4) {
            console.log(`[GEOCODING GATE] Input "${locationText}" lacks gazetteer match → bypass Google Maps`);
            return { isPrecise: false };
          }
        } catch (_) {
          // Jika gagal baca file gazetteer, lanjutkan ke Google Maps (fallback)
        }

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
          return localMatch.isPrecise ? localMatch : { isPrecise: false };
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

        const googleResult: ResolvedLocation = {
          isPrecise,
          kelurahan,
          kecamatan,
          kota,
          lat,
          lng,
          formattedAddress: topResult.formatted_address,
          zipcode,
        };

        // Lapis 4: Second-pass verification — jika hasil Google jauh (OOC) tapi query tidak menyebut kota luar eksplisit,
        // coba verifikasi ulang dengan bias eksplisit Surabaya/Sidoarjo
        if (googleResult.lat != null && googleResult.lng != null) {
          try {
            const { calculateHaversineDistance } = await import('../../utils/haversine');
            const { clinicConfig } = await import('../../config/clinic');
            const distKm = calculateHaversineDistance(
              { lat: clinicConfig.lat, lng: clinicConfig.lng },
              { lat: googleResult.lat, lng: googleResult.lng }
            ) * 1.6; // haversine estimate
            const isOOC = distKm > 30;
            const hasExplicitOutsideCityForSecondPass = /\b(jakarta|bandung|yogyakarta|yogya|semarang|malang|bojonegoro|kediri|mojokerto|pasuruan|probolinggo|jember|banyuwangi|madura|bangkalan|sampang|pamekasan|sumenep|tulungagung|blitar|madiun|nganjuk|jombang|lamongan|tuban)\b/i.test(lower);
            if (isOOC && !hasExplicitOutsideCityForSecondPass && lower.trim().split(/\s+/).length <= 3) {
              // Coba second-pass dengan bias eksplisit Surabaya
              console.log(`[GEOCODING SECOND-PASS] Google result OOC (${distKm.toFixed(1)}km, ${googleResult.kelurahan || '-'} -> ${googleResult.kota || '-'}) untuk "${locationText}" — coba verifikasi Surabaya/Sidoarjo`);
              const retryQueries = [
                `${locationText}, Kota Surabaya, Jawa Timur, Indonesia`,
                `${locationText}, Kabupaten Sidoarjo, Jawa Timur, Indonesia`,
              ];
              for (const retryQuery of retryQueries) {
                try {
                  const retryResponse = await this.geocodeBreaker.execute({
                    params: {
                      address: retryQuery,
                      key: this.apiKey,
                      components: { country: 'ID' },
                    },
                  });
                  if (retryResponse && 'isPrecise' in retryResponse) continue;
                  if (!retryResponse.data.results || retryResponse.data.results.length === 0) continue;
                  const retryTop = retryResponse.data.results[0];
                  const retryLat = retryTop.geometry.location.lat;
                  const retryLng = retryTop.geometry.location.lng;
                  const retryDistKm = calculateHaversineDistance(
                    { lat: clinicConfig.lat, lng: clinicConfig.lng },
                    { lat: retryLat, lng: retryLng }
                  ) * 1.6;
                  if (retryDistKm <= 30) {
                    const retryKelurahan = this.extractComponent(retryTop.address_components, ['administrative_area_level_4', 'sublocality_level_1', 'neighborhood']);
                    const retryKecamatan = this.extractComponent(retryTop.address_components, ['administrative_area_level_3', 'sublocality']);
                    const retryKota = this.extractComponent(retryTop.address_components, ['administrative_area_level_2', 'locality']);
                    console.log(`[GEOCODING SECOND-PASS HIT] "${retryQuery}" → ${retryKelurahan || '-'}, ${retryKecamatan || '-'}, ${retryKota || '-'} (${retryDistKm.toFixed(1)}km) — override OOC`);
                    return {
                      isPrecise: Boolean(retryKelurahan),
                      kelurahan: retryKelurahan,
                      kecamatan: retryKecamatan,
                      kota: retryKota,
                      lat: retryLat,
                      lng: retryLng,
                      formattedAddress: retryTop.formatted_address,
                      zipcode: this.extractComponent(retryTop.address_components, ['postal_code']),
                    };
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }

        return googleResult;
      } catch (error) {
        console.error('Error in Google Maps geocodeText, falling back to local database:', error);
        return this.mockGeocodeText(locationText);
      }
    });
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
   * Comparator untuk menentukan kandidat match mana yang lebih baik (tie-breaking).
   */
  private isBetterMatch(
    candidate: { score: number; level: 'kelurahan' | 'kecamatan'; matchedSpan: string },
    current: { score: number; level: 'kelurahan' | 'kecamatan'; matchedSpan: string } | null
  ): boolean {
    if (!current) return true;
    if (candidate.score !== current.score) {
      return candidate.score > current.score;
    }
    if (candidate.level !== current.level) {
      return candidate.level === 'kelurahan'; // 'kelurahan' wins over 'kecamatan' (more specific)
    }
    const candWords = candidate.matchedSpan.split(' ').length;
    const currWords = current.matchedSpan.split(' ').length;
    if (candWords !== currWords) {
      return candWords > currWords; // prefer spans with more words
    }
    return candidate.matchedSpan.length > current.matchedSpan.length; // prefer longer spans (character length)
  }

  /**
   * Memecah teks menjadi semua kombinasi n-gram kandidat.
   * Tetap menggunakan kata asli dari urutan kalimat untuk menghindari adjacency palsu,
   * lalu mengabaikan span yang seluruhnya berisi kata-kata stop words.
   */
  private generateCandidateSpans(text: string, maxWords = 4): string[] {
    const cleanText = text.replace(/[,.!?()\-+;:]/g, ' ');
    const words = cleanText.split(/\s+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 0);
      
    const spans: string[] = [];
    
    for (let len = 1; len <= maxWords; len++) {
      for (let i = 0; i <= words.length - len; i++) {
        const rawSpanWords = words.slice(i, i + len);
        
        // Skip span jika SELURUH kata di dalamnya adalah stop word atau terlalu pendek (<3 karakter)
        const isAllNoise = rawSpanWords.every(w => w.length < 3 || INDONESIAN_STOP_WORDS.has(w));
        if (isAllNoise) {
          continue;
        }

        const span = rawSpanWords.join(' ').trim();
        if (span) {
          spans.push(span);
        }
      }
    }
    return Array.from(new Set(spans)).sort((a, b) => {
      const aWords = a.split(' ').length;
      const bWords = b.split(' ').length;
      if (aWords !== bWords) {
        return bWords - aWords;
      }
      return b.length - a.length;
    });
  }

  /**
   * Mencari entri gazetteer terbaik berdasarkan candidate spans.
   * kelurahanThreshold = 0.75: untuk menangani typo ejaan kelurahan (misal 'kenjern' vs 'kenjeran' Dice=0.769).
   * kecamatanThreshold = 0.82: batas lebih ketat karena nama kecamatan cenderung pendek (misal 'candi', 'waru') rawan false positive.
   */
  private findBestGazetteerMatch(
    rawText: string,
    data: any[],
    kelurahanThreshold = 0.75,
    kecamatanThreshold = 0.82
  ): {
    item: any;
    score: number;
    level: 'kelurahan' | 'kecamatan';
    matchedSpan: string;
  } | null {
    const spans = this.generateCandidateSpans(rawText);
    let bestMatch: {
      item: any;
      score: number;
      level: 'kelurahan' | 'kecamatan';
      matchedSpan: string;
    } | null = null;

    for (const span of spans) {
      const lowerSpan = span.toLowerCase();
      
      for (const entry of data) {
        const kelName = entry.Kelurahan_Desa.toLowerCase();
        const kecName = entry.Kecamatan.toLowerCase();
        const combinedName1 = `${entry.Kelurahan_Desa} ${entry.Kecamatan}`.toLowerCase();
        const combinedName2 = `${entry.Kecamatan} ${entry.Kelurahan_Desa}`.toLowerCase();

        // 1. Check Kecamatan
        if (lowerSpan === kecName) {
          const cand = { item: entry, score: 1.0, level: 'kecamatan' as const, matchedSpan: span };
          if (this.isBetterMatch(cand, bestMatch)) {
            bestMatch = cand;
          }
        } else {
          const similarity = getStringSimilarity(lowerSpan, kecName);
          const dynamicKecThreshold = kecName.length <= 4 ? 0.85 : 0.75;
          if (similarity >= dynamicKecThreshold) {
            const cand = { item: entry, score: similarity, level: 'kecamatan' as const, matchedSpan: span };
            if (this.isBetterMatch(cand, bestMatch)) {
              bestMatch = cand;
            }
          }
        }

        // 2. Check Kelurahan
        if (lowerSpan === kelName) {
          const cand = { item: entry, score: 1.0, level: 'kelurahan' as const, matchedSpan: span };
          if (this.isBetterMatch(cand, bestMatch)) {
            bestMatch = cand;
          }
        } else {
          const similarity = getStringSimilarity(lowerSpan, kelName);
          if (similarity >= kelurahanThreshold) {
            const cand = { item: entry, score: similarity, level: 'kelurahan' as const, matchedSpan: span };
            if (this.isBetterMatch(cand, bestMatch)) {
              bestMatch = cand;
            }
          }
        }

        // 3. Check combined Kelurahan + Kecamatan
        if (lowerSpan === combinedName1 || lowerSpan === combinedName2) {
          const cand = { item: entry, score: 1.0, level: 'kelurahan' as const, matchedSpan: span };
          if (this.isBetterMatch(cand, bestMatch)) {
            bestMatch = cand;
          }
        } else {
          const sim1 = getStringSimilarity(lowerSpan, combinedName1);
          const sim2 = getStringSimilarity(lowerSpan, combinedName2);
          const maxSim = Math.max(sim1, sim2);
          if (maxSim >= kelurahanThreshold) {
            const cand = { item: entry, score: maxSim, level: 'kelurahan' as const, matchedSpan: span };
            if (this.isBetterMatch(cand, bestMatch)) {
              bestMatch = cand;
            }
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Geocode Mock Local Database Fallback untuk testing tanpa API key.
   */
  private async mockGeocodeText(locationText: string): Promise<ResolvedLocation> {
    const lower = locationText.toLowerCase().trim();
    let kecamatanOnlyFallback: ResolvedLocation | null = null;

    // 0. Cek Landmark / Apartemen / Mall Populer terlebih dahulu
    const landmark = findPopularLandmark(locationText);
    if (landmark) {
      const gazetteerMatch = this.crossCheckGazetteer(landmark.kelurahan, landmark.kecamatan, landmark.kota);
      if (gazetteerMatch) {
        return {
          ...gazetteerMatch,
          isPrecise: true,
          lat: landmark.lat !== undefined ? landmark.lat : gazetteerMatch.lat,
          lng: landmark.lng !== undefined ? landmark.lng : gazetteerMatch.lng,
          formattedAddress: `${landmark.name}, Kel. ${landmark.kelurahan}, Kec. ${landmark.kecamatan}, ${landmark.kota}`,
        };
      }
    }
    
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
      .replace(/^.*?\b(ganti|pindah|ubah|salah|yang\s+bener)\s+(ke|di|hanya|saja)\s+/i, '')
      .replace(/^.*?\balamat\s+(ke|di)\s+/i, '')
      .trim();

    // --- HARD GATE: Kecamatan/Kota-only tanpa kelurahan → TOLAK, minta detail ---
    // Pindahkan dari bawah ke sini SEBELUM gazetteer/LLM processing.
    // "waru" = kecamatan → harus ditolak, jangan coba resolve via LLM.
    // TAPI: kalau user sebut "kelurahan/desa/kel/ds" (di mana pun), jangan ditolak.
    const hasExplicitKelurahanKeyword = lower.includes('kelurahan') || lower.includes('desa') || lower.includes('kel ') || lower.includes('kelurahan ') || lower.includes('ds ');

    // Kumpulkan daftar nama kecamatan & kota luas langsung dari gazetteer,
    // bukan hardcoded — supaya semua kecamatan di data ter-cover.
    let kecamatanMap = new Map<string, any[]>();
    try {
      const filePathForGate = getSubdistrictsFilePath();
      if (fs.existsSync(filePathForGate)) {
        const dataForGate = JSON.parse(fs.readFileSync(filePathForGate, 'utf-8'));
        for (const entry of dataForGate) {
          const kecKey = entry.Kecamatan.toLowerCase().replace(/\s+/g, '');
          const existing = kecamatanMap.get(kecKey) || [];
          existing.push(entry);
          kecamatanMap.set(kecKey, existing);
        }
      }
    } catch (e) {
      // ignore — fallback ke list statis
    }

    const cleanNorm = cleanText.replace(/\s+/g, '');
    const lowerNorm = lower.replace(/\s+/g, '');
    const staticImpreciseWords = [
      'surabaya', 'jakarta', 'bandung', 'sidoarjo', 'gresik', 'malang', 'rungkut', 'gubeng', 'waru',
      'sby', 'sda', 'sbybarat', 'surabayabarat', 'sbytimur', 'surabayatimur', 'sbyselatan', 'surabayaselatan',
      'sbyutara', 'surabayautara', 'sbypusat', 'surabayapusat', 'sidoarjobarat', 'sidoarjotimur',
      'sidoarjoselatan', 'sidoarjoutara', 'sidoarjokota'
    ];

    // Cek apakah cleanNorm persis sama dengan nama kelurahan tertentu di gazetteer
    // atau apakah teks mengandung nama kelurahan riil di database
    let isExactKelurahanName = false;
    let hasAnyKelurahanInText = false;
    try {
      const filePathForGate = getSubdistrictsFilePath();
      if (fs.existsSync(filePathForGate)) {
        const dataForGate = JSON.parse(fs.readFileSync(filePathForGate, 'utf-8'));
        isExactKelurahanName = dataForGate.some((entry: any) => {
          const kelKey = entry.Kelurahan_Desa.toLowerCase().replace(/\s+/g, '');
          return kelKey === cleanNorm;
        });

        hasAnyKelurahanInText = dataForGate.some((entry: any) => {
          const kelLower = entry.Kelurahan_Desa.toLowerCase().trim();
          if (kelLower.length < 3) return false;
          if (['sidoarjo', 'surabaya', 'kota', 'desa'].includes(kelLower)) return false;
          const reg = new RegExp(`\\b${escapeRegex(kelLower)}\\b`, 'i');
          return reg.test(lower);
        });
      }
    } catch (_) {}

    // Cek apakah cleanText/lowerNorm mencocoki nama kecamatan luas di database (termasuk fuzzy typo)
    let matchedKecSubdistricts: any[] | null = null;
    let matchedKecName = '';
    for (const [kecKey, entries] of kecamatanMap.entries()) {
      const origKec = entries[0]?.Kecamatan ? entries[0].Kecamatan.toLowerCase() : kecKey;
      const kecRegex = new RegExp(`\\b${escapeRegex(origKec)}\\b`, 'i');
      const isDirectMatch = cleanNorm === kecKey || kecRegex.test(lower);
      const sim = !isDirectMatch ? getStringSimilarity(cleanNorm, kecKey) : 1.0;
      const kecThreshold = kecKey.length <= 4 ? 0.85 : 0.75;
      if (isDirectMatch || sim >= kecThreshold) {
        // Jika cleanNorm persis nama kelurahan dan BUKAN persis nama kecamatan, jangan anggap sebagai kecamatan luas
        if (cleanNorm !== kecKey && (isExactKelurahanName || hasAnyKelurahanInText)) {
          continue;
        }
        matchedKecSubdistricts = entries;
        matchedKecName = entries[0]?.Kecamatan || cleanText;
        break;
      }
    }

    const isExactKecamatanName = Array.from(kecamatanMap.keys()).some(k => k === cleanNorm);
    const isStaticImpreciseWord = cleanText.length > 0 && staticImpreciseWords.some(w => cleanNorm === w.replace(/\s+/g, ''));
    const hasSpecificKelurahanInText = matchedKecSubdistricts ? matchedKecSubdistricts.some(d => {
      const kelLower = d.Kelurahan_Desa.toLowerCase();
      const kecLower = d.Kecamatan.toLowerCase();
      const reg = new RegExp(`\\b${escapeRegex(kelLower)}\\b`, 'i');
      return kelLower !== kecLower && reg.test(lower);
    }) : false;
    const hasStreetAddressKeyword = /\b(jalan|jl|jln|gang|gg|perum|perumahan|komplek|kompleks|blok|no|nomor|residence|residences|regency|cluster|villa|apartemen|apartment|mansion|land|park|townhouse|village|garden|green|estate|kost|kos|graha|griya|wisma|dusun|rt|rw|pos|rumdis|tni|al|lanudal|asrama|kavling|kav)\b/i.test(lower);

    // Periksa apakah ada kata bermakna lain di luar nama kota/kecamatan dan stop words
    // Misal: "banjarmukti", "wonosari", "safira", "sukodono permai", "citragarden"
    const matchedKecWords = new Set(matchedKecName.toLowerCase().split(/\s+/));
    const wordsInClean = cleanText.split(/\s+/).filter(w => {
      const cleanW = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanW.length >= 3 && 
             !INDONESIAN_STOP_WORDS.has(cleanW) && 
             cleanW !== 'sidoarjo' && 
             cleanW !== 'surabaya' && 
             cleanW !== 'kota' &&
             cleanW !== 'kabupaten' &&
             !matchedKecWords.has(cleanW);
    });
    const hasMeaningfulPoiTokens = wordsInClean.length > 0;
    const hasSpecificLocationContext = hasStreetAddressKeyword || hasMeaningfulPoiTokens;

    if ((matchedKecSubdistricts || isStaticImpreciseWord) && !hasExplicitKelurahanKeyword && !hasSpecificKelurahanInText && (isExactKecamatanName || (!isExactKelurahanName && !hasAnyKelurahanInText))) {
      if (hasSpecificLocationContext) {
        // Jika ada nama perumahan / POI / jalan, jangan tolak langsung — simpan sebagai fallback agar LLM/Google Maps dapat mengidentifikasi kelurahannya
        if (matchedKecSubdistricts && matchedKecSubdistricts.length > 1) {
          kecamatanOnlyFallback = {
            isPrecise: false,
            ambiguityResults: matchedKecSubdistricts,
            matchedSpan: matchedKecName,
          };
        }
      } else {
        if (matchedKecSubdistricts && matchedKecSubdistricts.length > 1) {
          return {
            isPrecise: false,
            ambiguityResults: matchedKecSubdistricts,
            matchedSpan: matchedKecName,
          };
        }
        return {
          isPrecise: false,
          kota: cleanText,
        };
      }
    }

    // 1. Coba cocokkan dengan local subdistricts JSON database
    try {
      const filePath = getSubdistrictsFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // --- PRIORITAS: PREFIX COLLOQUIAL INDEX (Lapis 1) ---
        // Customer bilang "Manukan" → match Manukan Kulon/Wetan via prefix index
        {
          const singleWord = (cleanText || lower).trim().toLowerCase();
          // Hanya untuk input 1 kata (atau 1 kata + kota seperti "Manukan surabaya")
          const wordsOnly = singleWord.replace(/\b(surabaya|sidoarjo|gresik|sby|sda|jawa timur|jawa|timur|kota|kabupaten)\b/gi, '').trim().replace(/\s+/g, ' ');
          const isSinglePrefixCandidate = wordsOnly && !wordsOnly.includes(' ') && wordsOnly.length >= 3;
          if (isSinglePrefixCandidate) {
            try {
              const { resolvePrefixMatches } = await import('../../utils/gazetteer');
              const prefixKelurahanList = resolvePrefixMatches(wordsOnly);
              if (prefixKelurahanList && prefixKelurahanList.length > 0) {
                const prefixEntries = data.filter((d: any) => prefixKelurahanList.includes(d.Kelurahan_Desa));
                if (prefixEntries.length === 1) {
                  const match = prefixEntries[0];
                  const coords = match.Koordinat.split(',');
                  const lat = parseFloat(coords[0].trim());
                  const lng = parseFloat(coords[1].trim());
                  console.log(`[GEOCODING PREFIX HIT] "${singleWord}" → ${match.Kelurahan_Desa}, ${match.Kecamatan} via prefix index`);
                  return {
                    isPrecise: true,
                    kelurahan: match.Kelurahan_Desa,
                    kecamatan: match.Kecamatan,
                    kota: match.Kabupaten_Kota,
                    lat,
                    lng,
                    formattedAddress: `${match.Kelurahan_Desa}, ${match.Kecamatan}, ${match.Kabupaten_Kota}`,
                    zipcode: match.Kode_Pos,
                    matchedSpan: wordsOnly,
                  };
                } else if (prefixEntries.length > 1) {
                  // Ambigu: "Manukan" → Manukan Kulon + Manukan Wetan → kembalikan sebagai ambiguity untuk disambiguasi di DecisionMatrix
                  console.log(`[GEOCODING PREFIX AMBIGUOUS] "${singleWord}" → ${prefixEntries.length} kelurahan: ${prefixKelurahanList.join(', ')}`);
                  return {
                    isPrecise: false,
                    ambiguityResults: prefixEntries,
                    matchedSpan: wordsOnly,
                  };
                }
              }
            } catch (_) {}
          }
        }

        // --- PRIORITAS: N-GRAM GAZEETTEER MATCH ---
        const bestMatch = this.findBestGazetteerMatch(cleanText || lower, data);
        if (bestMatch) {
          const { item, score, level, matchedSpan } = bestMatch;
          
          if (level === 'kecamatan') {
            const hasExplicitKelurahan = lower.includes('kelurahan') || lower.includes('desa') || lower.includes('kel') || lower.includes('ds');
            if (!hasExplicitKelurahan) {
              const subdistrictsInKec = data.filter((d: any) => d.Kecamatan.toLowerCase() === item.Kecamatan.toLowerCase());
              if (!kecamatanOnlyFallback || !kecamatanOnlyFallback.ambiguityResults) {
                kecamatanOnlyFallback = {
                  isPrecise: false,
                  ambiguityResults: subdistrictsInKec.length > 1 ? subdistrictsInKec : undefined,
                  kota: item.Kabupaten_Kota || matchedSpan,
                  matchedSpan: item.Kecamatan || matchedSpan,
                };
              }
            }
          } else {
            // Find all entries for this kelurahan (to handle ambiguity if there are duplicates)
            const matchedKelurahanLower = item.Kelurahan_Desa.toLowerCase();
            
            // Check if this kelurahan name is also a broad kecamatan name in Sidoarjo/Surabaya
            const matchedKelNorm = matchedKelurahanLower.replace(/\s+/g, '');
            const kecNames = new Set<string>(data.map((d: any) => String(d.Kecamatan || '').toLowerCase()));
            const isAlsoKecamatanName = Array.from(kecNames).some(k => k === matchedKelurahanLower || k.replace(/\s+/g, '') === matchedKelNorm);
            const hasExplicitKelurahan = lower.includes('kelurahan') || lower.includes('desa') || lower.includes('kel ') || lower.includes('kelurahan ') || lower.includes('ds ');

            if (isAlsoKecamatanName && !hasExplicitKelurahan) {
              const subdistrictsInKec = data.filter((d: any) =>
                d.Kecamatan.toLowerCase() === matchedKelurahanLower ||
                d.Kecamatan.toLowerCase().replace(/\s+/g, '') === matchedKelNorm
              );
              if (subdistrictsInKec.length > 1) {
                return {
                  isPrecise: false,
                  ambiguityResults: subdistrictsInKec,
                  matchedSpan,
                };
              }
            }

            const exactMatches = data.filter((d: any) => d.Kelurahan_Desa.toLowerCase() === matchedKelurahanLower);
            
            if (exactMatches.length > 0) {
              // Check if user input explicitly mentions one of the kecamatans to resolve ambiguity
              const matchesWithKec = exactMatches.filter((m: any) => lower.includes(m.Kecamatan.toLowerCase()));
              
              if (matchesWithKec.length === 1) {
                const match = matchesWithKec[0];
                const coords = match.Koordinat.split(',');
                const lat = parseFloat(coords[0].trim());
                const lng = parseFloat(coords[1].trim());
                const isExact = score === 1.0;
                return {
                  isPrecise: isExact,
                  isFuzzyMatch: !isExact,
                  kelurahan: match.Kelurahan_Desa,
                  kecamatan: match.Kecamatan,
                  kota: match.Kabupaten_Kota,
                  lat,
                  lng,
                  formattedAddress: `${match.Kelurahan_Desa}, ${match.Kecamatan}, ${match.Kabupaten_Kota}`,
                  zipcode: match.Kode_Pos,
                  matchedSpan,
                };
              } else if (exactMatches.length === 1) {
                const match = exactMatches[0];
                const coords = match.Koordinat.split(',');
                const lat = parseFloat(coords[0].trim());
                const lng = parseFloat(coords[1].trim());
                const isExact = score === 1.0;
                return {
                  isPrecise: isExact,
                  isFuzzyMatch: !isExact,
                  kelurahan: match.Kelurahan_Desa,
                  kecamatan: match.Kecamatan,
                  kota: match.Kabupaten_Kota,
                  lat,
                  lng,
                  formattedAddress: `${match.Kelurahan_Desa}, ${match.Kecamatan}, ${match.Kabupaten_Kota}`,
                  zipcode: match.Kode_Pos,
                  matchedSpan,
                };
              } else {
                return {
                  isPrecise: false,
                  ambiguityResults: exactMatches,
                  matchedSpan,
                };
              }
            }
          }
        }

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
          const kelRegex = new RegExp(`\\b${escapeRegex(kelName)}\\b`, 'i');
          if (kelRegex.test(cleanText)) {
            score += 10;
            const startsWithRegex = new RegExp(`^${escapeRegex(kelName)}\\b`, 'i');
            if (startsWithRegex.test(cleanText)) {
              score += 5;
            }
          }
          if (score === 0) return { item: d, score: 0 };

          const kecRegex = new RegExp(`\\b${escapeRegex(kecName)}\\b`, 'i');
          if (kecRegex.test(cleanText)) {
            score += 2;
          }
          const kotaRegex = new RegExp(`\\b${escapeRegex(kotaName)}\\b`, 'i');
          if (kotaRegex.test(cleanText)) {
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

    // 3. LLM Fallback: coba resolve via LLM jika gazetteer gagal
    const llmResult = await this.llmResolveLocation(locationText);
    if (llmResult) {
      return llmResult;
    }

    // 4. Return kecamatan-only fallback jika ada (dari match kecamatan tanpa kelurahan)
    if (kecamatanOnlyFallback) {
      return kecamatanOnlyFallback;
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

  /**
   * LLM Fallback: Resolve lokasi teks yang tidak ter-deteksi oleh gazetteer.
   * Menggunakan LLM untuk identifikasi kelurahan/kecamatan/kota, lalu cross-check ke gazetteer.
   */
  private async llmResolveLocation(locationText: string): Promise<ResolvedLocation | null> {
    const apiKey = process.env.LLM_API_KEY || '';
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    let model = process.env.AI_MODEL_NLU || '';
    if (!model) {
      try {
        const { AiModelConfigService } = await import('../../config/ai-models.config');
        model = AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION')?.modelName || 'MiniMax-M2.7-highspeed';
      } catch {
        model = 'MiniMax-M2.7-highspeed';
      }
    }

    if (!apiKey || apiKey.startsWith('mock')) {
      return null;
    }

    // Skip LLM network call di test environment supaya unit test cepat & deterministik
    if (process.env.NODE_ENV === 'test') {
      return null;
    }

    if (locationText.trim().length < 3) {
      return null;
    }

    // Validasi input: skip LLM jika input terlalu generik/tidak mengandung indikasi lokasi
    const cleanedInput = locationText.toLowerCase()
      .replace(/\s+(bund|bunda|ya|kak|min|mbak|mas|gan|sis|aja|saja|dong|kok|deh)\b/g, '')
      .replace(/^(saya\s+)?di\s+/, '')
      .trim();

    // Jika input bersih terlalu pendek (<2 karakter) atau hanya kata tanya/filler, skip LLM
    // Normalisasi multi-spasi jadi 1 spasi untuk pola seperti "gtau ah"
    const normalizedForCheck = cleanedInput.replace(/\s+/g, ' ').trim();
    const fillerPatterns = /^(gtau\s*ah?|ga\s+tau|gak\s+tau|tidak\s+tau|ntau|sana|sini|gitu|gini|gtw|tauh?|ah|eh|oh|ih|uh|ya|iy|ok|oke|ga|gk|g|gitu\s+deh|ya\s+gitu\s+deh|lah|udah|dah|gapaham|gatau|nggak\s*tahu)$/i;
    if (normalizedForCheck.length < 2 || fillerPatterns.test(normalizedForCheck)) {
      return null;
    }

    try {
      const systemPrompt = `Anda adalah asisten geocoding untuk area Sidoarjo dan Surabaya, Jawa Timur, Indonesia.
Tugas: Identifikasi nama kelurahan/desa, kecamatan, dan kota/kabupaten dari teks lokasi atau nama jalan yang diberikan.

CONTOH:
- "jl kyai husein no 57, sedati, sidoarjo" → kelurahan: "Pabean", kecamatan: "Sedati", kota: "Kabupaten Sidoarjo"
- "banjarmukti residence sidoarjo" → kelurahan: "Banjarkemantren", kecamatan: "Buduran", kota: "Kabupaten Sidoarjo"
- "perumahan banjar mukti residence" → kelurahan: "Banjarkemantren", kecamatan: "Buduran", kota: "Kabupaten Sidoarjo"
- "safira garden sidoarjo" → kelurahan: "Sepande", kecamatan: "Candi", kota: "Kabupaten Sidoarjo"
- "citragarden sidoarjo" → kelurahan: "Entalsewu", kecamatan: "Buduran", kota: "Kabupaten Sidoarjo"
- "puri surya jaya gedangan" → kelurahan: "Ketajen", kecamatan: "Gedangan", kota: "Kabupaten Sidoarjo"
- "rumdis tni al wonosari a132" → kelurahan: "Bulakbanteng", kecamatan: "Kenjeran", kota: "Kota Surabaya"
- "komplek tni al wonosari" → kelurahan: "Bulakbanteng", kecamatan: "Kenjeran", kota: "Kota Surabaya"
- "lanudal juanda" → kelurahan: "Semambung", kecamatan: "Gedangan", kota: "Kabupaten Sidoarjo"
- "brebek waru" → kelurahan: "Berbek", kecamatan: "Waru", kota: "Kabupaten Sidoarjo"
- "apartemen anderson (diatasnya pakuwon mall sby barat)" → kelurahan: "Babatan", kecamatan: "Wiyung", kota: "Kota Surabaya"
- "pakuwon mall surabaya barat" → kelurahan: "Babatan", kecamatan: "Wiyung", kota: "Kota Surabaya"
- "apartemen orchard / tanglin pakuwon mall" → kelurahan: "Babatan", kecamatan: "Wiyung", kota: "Kota Surabaya"
- "ciputra world surabaya" → kelurahan: "Gunung Sari", kecamatan: "Dukuh Pakis", kota: "Kota Surabaya"
- "royal plaza surabaya" → kelurahan: "Wonokromo", kecamatan: "Wonokromo", kota: "Kota Surabaya"
- "tunjungan plaza surabaya" → kelurahan: "Kedungdoro", kecamatan: "Tegalsari", kota: "Kota Surabaya"
- "galaxy mall surabaya" → kelurahan: "Mulyorejo", kecamatan: "Mulyorejo", kota: "Kota Surabaya"
- "jl raya wadungasri no 12 waru" → kelurahan: "Wadungasri", kecamatan: "Waru", kota: "Kabupaten Sidoarjo"

ATURAN:
- Hanya return JSON, tanpa penjelasan tambahan
- Jika lokasi tidak dikenali atau terlalu vagu, return null untuk semua field
- Fokus pada area Sidoarjo dan Surabaya saja
- Nama kelurahan harus nama resmi dari data administrasi, bukan nama dusun/RT

PENTING: Anda WAJIB mengakhiri jawaban dengan blok JSON final berikut (boleh berisi null),
walaupun Anda melakukan reasoning internal terlebih dahulu — JSON final harus lengkap.

OUTPUT JSON:
{
  "kelurahan": "nama kelurahan atau null",
  "kecamatan": "nama kecamatan atau null",
  "kota": "nama kota/kabupaten atau null"
}`;

      const startedAt = Date.now();
      let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
      try {
        callResult = await measure('LLM_GEOCODE_API_CALL', () =>
          callChatCompletionsWithFallback({
            baseUrl,
            apiKey,
            model,
            fallbackModel: getFallbackModel(),
            timeoutMs: Number(process.env.LLM_TIMEOUT_GEOCODE_MS || process.env.LLM_TIMEOUT_NLU_MS || 120000),
            payload: {
              temperature: 0.1,
              max_tokens: 512,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Lokasi: "${locationText}"` },
              ],
            },
          })
        );
      } catch (err: any) {
        try {
          const { auditLlmCall } = await import('../llm/../llm/model-fallback').then(() => import('../../utils/llm-audit-buffer'));
          auditLlmCall({
            customer_phone: 'geocode-audit',
            task_type: 'GEOCODE_RESOLVER',
            model_name: model,
            baseUrl,
            startedAt,
            error: err,
          });
        } catch {
          // Fire-and-forget
        }
        throw err;
      }

      const responseData = callResult.data;
      try {
        const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: 'geocode-audit',
          task_type: 'GEOCODE_RESOLVER',
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: responseData?.usage,
        });
      } catch {
        // Fire-and-forget
      }

      let content = responseData?.choices?.[0]?.message?.content?.trim();
      const reasoning = responseData?.choices?.[0]?.message?.reasoning_content || '';

      if (reasoning) {
        console.log(`\n[LLM REASONING (GEOCODE)]:\n${reasoning}\n`);
      }
      
      // Handle DeepSeek reasoning models: content kosong, jawaban di reasoning_content
      if (!content && reasoning) {
        // Coba extract JSON dari reasoning content
        const jsonMatch = reasoning.match(/\{[\s\S]*?"kelurahan"[\s\S]*?\}/);
        if (jsonMatch) {
          content = jsonMatch[0];
          console.log(`[LLM GEOCODE] Extracted JSON from reasoning_content`);
        }
      }

      if (!content) {
        return null;
      }

      // Bersihkan teks dari markdown code block (seperti ```json ... ```) agar tidak merusak JSON.parse
      content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

      const parsed = JSON.parse(content);
      if (!parsed.kelurahan && !parsed.kecamatan) {
        return null;
      }

      console.log(`[LLM GEOCODE] Resolved "${locationText}" → ${JSON.stringify(parsed)}`);

      // Cross-check ke gazetteer untuk ambil koordinat
      const gazetteerResult = this.crossCheckGazetteer(parsed.kelurahan, parsed.kecamatan, parsed.kota);
      if (gazetteerResult) {
        gazetteerResult.isLlmResolved = true;
      }
      return gazetteerResult;
    } catch (error: any) {
      console.warn(`[LLM GEOCODE ERROR] Failed to resolve "${locationText}":`, error.message);
      return null;
    }
  }

  /**
   * Cross-check hasil LLM ke gazetteer untuk ambil koordinat.
   */
  private crossCheckGazetteer(
    kelurahan?: string | null,
    kecamatan?: string | null,
    kota?: string | null
  ): ResolvedLocation | null {
    try {
      const filePath = getSubdistrictsFilePath();
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Cari berdasarkan kelurahan + kecamatan
      if (kelurahan) {
        const kelLower = kelurahan.toLowerCase().trim();
        const kelNorm = kelLower.replace(/\s+/g, '');
        const matches = data.filter((d: any) => {
          const dKel = d.Kelurahan_Desa.toLowerCase().trim();
          return dKel === kelLower || dKel.replace(/\s+/g, '') === kelNorm;
        });

        if (matches.length === 1) {
          const match = matches[0];
          const coords = match.Koordinat.split(',');
          return {
            isPrecise: true,
            kelurahan: match.Kelurahan_Desa,
            kecamatan: match.Kecamatan,
            kota: match.Kabupaten_Kota,
            lat: parseFloat(coords[0].trim()),
            lng: parseFloat(coords[1].trim()),
            formattedAddress: `${match.Kelurahan_Desa}, ${match.Kecamatan}, ${match.Kabupaten_Kota}`,
            zipcode: match.Kode_Pos,
          };
        }

        // Ambiguitas: ada beberapa kelurahan dengan nama sama
        if (matches.length > 1 && kecamatan) {
          const kecLower = kecamatan.toLowerCase().trim();
          const kecNorm = kecLower.replace(/\s+/g, '');
          const exact = matches.find((m: any) => {
            const dKec = m.Kecamatan.toLowerCase().trim();
            return dKec === kecLower || dKec.replace(/\s+/g, '') === kecNorm;
          });
          if (exact) {
            const coords = exact.Koordinat.split(',');
            return {
              isPrecise: true,
              kelurahan: exact.Kelurahan_Desa,
              kecamatan: exact.Kecamatan,
              kota: exact.Kabupaten_Kota,
              lat: parseFloat(coords[0].trim()),
              lng: parseFloat(coords[1].trim()),
              formattedAddress: `${exact.Kelurahan_Desa}, ${exact.Kecamatan}, ${exact.Kabupaten_Kota}`,
              zipcode: exact.Kode_Pos,
            };
          }
        }
      }

      // Fallback: cari berdasarkan kecamatan saja
      if (kecamatan) {
        const kecLower = kecamatan.toLowerCase();
        const match = data.find((d: any) => d.Kecamatan.toLowerCase() === kecLower);
        if (match) {
          const coords = match.Koordinat.split(',');
          return {
            isPrecise: false,
            kecamatan: match.Kecamatan,
            kota: match.Kabupaten_Kota,
            lat: parseFloat(coords[0].trim()),
            lng: parseFloat(coords[1].trim()),
            formattedAddress: `${match.Kecamatan}, ${match.Kabupaten_Kota}`,
          };
        }
      }

      console.log(`[LLM GEOCODE] Cross-check: "${kelurahan}" not found in gazetteer`);
      return null;
    } catch (e) {
      console.error('[LLM GEOCODE CROSS-CHECK ERROR]', e);
      return null;
    }
  }
}

export const geocodingService = new GeocodingService();

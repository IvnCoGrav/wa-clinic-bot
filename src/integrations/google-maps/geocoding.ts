import { Client, AddressComponent } from '@googlemaps/google-maps-services-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getStringSimilarity } from '../../utils/similarity';
import { CircuitBreaker } from '../../utils/circuit-breaker';
dotenv.config();

const INDONESIAN_STOP_WORDS = new Set([
  'saya', 'kamu', 'dia', 'mereka', 'kita', 'kami', 'anda', 'bunda', 'bund', 'kak', 'kakak', 'min', 'admin', 'sis', 'gan', 'mbak', 'mas', 'ya', 'ampun', 'elah', 'yaelah', 'yaampun', 'kok', 'gitu', 'sih', 'dong', 'saja', 'aja', 'mahal', 'murah', 'ongkir', 'ongkirnya', 'tarif', 'tarifnya', 'biaya', 'biayanya', 'ongkos', 'ongkosnya', 'harga', 'harganya', 'berapa', 'berapaan', 'kena', 'hitung', 'itung', 'cek', 'info', 'tanya', 'lokasi', 'alamat', 'rumah', 'jalan', 'gang', 'no', 'nomor', 'rt', 'rw', 'kelurahan', 'kecamatan', 'kabupaten', 'kota', 'desa', 'dusun', 'provinsi', 'homecare', 'spa', 'treatment', 'massage', 'pijat', 'booking', 'reservasi', 'jadwal', 'hari', 'tanggal', 'bulan', 'tahun', 'jam', 'waktu', 'bisa', 'mau', 'ingin', 'akan', 'sudah', 'belum', 'tidak', 'bukan', 'ada', 'tidakada', 'gratis', 'free', 'promo', 'diskon', 'banget', 'sangat', 'sekali', 'itu', 'ini', 'yang', 'dari', 'ke', 'di', 'pada', 'untuk', 'dengan', 'atau', 'dan', 'adalah', 'seperti', 'kalau', 'kalo', 'jika', 'bila', 'karena', 'sebab', 'tetapi', 'tapi', 'namun', 'melayani', 'panggil', 'datang', 'selamat', 'pagi', 'siang', 'sore', 'malam', 'halo', 'hola', 'hei', 'helo', 'assalamualaikum', 'salam', 'permisi', 'terima', 'kasih', 'terimakasih', 'thank', 'you'
]);

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
  matchedSpan?: string;
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
    console.time('GEOCODING_TOTAL');
    try {
      if (!this.apiKey || this.apiKey.startsWith('mock')) {
        return this.mockGeocodeText(locationText);
      }
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
    } finally {
      console.timeEnd('GEOCODING_TOTAL');
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
          if (similarity >= kecamatanThreshold) {
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
        
        // --- PRIORITAS: N-GRAM GAZEETTEER MATCH ---
        const bestMatch = this.findBestGazetteerMatch(lower, data);
        if (bestMatch) {
          const { item, score, level, matchedSpan } = bestMatch;
          
          if (level === 'kecamatan') {
            const hasExplicitKelurahan = lower.includes('kelurahan') || lower.includes('desa') || lower.includes('kel') || lower.includes('ds');
            if (!hasExplicitKelurahan) {
              return {
                isPrecise: false,
                kota: matchedSpan,
                matchedSpan,
              };
            }
          } else {
            // Find all entries for this kelurahan (to handle ambiguity if there are duplicates)
            const matchedKelurahanLower = item.Kelurahan_Desa.toLowerCase();
            
            // Check if this kelurahan name is also a broad kecamatan name in Sidoarjo/Surabaya
            const kecNames = new Set(data.map((d: any) => d.Kecamatan.toLowerCase()));
            const hasExplicitKelurahan = lower.includes('kelurahan') || lower.includes('desa') || lower.includes('kel') || lower.includes('ds');
            if (kecNames.has(matchedKelurahanLower) && !hasExplicitKelurahan) {
              return {
                isPrecise: false,
                kota: matchedSpan,
                matchedSpan,
              };
            }

            const exactMatches = data.filter((d: any) => d.Kelurahan_Desa.toLowerCase() === matchedKelurahanLower);
            
            if (exactMatches.length > 0) {
              // Check if user input explicitly mentions one of the kecamatans to resolve ambiguity
              const matchesWithKec = exactMatches.filter(m => lower.includes(m.Kecamatan.toLowerCase()));
              
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

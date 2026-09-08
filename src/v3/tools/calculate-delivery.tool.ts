import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { clinicConfig } from '../../config/clinic';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { TEMPLATES } from '../../config/persona';

export interface CalculateDeliveryInput {
  locationText: string;
  streetDetail?: string;
  tenantId?: string;
  candidateTreatmentName?: string;
}

export interface CalculateDeliveryOutput {
  success: boolean;
  isPrecise: boolean;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  formattedAddress?: string;
  distanceKm?: number;
  ongkirNormal?: number;
  ongkirPromo?: number;
  isOutOfCoverage: boolean;
  suggestedTemplateReply?: string;
  message: string;
}

export const CALCULATE_DELIVERY_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'calculate_delivery',
    description: 'Wajib dipanggil setiap kali customer menyebutkan nama lokasi/rumah/daerah/kelurahan/desa/kecamatan/kota (termasuk Surabaya, Sidoarjo, Gresik, Menganti, atau daerah sekitar lainnya) untuk memverifikasi apakah jarak rute jalan masih dalam jangkauan homecare (<= 30 km) serta menghitung tarif ongkir resmi (normal & promo). DILARANG menanyakan jarak km kepada customer.',
    parameters: {
      type: 'object',
      properties: {
        locationText: {
          type: 'string',
          description: 'Nama kelurahan, desa, perumahan, patokan, kecamatan, kota, atau alamat lengkap customer (misal: "Pelemwatu Menganti Gresik", "Sedati Pepe", "Bulusidokare", "Perumahan Safira Juanda").'
        },
        streetDetail: {
          type: 'string',
          description: 'Detail nomor rumah atau RT/RW jika ada.'
        }
      },
      required: ['locationText']
    }
  }
};

const OUTSIDE_CITIES_RE = /\b(malang|jakarta|bandung|semarang|yogyakarta|jogja|bali|denpasar|kediri|blitar|madiun|probolinggo|pasuruan|jember|banyuwangi|bojonegoro|tuban|lamongan|ngawi|magetan|ponorogo|pacitan|trenggalek|tulungagung|lumajang|bondowoso|situbondo)\b/i;

const BROAD_REGION_RE = /^(?:rumah\s+d\s+|rumah\s+di\s+|di\s+|daerah\s+|wilayah\s+)?(?:surabaya\s+(?:barat|timur|selatan|utara|pusat)|surabaya|sidoarjo|gresik)$/i;

// ---------------------------------------------------------------------------
// Data-driven kecamatan matcher (toleran typo ringan, tanpa regex patchwork):
// mengenali nama kecamatan resmi dari database gazetteer di dalam query,
// termasuk varian salah ketik 1 huruf (misal "memganti" → "Menganti").
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';

let cachedKecamatanNames: Array<{ lower: string; orig: string }> | null = null;
function getKecamatanNames(): Array<{ lower: string; orig: string }> {
  if (cachedKecamatanNames) return cachedKecamatanNames;
  const seen = new Map<string, string>();
  try {
    const candidates = [
      path.join(process.cwd(), 'src', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.join(process.cwd(), 'dist', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../../config/surabaya_sidoarjo_subdistricts.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const data = JSON.parse(fs.readFileSync(c, 'utf-8'));
        for (const item of data) {
          const raw = String(item.Kecamatan || '').trim();
          const lower = raw.toLowerCase();
          if (lower.length >= 4 && !seen.has(lower)) seen.set(lower, raw);
        }
        break;
      }
    }
  } catch (_) {}
  cachedKecamatanNames = Array.from(seen.entries()).map(([lower, orig]) => ({ lower, orig }));
  return cachedKecamatanNames;
}

export function initKecamatanGazetteerSync(): void {
  if (cachedKecamatanNames) return;
  getKecamatanNames();
}
initKecamatanGazetteerSync();

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (la === lb) { i++; j++; } else if (la > lb) { i++; } else { j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Kembalikan nama kecamatan resmi yang disebut (atau typo 1-huruf) di query, atau null. */
const KECAMATAN_TOKEN_SKIPLIST = new Set(['kota', 'desa', 'jawa', 'timur', 'kecamatan', 'kabupaten', 'surabaya', 'sidoarjo', 'gresik', 'sby', 'sda']);
function findKecamatanInQuery(query: string): string | null {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !KECAMATAN_TOKEN_SKIPLIST.has(t));
  if (tokens.length === 0) return null;
  for (const { lower, orig } of getKecamatanNames()) {
    for (const t of tokens) {
      if (t === lower || t.includes(lower) || lower.includes(t)) return orig;
      if (lower.length >= 6 && levenshteinAtMostOne(t, lower)) return orig;
    }
  }
  return null;
}

export async function executeCalculateDelivery(input: CalculateDeliveryInput): Promise<CalculateDeliveryOutput> {
  const { locationText, streetDetail, tenantId = DEFAULT_TENANT_ID, candidateTreatmentName } = input;
  const compositeQuery = streetDetail ? `${locationText} ${streetDetail}` : locationText;

  // Fast check: Jika customer secara sadar menyebut kota di luar jangkauan (misal Malang, Jakarta)
  const isExplicitOutsideCity = OUTSIDE_CITIES_RE.test(locationText);
  
  if (!locationText || locationText.trim().length < 2) {
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: 'Lokasi terlalu singkat atau kosong. Mohon tanyakan nama daerah/kelurahan yang lebih jelas.'
    };
  }

  // 1. Cek Wilayah Terlalu Luas (Surabaya Barat, Surabaya Timur, Sidoarjo, dll.)
  if (BROAD_REGION_RE.test(compositeQuery.trim()) || BROAD_REGION_RE.test(locationText.trim())) {
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: `Area "${locationText}" masih terlalu luas untuk menghitung jarak dan tarif ongkir pasti. Mohon sampaikan dengan ramah bahwa area ${locationText} cukup luas, lalu tanyakan nama kelurahan, perumahan, atau patokan terdekatnya agar bisa kami bantu cekkan jarak pasti dan ketersediaan Bidan.`
    };
  }

  try {
    let resolved = await geocodingService.geocodeText(compositeQuery);
    
    if (!resolved.isPrecise && compositeQuery !== locationText) {
      const locResolved = await geocodingService.geocodeText(locationText);
      if (locResolved.isPrecise) {
        resolved = locResolved;
      }
    }

    const ambiguityList = (resolved as any).ambiguityResults;
    if (ambiguityList && ambiguityList.length > 1 && !streetDetail) {
      const kecName = ambiguityList[0]?.Kecamatan || locationText;
      const kotaName = ambiguityList[0]?.Kabupaten_Kota || resolved.kota || 'Surabaya/Sidoarjo';
      return {
        success: false,
        isPrecise: false,
        kecamatan: kecName,
        kota: kotaName,
        isOutOfCoverage: false,
        message: `Area "${compositeQuery}" adalah nama kecamatan (${kecName}) yang masih luas dan membawahi ${ambiguityList.length} kelurahan/desa. Karena beda kelurahan bisa berbeda jarak dan tarif ongkir, mohon sampaikan dengan ramah bahwa area kecamatan tersebut masih luas, lalu tanyakan nama kelurahan, desa, atau perumahan spesifiknya Bunda (atau tawarkan opsi kirim share location agar titiknya presisi). DILARANG mengeluarkan nominal jarak km atau tarif ongkir!`
      };
    }

    if (!resolved.lat || !resolved.lng) {
      if (isExplicitOutsideCity) {
        return {
          success: true,
          isPrecise: false,
          isOutOfCoverage: true,
          distanceKm: 99,
          message: `Lokasi "${compositeQuery}" berada di luar jangkauan area layanan klinik Kala Spa (maksimal 30 km dari Surabaya & Sidoarjo).`
        };
      }

      // Query tanpa koordinat tapi memuat nama kecamatan (termasuk typo ringan) —
      // tetap intersepsi sebagai kecamatan luas, bukan generic "tidak ditemukan".
      const kecNoCoords = findKecamatanInQuery(compositeQuery);
      if (kecNoCoords) {
        return {
          success: false,
          isPrecise: false,
          kecamatan: kecNoCoords,
          kota: resolved.kota,
          isOutOfCoverage: false,
          message: `Area "${kecNoCoords}" adalah nama kecamatan yang masih cukup luas dan membawahi banyak kelurahan/desa. Mohon sampaikan dengan ramah bahwa area kecamatan tersebut masih luas, lalu tanyakan nama kelurahan, desa, atau perumahan spesifiknya Bunda (atau share location). DILARANG mengeluarkan nominal jarak km atau tarif ongkir!`
        };
      }

      return {
        success: false,
        isPrecise: false,
        isOutOfCoverage: false,
        message: `Lokasi "${compositeQuery}" belum dapat ditemukan secara presisi. Mohon sampaikan dengan ramah dan tanyakan nama kelurahan, perumahan, atau patokan terdekatnya (atau tawarkan kirim share location). DILARANG mengeluarkan nominal km atau tarif ongkir!`
      };
    }

    // Intersepsi KECAMATAN LUAS: hasil hanya setingkat kecamatan (tanpa kelurahan/desa),
    // baik via ambiguity gazetteer maupun komponen Google administrative_area_level_3 —
    // WAJIB minta kelurahan/desa, DILARANG mengeluarkan nominal jarak/ongkir.
    const kecAmbiguity = (resolved as any).ambiguityResults;
    const kecLevelName = (!resolved.kelurahan && resolved.kecamatan)
      ? resolved.kecamatan
      : (Array.isArray(kecAmbiguity) && kecAmbiguity.length > 0
        ? (kecAmbiguity[0]?.Kecamatan || (resolved as any).matchedSpan || null)
        : findKecamatanInQuery(compositeQuery));
    if (!resolved.isPrecise && !resolved.kelurahan && !streetDetail && kecLevelName) {
      return {
        success: false,
        isPrecise: false,
        kecamatan: typeof kecLevelName === 'string' ? kecLevelName : undefined,
        kota: resolved.kota,
        isOutOfCoverage: false,
        message: `Area "${kecLevelName}" adalah nama kecamatan yang masih cukup luas dan membawahi banyak kelurahan/desa. Mohon sampaikan dengan ramah bahwa area kecamatan tersebut masih luas, lalu tanyakan nama kelurahan, desa, atau perumahan spesifiknya Bunda (atau share location). DILARANG mengeluarkan nominal jarak km atau tarif ongkir!`
      };
    }

    if (!resolved.isPrecise && !resolved.kelurahan && !streetDetail) {
      return {
        success: false,
        isPrecise: false,
        isOutOfCoverage: false,
        message: `Lokasi "${compositeQuery}" masih terlalu umum (belum ada nama kelurahan/perumahan spesifik). Mohon tanyakan nama kelurahan atau perumahan terdekatnya (atau share location). DILARANG mengeluarkan nominal km atau tarif ongkir!`
      };
    }

    const deliveryResult = await deliveryService.calculateDelivery(
      { lat: resolved.lat, lng: resolved.lng },
      { lat: clinicConfig.lat, lng: clinicConfig.lng },
      tenantId
    );

    const distanceKm = deliveryResult.distanceKm;
    const ongkirNormal = deliveryResult.normalPrice;
    const ongkirPromo = deliveryResult.ongkir;
    const isOutOfCoverage = deliveryResult.isOutOfCoverage || distanceKm > 30 || isExplicitOutsideCity;

    const suggestedTemplateReply = isOutOfCoverage
      ? TEMPLATES.outOfCoverage({ distanceKm, maxCoverageKm: 30 })
      : TEMPLATES.ongkirInfo({
          distanceKm,
          normalPrice: ongkirNormal,
          promoPrice: ongkirPromo,
          freeTierKm: 5,
          candidateTreatmentName,
        });

    return {
      success: true,
      isPrecise: resolved.isPrecise || Boolean(resolved.kelurahan),
      kelurahan: resolved.kelurahan,
      kecamatan: resolved.kecamatan,
      kota: resolved.kota,
      formattedAddress: resolved.formattedAddress,
      distanceKm,
      ongkirNormal,
      ongkirPromo,
      isOutOfCoverage,
      suggestedTemplateReply,
      message: isOutOfCoverage
        ? `Jarak ${distanceKm} km melebihi batas jangkauan layanan klinik (maks 30 km). Template penolakan resmi:\n"${suggestedTemplateReply}"`
        : `Jarak ${distanceKm} km (${resolved.kelurahan || '-'}, ${resolved.kecamatan || '-'}). Ongkir normal Rp ${ongkirNormal.toLocaleString('id-ID')}, promo Rp ${ongkirPromo.toLocaleString('id-ID')}.${candidateTreatmentName ? `\nTreatment yang sedang dibahas: ${candidateTreatmentName}. Hitungkan total biaya (treatment + ongkir promo) dan tanyakan hari kunjungan.` : ''}\n\nFormat penyampaian yang disarankan:\n"${suggestedTemplateReply}"`
    };
  } catch (error: any) {
    console.error(JSON.stringify({ event: 'V3_TOOL_DELIVERY_ERROR', tenantId, error: error.message, timestamp: new Date().toISOString() }));
    return {
      success: false,
      isPrecise: false,
      isOutOfCoverage: false,
      message: `Gagal menghitung ongkir: ${error.message}`
    };
  }
}

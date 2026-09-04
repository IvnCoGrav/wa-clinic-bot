/**
 * Admin Chat Distance & Ongkir Parser
 *
 * Utilitas deterministik untuk mengekstrak informasi jarak (km) dan tarif ongkir
 * dari pesan keluar (outbound chat) yang dikirim oleh Admin CS kepada customer.
 * 0 Token / 0 Biaya LLM.
 */
import { getGazetteerAreas, escapeRegex } from './gazetteer';

export interface ParsedAdminDistanceInfo {
  distanceKm: number | null;
  ongkir: number | null;
  normalOngkir: number | null;
  promoOngkir: number | null;
  isConfident: boolean;
  rawMatchedSnippet?: string;
}

/**
 * Normalisasi angka string Indonesia seperti "20.000", "20rb", "25 ribu", "20k" menjadi number
 */
export function parseIndonesianCurrencyText(raw: string): number | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();

  // Pola "20rb", "20 rb", "20k", "20 ribu"
  const kMatch = clean.match(/^(\d+(?:[.,]\d+)?)\s*(?:rb|k|ribu)$/i);
  if (kMatch) {
    const num = parseFloat(kMatch[1].replace(',', '.'));
    return Math.round(num * 1000);
  }

  // Pola standard Rp 20.000 / 20.000 / 20000
  const digitsOnly = clean.replace(/[^\d]/g, '');
  if (!digitsOnly) return null;

  const num = parseInt(digitsOnly, 10);
  if (isNaN(num) || num <= 0) return null;

  // Filter sanity check untuk ongkir (rentang Rp 1.000 s/d Rp 200.000)
  if (num >= 1000 && num <= 250000) {
    return num;
  }
  return null;
}

/**
 * Parsing teks chat Admin CS untuk mendeteksi jarak (km) dan tarif ongkir.
 */
export function parseAdminChatDistanceAndOngkir(text: string): ParsedAdminDistanceInfo {
  if (!text || typeof text !== 'string') {
    return { distanceKm: null, ongkir: null, normalOngkir: null, promoOngkir: null, isConfident: false };
  }

  const cleanText = text.trim();
  let distanceKm: number | null = null;
  let ongkir: number | null = null;
  let normalOngkir: number | null = null;
  let promoOngkir: number | null = null;
  let isConfident = false;
  let matchedSnippet = '';

  // 1. Ekstraksi Jarak (km)
  // Pola variasi:
  // - "jaraknya kurang lebih 16km"
  // - "jarak sekitar 8.5 km"
  // - "jarak ke lokasi 12,3 km"
  // - "estimasi jarak 10 km"
  // - "jarak 16 km" / "jaraknya 16km"
  // - "10-20km" (tier mention)
  const distancePatterns = [
    /(?:jarak(?:nya)?\s*(?:ke\s*lokasi\s*(?:bunda)?)?\s*(?:kurang\s*lebih|sekitar|adalah|estimasi)?\s*(\d+(?:[.,]\d+)?)\s*km)/i,
    /(?:(?:kurang\s*lebih|sekitar|estimasi)\s*(\d+(?:[.,]\d+)?)\s*km)/i,
    /(?:(\d+(?:[.,]\d+)?)\s*km\s*(?:dari\s*klinik|ke\s*lokasi|jaraknya))/i,
    /(?:lokasi\s*(?:bunda|rumah)?\s*(?:kurang\s*lebih|sekitar|adalah)?\s*(\d+(?:[.,]\d+)?)\s*km)/i,
  ];

  for (const regex of distancePatterns) {
    const match = cleanText.match(regex);
    if (match && match[1]) {
      const rawVal = match[1].replace(',', '.');
      const val = parseFloat(rawVal);
      // Validasi sanity check jarak (0.1 km s/d 100 km)
      if (Number.isFinite(val) && val > 0 && val <= 100) {
        distanceKm = val;
        isConfident = true;
        matchedSnippet = match[0];
        break;
      }
    }
  }

  // 2. Ekstraksi Ongkir Normal & Promo
  let explicitPromoVal: number | null = null;
  let explicitNormalVal: number | null = null;

  // Pola Promo Spesifik: "ongkir menjadi 20.000", "kasih bunda ongkir menjadi 20.000", "promo ongkir 20.000"
  const promoPatterns = [
    /(?:(?:kasih|bisa\s*kasih|dapat)\s*(?:bunda\s*)?ongkir\s*(?:menjadi\s*)?(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:\s*(?:rb|k|ribu))?))/i,
    /(?:ongkir\s*menjadi\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:\s*(?:rb|k|ribu))?))/i,
    /(?:promo\s*ongkir\s*(?:menjadi|-)?\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:\s*(?:rb|k|ribu))?))/i,
    /(?:ongkir\s*(?:promo|spesial)\s*(?:sebesar|menjadi)?\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:\s*(?:rb|k|ribu))?))/i,
  ];

  for (const regex of promoPatterns) {
    const match = cleanText.match(regex);
    if (match && match[1]) {
      const parsed = parseIndonesianCurrencyText(match[1]);
      if (parsed) {
        explicitPromoVal = parsed;
        break;
      }
    }
  }

  // Pola Normal / Tambahan Ongkir: "tambahan ongkir 25.000", "ongkir normal 25.000", "ongkir 25.000 tetapi"
  const normalPatterns = [
    /(?:(?:tambahan|normal|tarif|biaya)\s*ongkir\s*(?:sebesar)?\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:\s*(?:rb|k|ribu))?))/i,
    /(?:ongkir\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:\s*(?:rb|k|ribu))?)\s*(?:tetapi|tapi|namun|karna|karena))/i,
  ];

  for (const regex of normalPatterns) {
    const match = cleanText.match(regex);
    if (match && match[1]) {
      const parsed = parseIndonesianCurrencyText(match[1]);
      if (parsed) {
        explicitNormalVal = parsed;
        break;
      }
    }
  }

  // Pola Umum Ongkir jika belum ada yang tertangkap
  if (!explicitPromoVal && !explicitNormalVal) {
    const generalOngkirMatch = cleanText.match(/(?:ongkir(?:nya)?\s*(?:sebesar)?\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:\s*(?:rb|k|ribu))?))/i);
    if (generalOngkirMatch && generalOngkirMatch[1]) {
      const parsed = parseIndonesianCurrencyText(generalOngkirMatch[1]);
      if (parsed) {
        ongkir = parsed;
      }
    }
  } else {
    if (explicitPromoVal && explicitNormalVal) {
      normalOngkir = Math.max(explicitNormalVal, explicitPromoVal);
      ongkir = Math.min(explicitNormalVal, explicitPromoVal);
      promoOngkir = normalOngkir - ongkir;
    } else if (explicitPromoVal) {
      ongkir = explicitPromoVal;
    } else if (explicitNormalVal) {
      normalOngkir = explicitNormalVal;
      ongkir = explicitNormalVal;
    }
  }

  return {
    distanceKm,
    ongkir,
    normalOngkir,
    promoOngkir,
    isConfident: isConfident || (distanceKm !== null),
    rawMatchedSnippet: matchedSnippet || undefined,
  };
}

/**
 * Fragmen tanya — kandidat lokasi yang mengandung ini ditolak (bukan rekomendasi lokasi).
 */
const ADMIN_LOC_QUESTION_FRAG_RE = /[?]|(?:dimana|di\s*mana|dmana|mana|mna|tanya|berapa|kapan|gimana|bagaimana|apakah)\b/i;

/**
 * Ekstraksi nama lokasi yang disebutkan Admin CS dalam pesan outbound.
 * Dipakai background-enrichment sebagai Prioritas 1 (geocode langsung lokasi
 * rekomendasi Admin, tanpa menebak dari riwayat pesan lama).
 *
 * Contoh: "Lebih dekat yang Wiguna Selatan Bunda, Jika dilihat dari jaraknya
 * kurang lebih 6.8 km..." → "Wiguna Selatan".
 *
 * Mengembalikan null jika tidak ada lokasi spesifik yang terdeteksi.
 */
export function parseAdminChatLocation(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();
  if (clean.length < 10) return null;

  // Pola 1: rekomendasi eksplisit "lebih dekat yang <lokasi> <sapaan/konjungsi>..."
  const m1 = clean.match(
    /lebih\s+dekat\s+(?:yang|yg)\s+([A-Za-z0-9][A-Za-z0-9\s.'-]{1,40}?)\s+(?:bunda|bund|kak|kakak|bu|mba|mbak|mas|pak|ya|yha|jika|jikalau|kalau|kalo|karena|karna|jaraknya|dilihat|diliat|kurang|sekitar|sekitaran|sekitarnya)\b/i
  );
  if (m1 && m1[1]) {
    const loc = m1[1].trim().replace(/[.,;]+$/, '');
    if (loc.length >= 3 && !ADMIN_LOC_QUESTION_FRAG_RE.test(loc)) {
      return loc;
    }
  }

  // Pola 2: entitas wilayah gazetteer/landmark yang disebut Admin (cocok terpanjang dulu).
  // Lewati jika pesan Admin sendiri berupa pertanyaan (bukan rekomendasi lokasi).
  if (/\?/.test(clean) && /(?:dimana|di\s*mana|\bmana\b|\bmna\b|tanya)\b/i.test(clean)) return null;
  try {
    const gazetteer = getGazetteerAreas();
    const lower = clean.toLowerCase();
    const areas = Array.from(gazetteer.entries()).sort((a, b) => b[0].length - a[0].length);
    for (const [areaLower, areaOrig] of areas) {
      if (areaLower.length < 4) continue;
      if (new RegExp(`\\b${escapeRegex(areaLower)}\\b`).test(lower)) {
        return areaOrig;
      }
    }
  } catch (_) {}

  return null;
}

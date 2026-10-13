/**
 * Open Location Code (Plus Code) Decoder.
 * Implementasi resmi mandiri (zero external dependencies) berbasis spesifikasi
 * Google Open Location Code (Apache 2.0).
 *
 * Mampu mendekode kode penuh (misal: 6P4JJP96+9WG) maupun short code
 * (misal: JP96+9WG) menggunakan titik acuan terdekat (klinik / Surabaya-Sidoarjo).
 */

const CODE_ALPHABET = '23456789CFGHJMPQRVWX';
const ENCODING_BASE = 20;
const GRID_ROWS = 4;
const GRID_COLS = 5;

// Regex untuk mendeteksi token Plus Code (full 8+ atau short 4-6 karakter sebelum '+')
export const PLUS_CODE_REGEX = /\b([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})\b/i;

export interface DecodedPlusCode {
  lat: number;
  lng: number;
  code: string;
  fullCode: string;
  isShort: boolean;
}

/**
 * Ekstrak token Plus Code pertama yang ditemukan dalam string teks/URL.
 */
export function extractPlusCode(text?: string | null): string | null {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(PLUS_CODE_REGEX);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Dekode kode Plus Code penuh (minimal 10 karakter non-plus, misal '6P4JJP96+9WG')
 * menjadi koordinat latitude & longitude presisi.
 */
export function decodeFullPlusCode(code: string): { lat: number; lng: number } | null {
  const clean = code.toUpperCase().replace('+', '').trim();
  if (clean.length < 10) return null;

  for (let i = 0; i < clean.length; i++) {
    if (!CODE_ALPHABET.includes(clean[i])) return null;
  }

  let latVal = 0;
  let lngVal = 0;
  let latRes = 20.0;
  let lngRes = 20.0;

  for (let i = 0; i < 10; i += 2) {
    latRes /= ENCODING_BASE;
    lngRes /= ENCODING_BASE;
    const latDigit = CODE_ALPHABET.indexOf(clean[i]);
    const lngDigit = CODE_ALPHABET.indexOf(clean[i + 1]);
    latVal += latDigit * latRes * ENCODING_BASE;
    lngVal += lngDigit * lngRes * ENCODING_BASE;
  }

  // Karakter ke-11 opsional (grid 4x5)
  if (clean.length > 10) {
    const gridDigit = CODE_ALPHABET.indexOf(clean[10]);
    const row = Math.floor(gridDigit / GRID_COLS);
    const col = gridDigit % GRID_COLS;
    latRes /= GRID_ROWS;
    lngRes /= GRID_COLS;
    latVal += row * latRes * GRID_ROWS;
    lngVal += col * lngRes * GRID_COLS;
  }

  const lat = latVal + latRes / 2.0 - 90.0;
  const lng = lngVal + lngRes / 2.0 - 180.0;

  return {
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
  };
}

/**
 * Dekode Plus Code (baik Full Code maupun Short Code).
 * Jika berupa Short Code (seperti 'JP96+9WG'), menggunakan referencePoint
 * (default klinik Kala Moms: [-7.34886, 112.751677]) untuk merekonstruksi 4-karakter
 * prefiks terdekat secara deterministik dalam O(1).
 */
export function decodePlusCode(
  rawInput: string,
  referencePoint: { lat: number; lng: number } = { lat: -7.34886, lng: 112.751677 }
): DecodedPlusCode | null {
  const token = extractPlusCode(rawInput);
  if (!token) return null;

  const plusIdx = token.indexOf('+');
  if (plusIdx === -1) return null;

  // Kode penuh: 8 karakter sebelum '+'
  if (plusIdx >= 8) {
    const decoded = decodeFullPlusCode(token);
    if (!decoded) return null;
    return {
      lat: decoded.lat,
      lng: decoded.lng,
      code: token,
      fullCode: token,
      isShort: false,
    };
  }

  // Short Code: 4 karakter sebelum '+' (seperti JP96+9WG)
  if (plusIdx === 4) {
    const cleanShort = token.replace('+', '');
    const normLat = referencePoint.lat + 90.0;
    const normLng = referencePoint.lng + 180.0;

    const i1 = Math.floor(normLat / 20.0);
    const i2 = Math.floor(normLng / 20.0);
    if (i1 < 0 || i1 >= 20 || i2 < 0 || i2 >= 20) return null;

    const c1 = CODE_ALPHABET[i1];
    const c2 = CODE_ALPHABET[i2];

    const remLat = normLat % 20.0;
    const remLng = normLng % 20.0;
    const i3Center = Math.floor(remLat / 1.0);
    const i4Center = Math.floor(remLng / 1.0);

    let bestDistSq = Infinity;
    let bestDecoded: { lat: number; lng: number } | null = null;
    let bestFullCode = '';

    // Uji blok tengah dan tetangga 3x3 (+/- 1 derajat) untuk toleransi perbatasan wilayah
    for (const dLat of [-1, 0, 1]) {
      for (const dLng of [-1, 0, 1]) {
        const i3 = i3Center + dLat;
        const i4 = i4Center + dLng;
        if (i3 >= 0 && i3 < 20 && i4 >= 0 && i4 < 20) {
          const c3 = CODE_ALPHABET[i3];
          const c4 = CODE_ALPHABET[i4];
          const candidateFull = `${c1}${c2}${c3}${c4}${cleanShort}`;
          const decoded = decodeFullPlusCode(candidateFull);
          if (decoded) {
            const dL = decoded.lat - referencePoint.lat;
            const dG = decoded.lng - referencePoint.lng;
            const distSq = dL * dL + dG * dG;
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestDecoded = decoded;
              bestFullCode = `${c1}${c2}${c3}${c4}+${token.substring(plusIdx)}`;
            }
          }
        }
      }
    }

    if (bestDecoded) {
      return {
        lat: bestDecoded.lat,
        lng: bestDecoded.lng,
        code: token,
        fullCode: bestFullCode,
        isShort: true,
      };
    }
  }

  return null;
}

import axios from 'axios';

export interface ResolvedCoordinates {
  success: boolean;
  lat?: number;
  lng?: number;
  rawUrl?: string;
  resolvedUrl?: string;
  /**
   * Phase 0 (audit 315036): fallback teks alamat dari parameter query tempat
   * (mis. `?q=Waterplace Residence Tower A...`) bila koordinat tak ditemukan
   * di URL maupun body HTML. Diisi hanya bila berupa teks alamat (bukan angka
   * koordinat) — dipakai transparan oleh geocoding teks biasa.
   */
  addressQuery?: string;
  error?: string;
}

const GOOGLE_MAPS_URL_REGEX = /https?:\/\/(?:(?:maps\.app\.goo\.gl|goo\.gl\/maps|share\.google|www\.google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\/[^\s)>]+)/gi;

/**
 * Mencari semua link Google Maps yang ada di dalam teks (chat/alamat/form).
 */
export function extractGoogleMapsUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(GOOGLE_MAPS_URL_REGEX);
  if (!matches) return [];
  // Bersihkan karakter trailing seperti tanda kurung atau titik
  return matches.map((url) => url.replace(/[),.;]+$/, ''));
}

/**
 * Parse string menjadi URL (atau null bila bukan URL — mis. body HTML).
 * Tanpa skema hanya diterima bila berbentuk host-like (`host.tld/...`);
 * teks bebas TIDAK boleh lolos via resolusi base relatif.
 */
export function parseMapsUrl(urlString: string): URL | null {
  const s = (urlString || '').trim();
  if (!s) return null;
  try {
    return new URL(s);
  } catch (_) {
    // Fallback skema HANYA untuk input host-like (paritas perilaku lama
    // yang mencocokkan ?q= di URL tanpa skema; body HTML tetap ditolak).
    if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s)) {
      try {
        return new URL(`https://${s}`);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

/**
 * Parse pasangan "lat,lng" (ekstraksi numerik teknis) → null bila tak valid.
 * Mensyaratkan titik desimal per komponen (paritas regex lama `\d+\.\d+`)
 * agar "1,2" / sisa markup HTML tak pernah menjadi koordinat palsu.
 */
export function parseLatLngPair(value: string): { lat: number; lng: number } | null {
  const parts = (value || '').split(',');
  if (parts.length < 2) return null;
  const numRe = /^-?\d+\.\d+$/;
  const latS = parts[0].trim();
  const lngS = parts[1].trim();
  if (!numRe.test(latS) || !numRe.test(lngS)) return null;
  const lat = parseFloat(latS);
  const lng = parseFloat(lngS);
  if (isValidCoordinate(lat, lng)) return { lat, lng };
  return null;
}

/**
 * Mengekstrak koordinat lat & lng dari string URL Google Maps.
 * Mendukung format:
 * - query ?q= / ?ll= / ?daddr= (via URL API; fallback regex untuk body HTML)
 * - /@lat,lng, /place/lat,lng, /search/lat,lng, /dir//lat,lng
 * - protobuf !3d/!4d (polos maupun ter-encode %213d/%214d)
 */
export function extractCoordinatesFromUrlString(urlString: string): { lat: number; lng: number } | null {
  if (!urlString) return null;

  // Cabang 0: parameter query via URL API (deterministik untuk encoding
  // khusus, parameter ganda, dan anchor # — searchParams mengabaikan fragment).
  const parsed = parseMapsUrl(urlString);
  if (parsed) {
    for (const key of ['q', 'll', 'daddr', 'saddr', 'destination']) {
      const val = parsed.searchParams.get(key);
      if (!val) continue;
      const coords = parseLatLngPair(val);
      if (coords) return coords;
    }
  }

  // Pola 1: /@lat,lng (format standar Google Maps Web/Mobile)
  const atMatch = urlString.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 2 (fallback): ?q=lat,lng mentah di body HTML tak-terparse.
  // URL terparse sudah ditangani Cabang 0 via URL API di atas.
  const qMatch = urlString.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 3 (fallback): ?ll=/&ll= mentah di body HTML tak-terparse.
  const llMatch = urlString.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (llMatch) {
    const lat = parseFloat(llMatch[1]);
    const lng = parseFloat(llMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 4: /place/lat,lng atau /search/lat,lng
  const placeMatch = urlString.match(/\/(?:place|search|dir\/)\/(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (placeMatch) {
    const lat = parseFloat(placeMatch[1]);
    const lng = parseFloat(placeMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 5: !3d(lat)!4d(lng) (format protobuffer embed Google Maps)
  const pbMatch = urlString.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (pbMatch) {
    const lat = parseFloat(pbMatch[1]);
    const lng = parseFloat(pbMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 5b: protobuf ter-encode URL (%213d / %214d) dari body/redirect HTML.
  const pbEncMatch = urlString.match(/(?:!3d|%213d)(-?\d+\.\d+)(?:!4d|%214d)(-?\d+\.\d+)/i);
  if (pbEncMatch) {
    const lat = parseFloat(pbEncMatch[1]);
    const lng = parseFloat(pbEncMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 6 (fallback, audit 315036): directions ?daddr=lat,lng mentah di body
  // HTML tak-terparse (juga saddr= / destination=). URL terparse via Cabang 0.
  const daddrMatch = urlString.match(/[?&](?:daddr|saddr|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (daddrMatch) {
    const lat = parseFloat(daddrMatch[1]);
    const lng = parseFloat(daddrMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  return null;
}

/**
 * Phase 0 (audit 315036): ekstrak teks alamat tempat dari parameter query
 * URL (mis. `?q=Waterplace+Residence+Tower+A+...`). Kembalikan null bila
 * nilai q berupa koordinat angka (itu ranah pola koordinat di atas) atau
 * kosong — ekstraksi query teknis murni, bukan klasifikasi semantik.
 */
export function extractAddressQueryFromUrlString(urlString: string): string | null {
  if (!urlString) return null;
  // Primer: parameter `q` via URL API (decode + abaikan fragment otomatis).
  const parsed = parseMapsUrl(urlString);
  if (parsed) {
    const q = parsed.searchParams.get('q');
    const cleaned = cleanAddressQuery(q);
    if (cleaned) return cleaned;
  }
  // Fallback: pola `q=` mentah di body HTML tak-terparse.
  const qMatch = urlString.match(/[?&]q=([^&#]*)/i);
  if (!qMatch || !qMatch[1]) return null;
  let decoded = '';
  try {
    decoded = decodeURIComponent(qMatch[1].replace(/\+/g, ' ')).trim();
  } catch (_) {
    return null;
  }
  return cleanAddressQuery(decoded);
}

/** Normalisasi kandidat teks alamat: tolak kosong/koordinat/sangat pendek. */
function cleanAddressQuery(raw: string | null): string | null {
  const decoded = (raw || '').trim();
  if (!decoded) return null;
  // Nilai q berupa koordinat angka → bukan alamat (sudah ditangani pola koordinat).
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(decoded)) return null;
  if (decoded.length < 4) return null;
  return decoded;
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0);
}

/**
 * Merefleksikan shortlink Google Maps (maps.app.goo.gl / goo.gl/maps /
 * share.google) ke URL tujuan dan mengambil koordinat latitude & longitude
 * presisinya. Redirect HTTP di-follow generik (max 5) sehingga domain pendek
 * baru tetap ter-resolve tanpa perubahan kode tambahan.
 */
export async function resolveGoogleMapsUrl(url: string, timeoutMs = 2500): Promise<ResolvedCoordinates> {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Empty URL' };
  }

  const cleanUrl = url.trim().replace(/[),.;]+$/, '');

  // Coba ekstrak langsung jika URL sudah mengandung koordinat
  const directCoords = extractCoordinatesFromUrlString(cleanUrl);
  if (directCoords) {
    return {
      success: true,
      lat: directCoords.lat,
      lng: directCoords.lng,
      rawUrl: cleanUrl,
      resolvedUrl: cleanUrl,
    };
  }

  // Jika berupa shortlink, ikuti redirect HTTP
  try {
    const response = await axios.get(cleanUrl, {
      maxRedirects: 5,
      timeout: timeoutMs,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const finalUrl = (response.request as any)?.res?.responseUrl || response.config.url || cleanUrl;
    let coords = extractCoordinatesFromUrlString(finalUrl);

    // Jika di final URL tidak ada, periksa body html untuk meta tag atau link canonical
    if (!coords && typeof response.data === 'string') {
      coords = extractCoordinatesFromUrlString(response.data);
    }

    if (coords) {
      return {
        success: true,
        lat: coords.lat,
        lng: coords.lng,
        rawUrl: cleanUrl,
        resolvedUrl: finalUrl,
      };
    }

    // Fallback alamat: pin tempat tanpa koordinat (mis. place link
    // ?q=Nama+Tempat) → kembalikan teks alamat untuk geocoding teks biasa.
    const addressQuery = extractAddressQueryFromUrlString(finalUrl)
      || (typeof response.data === 'string' ? extractAddressQueryFromUrlString(response.data) : null);
    if (addressQuery) {
      return {
        success: false,
        rawUrl: cleanUrl,
        resolvedUrl: finalUrl,
        addressQuery,
      };
    }

    return {
      success: false,
      rawUrl: cleanUrl,
      resolvedUrl: finalUrl,
      error: 'Coordinates not found in resolved URL',
    };
  } catch (err: any) {
    return {
      success: false,
      rawUrl: cleanUrl,
      error: err?.message || 'Failed to resolve Google Maps shortlink',
    };
  }
}

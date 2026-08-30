import axios from 'axios';

export interface ResolvedCoordinates {
  success: boolean;
  lat?: number;
  lng?: number;
  rawUrl?: string;
  resolvedUrl?: string;
  error?: string;
}

const GOOGLE_MAPS_URL_REGEX = /https?:\/\/(?:(?:maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\/[^\s)>]+)/gi;

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
 * Mengekstrak koordinat lat & lng dari string URL Google Maps.
 * Mendukung format:
 * - /@(-?\d+\.\d+),(-?\d+\.\d+)
 * - ?q=(-?\d+\.\d+),(-?\d+\.\d+)
 * - &ll=(-?\d+\.\d+),(-?\d+\.\d+)
 * - /place/(-?\d+\.\d+),(-?\d+\.\d+)
 * - /dir//(-?\d+\.\d+),(-?\d+\.\d+)
 * - /search/(-?\d+\.\d+),(-?\d+\.\d+)
 */
export function extractCoordinatesFromUrlString(urlString: string): { lat: number; lng: number } | null {
  if (!urlString) return null;

  // Pola 1: /@lat,lng (format standar Google Maps Web/Mobile)
  const atMatch = urlString.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 2: ?q=lat,lng atau &q=lat,lng
  const qMatch = urlString.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (isValidCoordinate(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pola 3: &ll=lat,lng atau ?ll=lat,lng
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

  return null;
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0);
}

/**
 * Merefleksikan shortlink Google Maps (maps.app.goo.gl / goo.gl/maps) ke URL tujuan
 * dan mengambil koordinat latitude & longitude presisinya.
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

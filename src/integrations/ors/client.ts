import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
}

export interface IOrsClient {
  calculateRoute(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number
  ): Promise<RouteResult | null>;
}

/**
 * Client Service untuk OpenRouteService (ORS) Directions API.
 * Dokumentasi ORS: https://openrouteservice.org/dev/#/api-docs/v2/directions/{profile}/post
 */
export class OrsClient implements IOrsClient {
  private baseUrl: string;
  private profile: string;
  private apiKey: string;
  private avoidFeatures: string[];

  constructor() {
    let rawBaseUrl = process.env.ORS_BASE_URL || 'https://api.heigit.org/openrouteservice';
    if (rawBaseUrl.includes('api.openrouteservice.org')) {
      rawBaseUrl = rawBaseUrl.replace('api.openrouteservice.org', 'api.heigit.org/openrouteservice');
    }
    this.baseUrl = rawBaseUrl.replace(/\/$/, '');
    this.profile = process.env.ORS_PROFILE || 'driving-car';
    this.apiKey = process.env.ORS_API_KEY || '';

    // Hindari jalan tol (tollways) khusus operasional rute non-tol / motor
    const rawAvoid = process.env.ORS_AVOID_FEATURES;
    if (rawAvoid !== undefined) {
      this.avoidFeatures = rawAvoid ? rawAvoid.split(',').map((s) => s.trim()).filter(Boolean) : [];
    } else {
      this.avoidFeatures = this.profile.startsWith('driving') ? ['tollways'] : [];
    }
  }

  private get timeoutMs(): number {
    return parseInt(process.env.ORS_HTTP_TIMEOUT_MS || '2500', 10);
  }

  /**
   * Menghitung rute perjalanan dari lokasi asal ke tujuan menggunakan ORS Directions API.
   * 
   * PENTING: Format koordinat di ORS API menggunakan urutan [longitude, latitude],
   * bukan [latitude, longitude].
   */
  public async calculateRoute(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number
  ): Promise<RouteResult | null> {
    if (
      !this.apiKey ||
      this.apiKey.startsWith('mock') ||
      this.apiKey === '<ISI_MANUAL_DI_ENV_JANGAN_HARDCODE>'
    ) {
      console.log('[ORS MOCK/SKIP] No valid ORS_API_KEY provided. Triggering fallback.');
      return null;
    }

    try {
      const url = `${this.baseUrl}/v2/directions/${this.profile}`;

      // CRITICAL: Format [longitude, latitude] sesuai spesifikasi ORS
      const payload: Record<string, any> = {
        coordinates: [
          [fromLng, fromLat],
          [toLng, toLat],
        ],
      };

      if (this.avoidFeatures.length > 0) {
        payload.options = {
          avoid_features: this.avoidFeatures,
        };
      }

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        timeout: this.timeoutMs,
      });

      const summary =
        response.data?.routes?.[0]?.summary ||
        response.data?.features?.[0]?.properties?.summary;
      if (!summary || typeof summary.distance !== 'number') {
        console.warn('[ORS API WARN] Invalid summary response from ORS API:', response.data);
        return null;
      }

      return {
        distanceMeters: summary.distance,
        durationSeconds: summary.duration || 0,
      };
    } catch (error: any) {
      console.warn('[ORS API ERROR] calculateRoute failed:', error?.response?.data || error.message);
      return null;
    }
  }
}

export const orsClient = new OrsClient();

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

  constructor() {
    this.baseUrl = (process.env.ORS_BASE_URL || 'https://api.openrouteservice.org').replace(/\/$/, '');
    this.profile = process.env.ORS_PROFILE || 'cycling-electric';
    this.apiKey = process.env.ORS_API_KEY || '';
  }

  private get timeoutMs(): number {
    return parseInt(process.env.ORS_HTTP_TIMEOUT_MS || '10000', 10);
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
      const payload = {
        coordinates: [
          [fromLng, fromLat],
          [toLng, toLat],
        ],
      };

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        timeout: this.timeoutMs,
      });

      const summary = response.data?.features?.[0]?.properties?.summary;
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

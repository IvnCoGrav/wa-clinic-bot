import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export interface DistanceResult {
  distanceMeters: number;
  durationSeconds: number;
}

export interface IGoogleDistanceClient {
  calculateDistance(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number
  ): Promise<DistanceResult | null>;
}

/**
 * Client Service untuk Google Maps Distance Matrix API.
 * Digunakan sebagai Fallback Tier-2 rute motor sebelum rumus matematis Haversine.
 * Menghindari jalan tol (`avoid=tolls`) khusus untuk operasional terapis bersepeda motor.
 */
export class GoogleDistanceMatrixClient implements IGoogleDistanceClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || '';
  }

  private get timeoutMs(): number {
    return parseInt(process.env.GOOGLE_MAPS_HTTP_TIMEOUT_MS || '2500', 10);
  }

  /**
   * Menghitung jarak dan durasi rute motor (menghindari tol) antara 2 titik koordinat.
   */
  public async calculateDistance(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number
  ): Promise<DistanceResult | null> {
    const key = this.apiKey || process.env.GOOGLE_MAPS_API_KEY || '';

    // Graceful degradation: lewati jika API key kosong atau mock
    if (!key || key.startsWith('mock') || key === '<ISI_MANUAL_DI_ENV_JANGAN_HARDCODE>') {
      return null;
    }

    try {
      // Endpoint Google Distance Matrix API (mode driving + avoid tolls untuk motor)
      const url = 'https://maps.googleapis.com/maps/api/distancematrix/json';
      const response = await axios.get(url, {
        params: {
          origins: `${fromLat},${fromLng}`,
          destinations: `${toLat},${toLng}`,
          mode: 'driving',
          avoid: 'tolls', // Khusus motor terapis: hindari jalan tol
          key,
        },
        timeout: this.timeoutMs,
      });

      const data = response.data;
      if (data?.status !== 'OK') {
        console.warn('[GOOGLE MAPS DISTANCE WARN] Non-OK status from Distance Matrix API:', data?.status, data?.error_message);
        return null;
      }

      const element = data?.rows?.[0]?.elements?.[0];
      if (!element || element.status !== 'OK') {
        console.warn('[GOOGLE MAPS DISTANCE WARN] Element route status not OK:', element?.status);
        return null;
      }

      const distanceMeters = element.distance?.value;
      const durationSeconds = element.duration?.value || 0;

      if (typeof distanceMeters !== 'number') {
        return null;
      }

      return {
        distanceMeters,
        durationSeconds,
      };
    } catch (error: any) {
      console.warn('[GOOGLE MAPS DISTANCE ERROR] calculateDistance failed:', error?.response?.data || error.message);
      return null;
    }
  }
}

export const defaultGoogleDistanceClient = new GoogleDistanceMatrixClient();

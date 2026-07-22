import { calculateHaversineDistance, Coordinates } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';
import { IOrsClient, orsClient as defaultOrsClient } from '../integrations/ors/client';

export interface DeliveryCalculationResult {
  distanceKm: number;
  ongkir: number;
  isOutOfCoverage: boolean;
  messageTemplate: string;
}

/**
 * Service untuk kalkulasi ongkos kirim (ongkir) dan status jangkauan lokasi customer.
 * 
 * SUMBER DISTANCE:
 * 1. Utama    : OpenRouteService (ORS) Directions API (profile: cycling-electric)
 * 2. Fallback  : Formula Haversine manual (jika ORS API error/timeout/unreachable)
 * 
 * ATURAN TARIF ONGKIR & THRESHOLD JARAK:
 * -----------------------------------------------------------------------
 * 1. Jarak 0.0 km s/d 5.0 km   : FREE / GRATIS (Rp 0)
 * 2. Jarak > 5.0 km s/d 6.0 km  : Rp 5.000
 * 3. Jarak > 6.0 km s/d 10.0 km : Rp 10.000
 * 4. Jarak > 10.0 km            : LUAR JANGKAUAN (isOutOfCoverage = true)
 */
export class DeliveryService {
  private orsClient: IOrsClient;

  constructor(orsClient?: IOrsClient) {
    this.orsClient = orsClient || defaultOrsClient;
  }

  /**
   * Menghitung ongkir berdasarkan jarak dari titik lokasi klinik ke koordinat customer.
   * Menggunakan ORS Directions API sebagai sumber utama, dengan fallback ke Haversine.
   * 
   * @param customerCoords Koordinat latitude & longitude customer
   * @param clinicCoords (Opsional) Koordinat klinik. Jika tidak diisi, menggunakan default clinicConfig.
   */
  public async calculateDelivery(
    customerCoords: Coordinates,
    clinicCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng }
  ): Promise<DeliveryCalculationResult> {
    let distanceKm: number;

    // 1. Coba hit OpenRouteService (ORS) Directions API
    const orsResult = await this.orsClient.calculateRoute(
      clinicCoords.lat,
      clinicCoords.lng,
      customerCoords.lat,
      customerCoords.lng
    );

    if (orsResult && typeof orsResult.distanceMeters === 'number') {
      // Konversi meter ke km (presisi 2 desimal)
      distanceKm = parseFloat((orsResult.distanceMeters / 1000).toFixed(2));
    } else {
      // 2. FALLBACK: Jika ORS API gagal/timeout/error/unreachable, gunakan formula Haversine
      console.warn(
        `[DELIVERY SERVICE FALLBACK] ORS Directions API route calculation failed/unavailable for coords (${customerCoords.lat}, ${customerCoords.lng}). Falling back to Haversine formula distance.`
      );
      distanceKm = calculateHaversineDistance(clinicCoords, customerCoords);
    }

    // 3. Evaluasi threshold jarak & tentukan tarif ongkir
    const { ongkir, isOutOfCoverage } = this.calculateOngkirByDistance(distanceKm);

    // 4. Construct message template
    let messageTemplate = '';
    if (distanceKm <= 5.0) {
      messageTemplate = `Kabar baik! Lokasi Anda berjarak ${distanceKm} km dari klinik kami (masih dalam jangkauan < 5 km), sehingga layanan kami GRATIS ongkir!`;
    } else if (distanceKm <= 6.0) {
      messageTemplate = `Lokasi Anda berjarak ${distanceKm} km dari klinik kami. Biaya ongkir untuk area ini adalah Rp5.000.`;
    } else if (distanceKm <= 10.0) {
      messageTemplate = `Lokasi Anda berjarak ${distanceKm} km dari klinik kami. Biaya ongkir untuk area ini adalah Rp10.000.`;
    } else {
      messageTemplate = `Mohon maaf, lokasi Anda berjarak ${distanceKm} km dari klinik kami. Saat ini area tersebut berada di luar jangkauan pengiriman/home-treatment kami (maksimal 10 km).`;
    }

    return {
      distanceKm,
      ongkir,
      isOutOfCoverage,
      messageTemplate,
    };
  }

  /**
   * Pembantu untuk menghitung tarif ongkir langsung dari nilai numerik distanceKm
   */
  public calculateOngkirByDistance(distanceKm: number): { ongkir: number; isOutOfCoverage: boolean } {
    if (distanceKm <= 5.0) {
      return { ongkir: 0, isOutOfCoverage: false };
    } else if (distanceKm <= 6.0) {
      return { ongkir: 5000, isOutOfCoverage: false };
    } else if (distanceKm <= 10.0) {
      return { ongkir: 10000, isOutOfCoverage: false };
    } else {
      return { ongkir: 0, isOutOfCoverage: true };
    }
  }
}

export const deliveryService = new DeliveryService();

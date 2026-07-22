import { calculateHaversineDistance, Coordinates } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';
import { IOrsClient, orsClient as defaultOrsClient } from '../integrations/ors/client';

export interface DeliveryCalculationResult {
  distanceKm: number;
  ongkir: number; // Map ke promoPrice untuk database/state-machine
  normalPrice: number;
  promoPrice: number;
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
 * ATURAN TARIF ONGKIR & THRESHOLD JARAK BARU (REVISI KEDUA):
 * -----------------------------------------------------------------------
 * 1. Jarak 0.0 km s/d 5.0 km     : FREE / GRATIS (Rp 0)
 * 2. Jarak > 5.0 km s/d 7.0 km    : Rp 15.000 (Promo: Potongan Rp 10.000 -> Net Rp 5.000)
 * 3. Jarak > 7.0 km s/d 10.0 km   : Rp 15.000 (Promo: Potongan Rp 5.000 -> Net Rp 10.000)
 * 4. Jarak > 10.0 km s/d 15.0 km  : Rp 15.000 (Promo: Potongan Rp 5.000 -> Net Rp 10.000)
 * 5. Jarak > 15.0 km s/d 20.0 km  : Rp 20.000 (Promo: Potongan Rp 5.000 -> Net Rp 15.000)
 * 6. Jarak > 20.0 km s/d 25.0 km  : Rp 25.000 (Promo: Potongan Rp 5.000 -> Net Rp 20.000)
 * 7. Jarak > 25.0 km s/d 30.0 km  : Rp 30.000 (Promo: Potongan Rp 5.000 -> Net Rp 25.000)
 * 8. Jarak > 30.0 km              : LUAR JANGKAUAN (isOutOfCoverage = true)
 */
export class DeliveryService {
  private orsClient: IOrsClient;

  constructor(orsClient?: IOrsClient) {
    this.orsClient = orsClient || defaultOrsClient;
  }

  /**
   * Menghitung ongkir berdasarkan jarak dari titik lokasi moms & baby spa ke koordinat customer.
   * Menggunakan ORS Directions API sebagai sumber utama, dengan fallback ke Haversine.
   * 
   * @param customerCoords Koordinat latitude & longitude customer
   * @param clinicCoords (Opsional) Koordinat moms & baby spa. Jika tidak diisi, menggunakan default clinicConfig.
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
    const { normalPrice, promoDiscount, isOutOfCoverage } = this.calculateOngkirByDistance(distanceKm);

    // Hitung promoPrice dengan diskon
    const promoPrice = Math.max(0, normalPrice - promoDiscount);

    // 4. Construct message template
    let messageTemplate = '';
    if (distanceKm <= 5.0) {
      messageTemplate = `Kabar baik! Lokasi Anda berjarak ${distanceKm} km dari moms & baby spa kami (masih dalam jangkauan < 5 km), sehingga layanan kami GRATIS ongkir!`;
    } else if (!isOutOfCoverage) {
      messageTemplate = `Lokasi Anda berjarak ${distanceKm} km dari moms & baby spa kami. Biaya ongkir normal untuk area ini adalah Rp${normalPrice.toLocaleString('id-ID')} (Promo: Rp${promoPrice.toLocaleString('id-ID')}).`;
    } else {
      messageTemplate = `Mohon maaf, lokasi Anda berjarak ${distanceKm} km dari moms & baby spa kami. Saat ini area tersebut berada di luar jangkauan pengiriman/home-treatment kami (maksimal 30 km).`;
    }

    return {
      distanceKm,
      ongkir: promoPrice, // Map ke promoPrice untuk database/state-machine
      normalPrice,
      promoPrice,
      isOutOfCoverage,
      messageTemplate,
    };
  }

  /**
   * Pembantu untuk menghitung tarif ongkir langsung dari nilai numerik distanceKm
   */
  public calculateOngkirByDistance(distanceKm: number): { normalPrice: number; promoDiscount: number; isOutOfCoverage: boolean } {
    if (distanceKm <= 5.0) {
      return { normalPrice: 0, promoDiscount: 0, isOutOfCoverage: false };
    } else if (distanceKm <= 7.0) {
      // 5-7 km: Rp 15.000, promo discount Rp 10.000 -> net Rp 5.000
      return { normalPrice: 15000, promoDiscount: 10000, isOutOfCoverage: false };
    } else if (distanceKm <= 10.0) {
      // 7-10 km: Rp 15.000, promo discount Rp 5.000 -> net Rp 10.000
      return { normalPrice: 15000, promoDiscount: 5000, isOutOfCoverage: false };
    } else if (distanceKm <= 15.0) {
      // 10-15 km: Rp 15.000, promo discount Rp 5.000 -> net Rp 10.000
      return { normalPrice: 15000, promoDiscount: 5000, isOutOfCoverage: false };
    } else if (distanceKm <= 20.0) {
      // 15-20 km: Rp 20.000, promo discount Rp 5.000 -> net Rp 15.000
      return { normalPrice: 20000, promoDiscount: 5000, isOutOfCoverage: false };
    } else if (distanceKm <= 25.0) {
      // 20-25 km: Rp 25.000, promo discount Rp 5.000 -> net Rp 20.000
      return { normalPrice: 25000, promoDiscount: 5000, isOutOfCoverage: false };
    } else if (distanceKm <= 30.0) {
      // 25-30 km: Rp 30.000, promo discount Rp 5.000 -> net Rp 25.000
      return { normalPrice: 30000, promoDiscount: 5000, isOutOfCoverage: false };
    } else {
      // > 30.0 km: di luar jangkauan
      return { normalPrice: 0, promoDiscount: 0, isOutOfCoverage: true };
    }
  }
}

export const deliveryService = new DeliveryService();

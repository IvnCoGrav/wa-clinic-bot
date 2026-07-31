import { calculateHaversineDistance, Coordinates } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';
import { IOrsClient, orsClient as defaultOrsClient } from '../integrations/ors/client';
import fs from 'fs';
import path from 'path';

export interface DeliveryTier {
  id: number;
  maxDist: number; // Jarak maksimum dalam km
  fee: number;     // Ongkir normal
  promoDiscount: number; // Potongan diskon promo
}

const TIERS_FILE = path.join(process.cwd(), 'delivery_tiers_custom.json');

const DEFAULT_TIERS: DeliveryTier[] = [
  { id: 1, maxDist: 5, fee: 0, promoDiscount: 0 },
  { id: 2, maxDist: 7, fee: 15000, promoDiscount: 10000 },
  { id: 3, maxDist: 10, fee: 15000, promoDiscount: 5000 },
  { id: 4, maxDist: 15, fee: 15000, promoDiscount: 5000 },
  { id: 5, maxDist: 20, fee: 20000, promoDiscount: 5000 },
  { id: 6, maxDist: 25, fee: 25000, promoDiscount: 5000 },
  { id: 7, maxDist: 30, fee: 30000, promoDiscount: 5000 }
];

export let activeDeliveryTiers: DeliveryTier[] = [];

export function loadDeliveryTiers() {
  try {
    if (fs.existsSync(TIERS_FILE)) {
      const data = fs.readFileSync(TIERS_FILE, 'utf-8');
      activeDeliveryTiers = JSON.parse(data);
    } else {
      fs.writeFileSync(TIERS_FILE, JSON.stringify(DEFAULT_TIERS, null, 2));
      activeDeliveryTiers = [...DEFAULT_TIERS];
    }
  } catch (err) {
    console.error('Failed to load active delivery tiers:', err);
    activeDeliveryTiers = [...DEFAULT_TIERS];
  }
}

export function saveDeliveryTiers(tiers: DeliveryTier[]) {
  try {
    fs.writeFileSync(TIERS_FILE, JSON.stringify(tiers, null, 2));
    activeDeliveryTiers = [...tiers];
    return true;
  } catch (err) {
    console.error('Failed to save delivery tiers:', err);
    return false;
  }
}

// Initial load
loadDeliveryTiers();


export interface DeliveryCalculationResult {
  distanceKm: number;
  ongkir: number; // Map ke promoPrice untuk database/state-machine
  normalPrice: number;
  promoPrice: number;
  isOutOfCoverage: boolean;
  isEstimated?: boolean;
  messageTemplate: string;
}

/**
 * Service untuk kalkulasi ongkos kirim (ongkir) dan status jangkauan lokasi customer.
 * 
 * SUMBER DISTANCE:
 * 1. Utama    : OpenRouteService (ORS) Directions API (profile: cycling-electric)
 * 2. Fallback  : Formula Haversine manual dengan Circuity Multiplier (1.25x untuk memperhitungkan kelengkungan jalan)
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
   * Menggunakan ORS Directions API sebagai sumber utama, dengan fallback ke Haversine + 1.25x circuity factor.
   * 
   * @param customerCoords Koordinat latitude & longitude customer
   * @param clinicCoords (Opsional) Koordinat moms & baby spa. Jika tidak diisi, menggunakan default clinicConfig.
   */
  public async calculateDelivery(
    customerCoords: Coordinates,
    clinicCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng }
  ): Promise<DeliveryCalculationResult> {
    let distanceKm: number;
    let isEstimated = false;

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
      isEstimated = false;
    } else {
      // 2. FALLBACK: Jika ORS API gagal/timeout/error/unreachable, gunakan formula Haversine + 1.25x Circuity Factor
      console.warn(
        `[DELIVERY SERVICE FALLBACK] ORS Directions API route calculation failed/unavailable for coords (${customerCoords.lat}, ${customerCoords.lng}). Falling back to Haversine distance with 1.25x circuity multiplier.`
      );
      const straightLineKm = calculateHaversineDistance(clinicCoords, customerCoords);
      // Circuity Factor 1.25x memperhitungkan kelengkungan rute jalan darat dibanding garis lurus
      distanceKm = parseFloat((straightLineKm * 1.25).toFixed(2));
      isEstimated = true;
    }

    // 3. Evaluasi threshold jarak & tentukan tarif ongkir
    const { normalPrice, promoDiscount, isOutOfCoverage } = this.calculateOngkirByDistance(distanceKm);

    // Hitung promoPrice dengan diskon
    const promoPrice = Math.max(0, normalPrice - promoDiscount);

    // 4. Construct message template
    let messageTemplate = '';
    if (distanceKm <= 5.0) {
      messageTemplate = `Wah, Deket Bunda, Lokasi Anda berjarak ${distanceKm.toFixed(1)} km dari moms & baby spa kami (masih dalam jangkauan < 5 km), sehingga layanan kami GRATIS ongkir!`;
    } else if (!isOutOfCoverage) {
      messageTemplate = `Lokasi Anda berjarak ${distanceKm.toFixed(1)} km dari moms & baby spa kami. Biaya ongkir normal untuk area ini adalah Rp${normalPrice.toLocaleString('id-ID')} (Promo: Rp${promoPrice.toLocaleString('id-ID')}).`;
    } else {
      messageTemplate = `Mohon maaf, lokasi Anda berjarak ${distanceKm.toFixed(1)} km dari moms & baby spa kami. Saat ini area tersebut berada di luar jangkauan pengiriman/home-treatment kami (maksimal 30 km).`;
    }

    return {
      distanceKm,
      ongkir: promoPrice, // Map ke promoPrice untuk database/state-machine
      normalPrice,
      promoPrice,
      isOutOfCoverage,
      isEstimated,
      messageTemplate,
    };
  }


  public calculateOngkirByDistance(distanceKm: number): { normalPrice: number; promoDiscount: number; isOutOfCoverage: boolean } {
    const sortedTiers = [...activeDeliveryTiers].sort((a, b) => a.maxDist - b.maxDist);
    const matchingTier = sortedTiers.find(t => distanceKm <= t.maxDist);
    
    if (matchingTier) {
      return { 
        normalPrice: matchingTier.fee, 
        promoDiscount: matchingTier.promoDiscount, 
        isOutOfCoverage: false 
      };
    }
    return { normalPrice: 0, promoDiscount: 0, isOutOfCoverage: true };
  }
}

export const deliveryService = new DeliveryService();

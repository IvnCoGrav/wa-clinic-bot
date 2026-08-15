import { calculateHaversineDistance, Coordinates } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';
import { IOrsClient, orsClient as defaultOrsClient } from '../integrations/ors/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';
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
  { id: 4, maxDist: 15, fee: 25000, promoDiscount: 10000 },
  { id: 5, maxDist: 20, fee: 25000, promoDiscount: 5000 },
  { id: 6, maxDist: 25, fee: 35000, promoDiscount: 10000 },
  { id: 7, maxDist: 30, fee: 35000, promoDiscount: 5000 }
];

export let activeDeliveryTiers: DeliveryTier[] = [];

/**
 * Faktor pembulatan jarak lurus (Haversine) ke estimasi jarak jalan.
 * Dapat di-override per env HAVERSINE_CIRCUITY_FACTOR; default 1.60x mengikuti
 * profil kelokan rute perkotaan Surabaya-Sidoarjo.
 * Lihat Fase 3 docs/HARDCODED_FIX_PLAN.md.
 */
const HAVERSINE_CIRCUITY_FACTOR = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');

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

// Initial load (file fallback)
loadDeliveryTiers();

/**
 * Mengambil delivery tiers dari database per tenant.
 * Sumber kebenaran: tabel `delivery_tiers` (SaaS-ready).
 * Fallback: file delivery_tiers_custom.json (legacy single-tenant).
 */
export async function getDeliveryTiersFromDb(tenantId: string = DEFAULT_TENANT_ID): Promise<DeliveryTier[]> {
  try {
    const dbTiers = await prisma.deliveryTier.findMany({
      where: { tenant_id: tenantId },
      orderBy: { sort_order: 'asc' },
    });

    if (dbTiers.length > 0) {
      return dbTiers.map((t) => ({
        id: Number(t.sort_order),
        maxDist: t.max_dist,
        fee: t.fee,
        promoDiscount: t.promo_discount,
      }));
    }

    // Tidak ada data di DB -> seed dari file/default lalu simpan
    const source = activeDeliveryTiers.length > 0 ? activeDeliveryTiers : DEFAULT_TIERS;
    console.warn(`[SEED] Delivery tiers kosong untuk tenant ${tenantId}; seeding dari ${activeDeliveryTiers.length > 0 ? 'file delivery_tiers_custom.json' : 'DEFAULT_TIERS (code default)'} (${source.length} tier). Set nilai via admin API / DB untuk produksi.`);
    await prisma.deliveryTier.deleteMany({ where: { tenant_id: tenantId } });
    await prisma.deliveryTier.createMany({
      data: source.map((t, idx) => ({
        tenant_id: tenantId,
        max_dist: t.maxDist,
        fee: t.fee,
        promo_discount: t.promoDiscount,
        sort_order: idx + 1,
      })),
    });
    return source;
  } catch (err) {
    // DB offline -> fallback file
    console.warn('[DELIVERY TIERS] DB unavailable, using file fallback:', (err as Error).message);
    return activeDeliveryTiers.length > 0 ? activeDeliveryTiers : DEFAULT_TIERS;
  }
}

/**
 * Menyimpan delivery tiers ke database per tenant.
 */
export async function saveDeliveryTiersToDb(tiers: DeliveryTier[], tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
  try {
    await prisma.deliveryTier.deleteMany({ where: { tenant_id: tenantId } });
    await prisma.deliveryTier.createMany({
      data: tiers
        .slice()
        .sort((a, b) => a.maxDist - b.maxDist)
        .map((t, idx) => ({
          tenant_id: tenantId,
          max_dist: t.maxDist,
          fee: t.fee,
          promo_discount: t.promoDiscount,
          sort_order: idx + 1,
        })),
    });
    // Juga update fallback file (legacy compat)
    saveDeliveryTiers(tiers);
    return true;
  } catch (err) {
    console.error('[DELIVERY TIERS] Failed to save to DB, using file fallback:', (err as Error).message);
    return saveDeliveryTiers(tiers);
  }
}


export interface DeliveryCalculationResult {
  distanceKm: number;
  ongkir: number; // Map ke promoPrice untuk database/state-machine
  normalPrice: number;
  promoPrice: number;
  isOutOfCoverage: boolean;
  isEstimated?: boolean;
  freeTierKm?: number;
  maxCoverageKm?: number;
  messageTemplate: string;
}

/**
 * Service untuk kalkulasi ongkos kirim (ongkir) dan status jangkauan lokasi customer.
 * 
 * SUMBER DISTANCE:
 * 1. Utama    : OpenRouteService (ORS) Directions API (profile: cycling-electric)
 * 2. Fallback  : Formula Haversine manual dengan Circuity Multiplier (1.50x)
 * 
 * SUMBER TIER (SaaS-ready):
 * 1. Database `delivery_tiers` per tenant
 * 2. Fallback file delivery_tiers_custom.json
 */
export class DeliveryService {
  private orsClient: IOrsClient;

  constructor(orsClient?: IOrsClient) {
    this.orsClient = orsClient || defaultOrsClient;
  }

  /**
   * Menghitung ongkir berdasarkan jarak dari titik lokasi moms & baby spa ke koordinat customer.
   */
  public async calculateDelivery(
    customerCoords: Coordinates,
    clinicCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng },
    tenantId: string = DEFAULT_TENANT_ID
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
      // 2. FALLBACK: Haversine + circuity factor
      console.warn(
        `[DELIVERY SERVICE FALLBACK] ORS Directions API route calculation failed/unavailable for coords (${customerCoords.lat}, ${customerCoords.lng}). Falling back to Haversine distance with ${HAVERSINE_CIRCUITY_FACTOR}x circuity multiplier.`
      );
      const straightLineKm = calculateHaversineDistance(clinicCoords, customerCoords);
      distanceKm = parseFloat((straightLineKm * HAVERSINE_CIRCUITY_FACTOR).toFixed(2));
      isEstimated = true;
    }

    // 3. Ambil tier ongkir per tenant (DB -> fallback file)
    const tiers = await getDeliveryTiersFromDb(tenantId);

    // 4. Evaluasi threshold jarak & tentukan tarif ongkir
    const { normalPrice, promoDiscount, isOutOfCoverage } = this.calculateOngkirByDistance(distanceKm, tiers);

    // Hitung promoPrice dengan diskon
    const promoPrice = Math.max(0, normalPrice - promoDiscount);

    // 5. Construct message template (angka dinamis dari tier, bukan hardcode)
    let messageTemplate = '';
    const freeTierKm = tiers.find((t) => t.fee === 0)?.maxDist;
    const maxCoverageKm = tiers.length > 0 ? Math.max(...tiers.map((t) => t.maxDist)) : clinicConfig.maxDeliveryDistanceKm;
    if (freeTierKm !== undefined && distanceKm <= freeTierKm) {
      messageTemplate = `Wah, Deket Bunda, Lokasi Anda berjarak ${distanceKm.toFixed(1)} km dari moms & baby spa kami (masih dalam jangkauan gratis ongkir hingga ${freeTierKm} km), sehingga layanan kami GRATIS ongkir!`;
    } else if (!isOutOfCoverage) {
      messageTemplate = `Lokasi Anda berjarak ${distanceKm.toFixed(1)} km dari moms & baby spa kami. Biaya ongkir normal untuk area ini adalah Rp${normalPrice.toLocaleString('id-ID')} (Promo: Rp${promoPrice.toLocaleString('id-ID')}).`;
    } else {
      messageTemplate = `Mohon maaf, lokasi Anda berjarak ${distanceKm.toFixed(1)} km dari moms & baby spa kami. Saat ini area tersebut berada di luar jangkauan pengiriman/home-treatment kami (maksimal ${maxCoverageKm} km).`;
    }

    return {
      distanceKm,
      ongkir: promoPrice, // Map ke promoPrice untuk database/state-machine
      normalPrice,
      promoPrice,
      isOutOfCoverage,
      isEstimated,
      freeTierKm,
      maxCoverageKm,
      messageTemplate,
    };
  }


  public calculateOngkirByDistance(
    distanceKm: number,
    tiers: DeliveryTier[] = activeDeliveryTiers
  ): { normalPrice: number; promoDiscount: number; isOutOfCoverage: boolean } {
    const sortedTiers = [...tiers].sort((a, b) => a.maxDist - b.maxDist);
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

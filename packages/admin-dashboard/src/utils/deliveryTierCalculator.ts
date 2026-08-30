/**
 * Utility untuk menghitung ongkir dinamis berdasarkan delivery tiers dari database (SaaS-Ready).
 * Menggantikan seluruh rumus hardcode (jarak - 3) * 3000.
 */

export interface DeliveryTierItem {
  id?: number | string;
  maxDist: number;
  fee: number;
  promoDiscount?: number;
  sort_order?: number;
}

export interface CalculatedDeliveryFee {
  fee: number;
  promoDiscount: number;
  netOngkir: number;
  isOutOfCoverage: boolean;
  matchedTier?: DeliveryTierItem;
}

/**
 * Menghitung ongkir berdasarkan jarak kilometer dan daftar tier dari database.
 * Default tiers jika belum ada data:
 * 0 - 5 km: 0
 * 5.1 - 7 km: 15.000 (Promo 10.000 -> net 5.000)
 * 7.1 - 10 km: 15.000 (Promo 5.000 -> net 10.000)
 * 10.1 - 15 km: 25.000 (Promo 10.000 -> net 15.000)
 * 15.1 - 20 km: 25.000 (Promo 5.000 -> net 20.000)
 * 20.1 - 25 km: 35.000 (Promo 10.000 -> net 25.000)
 * 25.1 - 30 km: 35.000 (Promo 5.000 -> net 30.000)
 */
export function calculateOngkirFromTiers(
  distanceKm: number,
  tiers: DeliveryTierItem[] = []
): CalculatedDeliveryFee {
  const km = Math.max(0, Number(distanceKm) || 0);

  // Jika tiers kosong, sediakan fallback default Kala Spa
  const effectiveTiers: DeliveryTierItem[] = tiers.length > 0
    ? [...tiers].sort((a, b) => Number(a.maxDist) - Number(b.maxDist))
    : [
        { maxDist: 5, fee: 0, promoDiscount: 0 },
        { maxDist: 7, fee: 15000, promoDiscount: 10000 },
        { maxDist: 10, fee: 15000, promoDiscount: 5000 },
        { maxDist: 15, fee: 25000, promoDiscount: 10000 },
        { maxDist: 20, fee: 25000, promoDiscount: 5000 },
        { maxDist: 25, fee: 35000, promoDiscount: 10000 },
        { maxDist: 30, fee: 35000, promoDiscount: 5000 },
      ];

  const matched = effectiveTiers.find((t) => km <= Number(t.maxDist));

  if (!matched) {
    // Jarak melebihi tier terjauh (Out of coverage)
    const maxTier = effectiveTiers[effectiveTiers.length - 1];
    const fee = maxTier ? Number(maxTier.fee) : 35000;
    const promoDiscount = maxTier ? Number(maxTier.promoDiscount || 0) : 0;
    return {
      fee,
      promoDiscount,
      netOngkir: Math.max(0, fee - promoDiscount),
      isOutOfCoverage: true,
      matchedTier: maxTier,
    };
  }

  const fee = Number(matched.fee) || 0;
  const promoDiscount = Number(matched.promoDiscount) || 0;
  const netOngkir = Math.max(0, fee - promoDiscount);

  return {
    fee,
    promoDiscount,
    netOngkir,
    isOutOfCoverage: false,
    matchedTier: matched,
  };
}

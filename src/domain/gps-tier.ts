/**
 * Kandidat koordinat untuk pemilihan tier GPS.
 * Sumber: pesan shareloc customer, shareloc bidan, koordinat tersimpan di DB, hasil geocoding.
 */
export interface GpsCandidate {
  source: string;
  lat: number;
  lng: number;
  at: string; // ISO timestamp sumber diperoleh
}

/**
 * Hierarki tier koordinat (angka makin kecil = makin tinggi kepentingannya).
 * Invarian dari refresh (customer.service:1757-1789):
 *   bidan_shareloc > customer_shareloc > db_coords > geocoding
 */
const TIER_RANK: Record<string, number> = {
  bidan_shareloc: 1, // Plan v2.1: setara customer_shareloc (tier sama, yang terbaru menang)
  customer_shareloc: 1,
  db_coords: 2,
  geocoding: 3,
};

const UNKNOWN_TIER_RANK = 99;

/**
 * Pemilih kandidat koordinat berbasis tier tegas:
 *   1. Tier lebih tinggi selalu menang, tanpa peduli timestamp.
 *   2. Di dalam tier yang sama, kandidat TERBARU yang menang.
 *   3. Daftar kosong / semua kandidat tidak valid → null (tanpa halusinasi).
 */
export function pickGpsTier(candidates: GpsCandidate[]): GpsCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const valid = candidates.filter(
    (c) =>
      c &&
      Number.isFinite(Number(c.lat)) &&
      Number.isFinite(Number(c.lng)) &&
      !(Number(c.lat) === 0 && Number(c.lng) === 0) &&
      Math.abs(Number(c.lat)) <= 90 &&
      Math.abs(Number(c.lng)) <= 180
  );
  if (valid.length === 0) return null;

  const rankOf = (c: GpsCandidate) => TIER_RANK[c.source] ?? UNKNOWN_TIER_RANK;
  const timeOf = (c: GpsCandidate) => {
    const t = Date.parse(c.at);
    return Number.isFinite(t) ? t : 0;
  };

  let best = valid[0];
  let bestRank = rankOf(best);
  let bestTime = timeOf(best);
  for (const c of valid.slice(1)) {
    const r = rankOf(c);
    const t = timeOf(c);
    if (r < bestRank || (r === bestRank && t > bestTime)) {
      best = c;
      bestRank = r;
      bestTime = t;
    }
  }
  return best;
}

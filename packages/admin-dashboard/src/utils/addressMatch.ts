/**
 * CERMIN 1:1 dari `src/domain/customer-address.ts` (norm/hasText/haversine/
 * bothCoords/addressesMatch) untuk FE dashboard (paket terpisah, tanpa import
 * lintas repo backend).
 *
 * ATURAN SINKRONISASI: setiap perubahan semantik di sumber WAJIB disalin ke
 * sini dan sebaliknya — dijaga tes paritas
 * `tests/unit/dashboard-address-match-parity.test.ts` (root vitest).
 */

export const SAME_POINT_MAX_METERS = 150;

export interface AddressMatchInput {
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Normalisasi ringan data-driven (bukan daftar hafalan bisnis): lowercase + rapatkan spasi. */
function norm(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasText(value?: string | null): boolean {
  return norm(value).length > 0;
}

/** Jarak Haversine meter — identik dengan DeliveryService fallback. */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bothCoords(
  a: { lat?: number | null; lng?: number | null },
  b: { lat?: number | null; lng?: number | null }
): boolean {
  return typeof a.lat === 'number' && typeof a.lng === 'number' && typeof b.lat === 'number' && typeof b.lng === 'number';
}

/**
 * Dedup deterministik (identik sumber):
 *  1. titik <150 m, ATAU
 *  2. alamat jalan + kecamatan identik (kelurahan kompatibel), ATAU
 *  3. tanpa teks jalan di kedua sisi + kelurahan + kecamatan identik, ATAU
 *  4. tepat SATU sisi ber-teks jalan + kecamatan sama (pengayaan rumah sama).
 * Beda jalan dalam kecamatan sama (keduanya ber-teks) → TIDAK match.
 */
export function addressesMatch(
  a: AddressMatchInput,
  b: AddressMatchInput,
  maxMeters: number = SAME_POINT_MAX_METERS
): boolean {
  if (bothCoords(a, b) && haversineMeters(a as any, b as any) <= maxMeters) return true;

  const aAddr = hasText(a.address);
  const bAddr = hasText(b.address);
  const sameStreet = aAddr && bAddr && norm(a.address) === norm(b.address);
  const kelSamaPersis = hasText(a.kelurahan) && hasText(b.kelurahan) && norm(a.kelurahan) === norm(b.kelurahan);
  const sameKel = kelSamaPersis;
  const kelKompatibel = kelSamaPersis || !hasText(a.kelurahan) || !hasText(b.kelurahan);
  const sameKec = hasText(a.kecamatan) && hasText(b.kecamatan) && norm(a.kecamatan) === norm(b.kecamatan);
  const sameKota = hasText(a.kota) && hasText(b.kota) && norm(a.kota) === norm(b.kota);

  if (sameStreet && sameKec && kelKompatibel) return true;
  if (!aAddr && !bAddr && sameKel && sameKec) return true;
  if (aAddr !== bAddr && sameKec) {
    const kelOk = sameKel || !hasText(a.kelurahan) || !hasText(b.kelurahan);
    if (kelOk) return true;
  }
  void sameKota;
  return false;
}

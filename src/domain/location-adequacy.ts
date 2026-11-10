/**
 * location-adequacy.ts — Sumber kebenaran TUNGGAL untuk menilai apakah titik
 * lokasi pelanggan sudah cukup akurat (tidak perlu shareloc lagi).
 *
 * Latar belakang (audit produksi 2026-11-06, temuan C-001/C-002):
 *  - Badge "📍 Butuh Shareloc" hanya membaca kolom `customers.location_source`
 *    dan hanya menerima `gps_pin` sebagai presisi.
 *  - Pelanggan yang sudah diverifikasi staf (`manual_staff`, akurasi 14 m) atau
 *    punya riwayat kunjungan + foto rumah tetap dicap "butuh shareloc".
 *  - `preferences.location_source` dan `saved_addresses[].locationSource` bisa
 *    berbeda dari kolom (split-brain), sehingga tiap permukaan UI menjawab beda.
 *
 * Modul ini murni (nol DB, nol I/O) dan dipakai backend + cermin frontend agar
 * semua permukaan memakai keputusan yang sama.
 *
 * Aturan prioritas bukti (dari terkuat):
 *  1. Pin GPS presisi (`gps_pin`/`bidan_shareloc`/`customer_shareloc`/
 *     `url_coords`) ATAU `share_location_sent` + koordinat valid.
 *  2. Verifikasi staf (`manual_staff`/`FIELD_STAFF_GPS`) PADA TITIK YANG SAMA
 *     (toleransi GPS 150 m). Bila pelanggan pindah rumah, bukti lama tidak
 *     boleh menutupi titik baru.
 *  3. Bukti lapangan: foto rumah + minimal 1 kunjungan + alamat lengkap.
 *  4. Estimasi wilayah (geocoding/sentroid) → masih butuh shareloc.
 *  5. Tidak diketahui → butuh shareloc.
 */

export type LocationSourceKind = 'gps_pin' | 'manual_staff' | 'estimated_area' | null;

export type LocationAdequacyReason =
  | 'gps_pin'
  | 'staff_verified'
  | 'field_verified'
  | 'estimated_area'
  | 'unknown';

export interface Coordinates {
  lat: number | null;
  lng: number | null;
}

export interface LocationAdequacyInput extends Partial<Coordinates> {
  /** Kolom `customers.location_source` (sumber historis badge). */
  columnSource?: string | null;
  /** `customers.preferences.location_source` / `source`. */
  preferenceSource?: string | null;
  /** `saved_addresses[].locationSource` milik alamat primer. */
  primaryAddressSource?: string | null;
  /** `customers.share_location_sent`. */
  shareLocationSent?: boolean | null;
  /** Bukti verifikasi staf (staff id/name/accuracy/FIELD_STAFF_GPS). */
  staffVerified?: boolean | null;
  /** Koordinat verifikasi staf terakhir (jika tersedia). */
  staffVerifiedCoords?: Coordinates | null;
  /** Foto rumah terverifikasi lapangan. */
  housePhotoUrl?: string | null;
  /** Jumlah kunjungan yang pernah selesai. */
  purchaseCount?: number | null;
  /** Alamat primer ini terbukti pernah dikunjungi (ada `lastUsedAt`). */
  hasVisitedAddress?: boolean | null;
  /** Alamat teks lengkap (jalan/perumahan) tersimpan. */
  hasCompleteAddress?: boolean | null;
}

export interface LocationAdequacy {
  source: LocationSourceKind | 'unknown';
  isAdequate: boolean;
  needsShareloc: boolean;
  reason: LocationAdequacyReason;
}

/** Toleransi kesamaan titik untuk verifikasi staf (meter). */
export const SAME_PLACE_TOLERANCE_M = 150;

const GPS_SOURCES = new Set(['gps_pin', 'bidan_shareloc', 'customer_shareloc', 'url_coords']);
const MANUAL_SOURCES = new Set(['manual_staff', 'field_staff_gps']);
const ESTIMATED_SOURCES = new Set([
  'estimated_area',
  'db_coords',
  'geocoding',
  'url_text_geocoded',
  'gazetteer',
]);

function normalizeRaw(raw?: string | null): LocationSourceKind {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (GPS_SOURCES.has(s)) return 'gps_pin';
  if (MANUAL_SOURCES.has(s)) return 'manual_staff';
  if (ESTIMATED_SOURCES.has(s)) return 'estimated_area';
  return null;
}

/** API publik: normalisasi satu sumber mentah ke kategori kanonik. */
export function resolveEffectiveLocationSource(
  input?: string | { source?: string | null; location_source?: string | null } | null
): LocationSourceKind {
  if (!input) return null;
  if (typeof input === 'string') return normalizeRaw(input);
  return normalizeRaw(input.source ?? input.location_source ?? null);
}

export function hasValidCoords(c?: Partial<Coordinates> | null): c is Coordinates {
  if (!c) return false;
  if (c.lat == null || c.lng == null || (c.lat as any) === '' || (c.lng as any) === '') return false;
  const lat = Number(c.lat);
  const lng = Number(c.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Jarak dua titik (meter) — Haversine sederhana, cukup untuk toleransi 150 m. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  // Koordinat tidak lengkap = tidak bisa dibandingkan; anggap sangat jauh agar
  // bukti lama tidak menutupi titik baru (fail-closed untuk adequacy).
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    return Number.POSITIVE_INFINITY;
  }
  const R = 6_371_000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ambil koordinat verifikasi staf terakhir dari `preferences.location_history`.
 * Dipakai sebagai guard anti "pelanggan pindah rumah".
 */
export function extractStaffVerifiedCoords(preferences: any): Coordinates | null {
  const history = Array.isArray(preferences?.location_history) ? preferences.location_history : [];
  let best: { at: number; coords: Coordinates } | null = null;
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const src = String(entry.source || entry.raw_source || '').toLowerCase();
    if (!MANUAL_SOURCES.has(src)) continue;
    const coords = { lat: Number(entry.lat), lng: Number(entry.lng) };
    if (!hasValidCoords(coords)) continue;
    const rawAt = entry.updatedAt || entry.timestamp || entry.refreshedAt || 0;
    const at = new Date(rawAt).getTime();
    if (!best || (Number.isFinite(at) && at >= best.at)) best = { at: Number.isFinite(at) ? at : 0, coords };
  }
  return best ? best.coords : null;
}

/**
 * Keputusan akhir: apakah titik pelanggan sudah cukup untuk operasional
 * (tidak perlu meminta shareloc lagi).
 */
export function resolveLocationAdequacy(input: LocationAdequacyInput): LocationAdequacy {
  const rawCoords = { lat: input.lat ?? null, lng: input.lng ?? null };
  const coordsOk = hasValidCoords(rawCoords);
  const coords: Coordinates = coordsOk
    ? { lat: Number(rawCoords.lat), lng: Number(rawCoords.lng) }
    : { lat: 0, lng: 0 };

  const candidates = [input.columnSource, input.preferenceSource, input.primaryAddressSource]
    .map(normalizeRaw)
    .filter(Boolean) as Array<Exclude<LocationSourceKind, null>>;

  // 1. Pin GPS presisi.
  const gpsEvidence =
    candidates.includes('gps_pin') || (Boolean(input.shareLocationSent) && coordsOk);
  if (gpsEvidence && coordsOk) {
    return { source: 'gps_pin', isAdequate: true, needsShareloc: false, reason: 'gps_pin' };
  }

  // 2. Verifikasi staf — hanya sah bila titik verifikasi fisik valid dan masih di tempat yang sama.
  if (input.staffVerified && coordsOk && candidates.includes('manual_staff')) {
    const verifiedCoords = input.staffVerifiedCoords || null;
    const samePlace =
      verifiedCoords && hasValidCoords(verifiedCoords)
        ? distanceMeters(verifiedCoords, coords) <= SAME_PLACE_TOLERANCE_M
        : (input.columnSource === 'manual_staff' || Boolean(input.housePhotoUrl));
    if (samePlace) {
      return { source: 'manual_staff', isAdequate: true, needsShareloc: false, reason: 'staff_verified' };
    }
  }

  // 3. Bukti lapangan: foto rumah + alamat terbukti pernah dikunjungi +
  //    alamat lengkap. `hasVisitedAddress` (lastUsedAt kartu) mencegah rumah
  //    BARU ikut dianggap aman hanya karena pelanggan punya riwayat kunjungan
  //    di rumah lama.
  const purchaseCount = Number(input.purchaseCount || 0);
  const visitedAddress =
    input.hasVisitedAddress === true || (input.hasVisitedAddress == null && purchaseCount > 0);
  if (coordsOk && Boolean(input.housePhotoUrl) && visitedAddress && Boolean(input.hasCompleteAddress)) {
    return { source: 'manual_staff', isAdequate: true, needsShareloc: false, reason: 'field_verified' };
  }

  // 4. Estimasi wilayah.
  if (coordsOk) {
    return { source: 'estimated_area', isAdequate: false, needsShareloc: true, reason: 'estimated_area' };
  }

  // 5. Tidak diketahui.
  return { source: 'unknown', isAdequate: false, needsShareloc: true, reason: 'unknown' };
}

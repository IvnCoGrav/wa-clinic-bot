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

import { type LocationSourceKind, resolveEffectiveLocationSource } from './location-source';
import { deriveFieldVerification, hasFieldVerifiedGpsHistory } from './location-trust';

export type { LocationSourceKind };
export { resolveEffectiveLocationSource };

export type LocationAdequacyReason =
  | 'gps_pin'
  | 'staff_verified'
  | 'field_verified'
  | 'estimated_area'
  | 'unknown';

/**
 * Dimensi 1: Presisi Titik Koordinat Navigasi
 * Urutan hierarki: pin (pasien/bidan) > GPS lapangan <= 50m > titik DB > geocoding / estimasi wilayah
 */
export type CoordinatePrecisionTier =
  | 'pin'
  | 'field_gps'
  | 'db_coords'
  | 'geocoding'
  | 'unknown';

/**
 * Dimensi 2: Tingkat Kepercayaan Rumah / Lokasi Fisik
 * Urutan hierarki: Foto + GPS <= 50m + kunjungan > pin dikonfirmasi pasien > pin chat/link mentah > estimasi wilayah
 */
export type HouseTrustTier =
  | 'field_verified'
  | 'customer_confirmed'
  | 'chat_pin'
  | 'estimated'
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
  precisionTier?: CoordinatePrecisionTier;
  trustTier?: HouseTrustTier;
  isFieldVerified?: boolean;
}

/** Toleransi kesamaan titik untuk verifikasi staf (meter). */
export const SAME_PLACE_TOLERANCE_M = 150;



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
    const src = String(entry.source || entry.raw_source || '');
    if (resolveEffectiveLocationSource(src) !== 'manual_staff') continue;
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
    .map(resolveEffectiveLocationSource)
    .filter(Boolean) as Array<Exclude<LocationSourceKind, null>>;

  // 1. Pin GPS presisi.
  const gpsEvidence =
    candidates.includes('gps_pin') || (Boolean(input.shareLocationSent) && coordsOk);
  if (gpsEvidence && coordsOk) {
    const verifiedCoords = input.staffVerifiedCoords || null;
    const samePlace =
      verifiedCoords && hasValidCoords(verifiedCoords)
        ? distanceMeters(verifiedCoords, coords) <= SAME_PLACE_TOLERANCE_M
        : true;
    const hasFreshFieldGps = Boolean(
      (input as any).hasFreshFieldGps ||
      (verifiedCoords && hasValidCoords(verifiedCoords) && samePlace) ||
      hasFieldVerifiedGpsHistory((input as any).preferences)
    );
    const fv = deriveFieldVerification({
      housePhotoUrl: input.housePhotoUrl || null,
      accuracyM: (input as any).accuracyM ?? null,
      hasFreshFieldGps,
      sameLocation: samePlace,
      preferences: (input as any).preferences || null,
      purchaseCount: Number(input.purchaseCount || 0),
    });
    return {
      source: 'gps_pin',
      isAdequate: true,
      needsShareloc: false,
      reason: 'gps_pin',
      precisionTier: 'pin',
      trustTier: fv.verified
        ? 'field_verified'
        : input.shareLocationSent
          ? 'customer_confirmed'
          : 'chat_pin',
      isFieldVerified: fv.verified,
    };
  }

  // 2. Verifikasi staf — hanya sah bila titik verifikasi fisik valid dan masih di tempat yang sama.
  if (input.staffVerified && coordsOk && candidates.includes('manual_staff')) {
    const verifiedCoords = input.staffVerifiedCoords || null;
    const samePlace =
      verifiedCoords && hasValidCoords(verifiedCoords)
        ? distanceMeters(verifiedCoords, coords) <= SAME_PLACE_TOLERANCE_M
        : (input.columnSource === 'manual_staff' || Boolean(input.housePhotoUrl));
    if (samePlace) {
      const hasFreshFieldGps = Boolean(
        (input as any).hasFreshFieldGps ||
        (verifiedCoords && hasValidCoords(verifiedCoords)) ||
        hasFieldVerifiedGpsHistory((input as any).preferences)
      );
      const fv = deriveFieldVerification({
        housePhotoUrl: input.housePhotoUrl || null,
        accuracyM: (input as any).accuracyM ?? null,
        hasFreshFieldGps,
        sameLocation: samePlace,
        preferences: (input as any).preferences || null,
        purchaseCount: Number(input.purchaseCount || 0),
      });
      return {
        source: 'manual_staff',
        isAdequate: true,
        needsShareloc: false,
        reason: 'staff_verified',
        precisionTier: 'field_gps',
        trustTier: fv.verified ? 'field_verified' : 'chat_pin',
        isFieldVerified: fv.verified,
      };
    }
  }

  // 3. Bukti lapangan (legacy terstruktur): foto rumah + GPS lapangan tervalidasi + kunjungan + alamat lengkap.
  const purchaseCount = Number(input.purchaseCount || 0);
  const visitedAddress =
    input.hasVisitedAddress === true || (input.hasVisitedAddress == null && purchaseCount > 0);
  if (coordsOk && Boolean(input.housePhotoUrl) && visitedAddress && Boolean(input.hasCompleteAddress)) {
    const fv = deriveFieldVerification({
      housePhotoUrl: input.housePhotoUrl || null,
      accuracyM: (input as any).accuracyM ?? null,
      hasFreshFieldGps: Boolean((input as any).hasFreshFieldGps || hasFieldVerifiedGpsHistory((input as any).preferences)),
      sameLocation: true,
      preferences: (input as any).preferences || null,
      purchaseCount,
    });
    if (fv.verified) {
      return {
        source: 'manual_staff',
        isAdequate: true,
        needsShareloc: false,
        reason: 'field_verified',
        precisionTier: 'field_gps',
        trustTier: 'field_verified',
        isFieldVerified: true,
      };
    }
  }

  // 4. Estimasi wilayah.
  if (coordsOk) {
    const isDb = input.preferenceSource === 'db_coords' || input.columnSource === 'db_coords';
    return {
      source: 'estimated_area',
      isAdequate: false,
      needsShareloc: true,
      reason: 'estimated_area',
      precisionTier: isDb ? 'db_coords' : 'geocoding',
      trustTier: 'estimated',
      isFieldVerified: false,
    };
  }

  // 5. Tidak diketahui.
  return {
    source: 'unknown',
    isAdequate: false,
    needsShareloc: true,
    reason: 'unknown',
    precisionTier: 'unknown',
    trustTier: 'unknown',
    isFieldVerified: false,
  };
}

export interface TaskLocationLike {
  lat?: number | null;
  lng?: number | null;
  location_source?: string | null;
  source?: string | null;
  address?: string | null;
  landmark?: string | null;
  housePhotoUrl?: string | null;
  house_photo_url?: string | null;
  preferences?: any;
  share_location_sent?: boolean | null;
  purchase_count?: number | null;
}

function toCoords(entity?: TaskLocationLike | null): Coordinates {
  return {
    lat: entity?.lat != null && entity.lat !== ('' as any) ? Number(entity.lat) : null,
    lng: entity?.lng != null && entity.lng !== ('' as any) ? Number(entity.lng) : null,
  };
}

/**
 * Aturan precedence kanonik untuk reservasi/tugas staf (memperbaiki bug degradasi presisi).
 *
 * Bila customer atau alamat memiliki bukti pin GPS presisi (shareloc asli customer),
 * label presisi gps_pin TIDAK BOLEH didegradasi menjadi manual_staff hanya karena
 * ada entri kartu alamat berlabel manual_staff pada titik yang sama.
 */
export function resolveTaskLocationPrecedence(params: {
  effectiveAddr?: TaskLocationLike | null;
  customer?: TaskLocationLike | null;
}): {
  locationSource: LocationSourceKind;
  isFieldVerified: boolean;
  housePhotoUrl: string | null;
  /** Entitas yang koordinatnya benar-benar dipakai kartu tugas. */
  coordOwner: 'addr' | 'customer' | null;
} {
  const { effectiveAddr, customer } = params;

  const housePhotoUrl: string | null =
    customer?.preferences?.house_photo_url ||
    effectiveAddr?.housePhotoUrl ||
    effectiveAddr?.house_photo_url ||
    null;

  const addrCoords = toCoords(effectiveAddr);
  const custCoords = toCoords(customer);
  const hasAddrCoords = hasValidCoords(addrCoords);
  const hasCustCoords = hasValidCoords(custCoords);

  // ATURAN D4: label presisi HANYA mengikuti entitas pemilik koordinat.
  // Tanpa koordinat → null (netral). DILARANG mempromosikan/menurunkan label
  // milik entitas yang titiknya tidak dipakai (insiden "nyasar" 2026-10-11).
  const coordOwner: 'addr' | 'customer' | null = hasAddrCoords
    ? 'addr'
    : hasCustCoords
      ? 'customer'
      : null;

  const ownerEntity = coordOwner === 'addr' ? effectiveAddr : coordOwner === 'customer' ? customer : null;
  const otherEntity = coordOwner === 'addr' ? customer : coordOwner === 'customer' ? effectiveAddr : null;

  const ownerSrc = resolveEffectiveLocationSource(ownerEntity ?? null);
  const otherSrc = resolveEffectiveLocationSource(otherEntity ?? null);

  const samePoint =
    hasAddrCoords && hasCustCoords
      ? distanceMeters(addrCoords, custCoords) <= SAME_PLACE_TOLERANCE_M
      : false;

  let locationSource: LocationSourceKind = null;

  if (coordOwner) {
    if (ownerSrc === 'gps_pin') {
      locationSource = 'gps_pin';
    } else if (otherSrc === 'gps_pin' && samePoint) {
      // Titik lain yang lebih presisi pada RUMAH YANG SAMA boleh menaikkan presisi.
      locationSource = 'gps_pin';
    } else if (ownerSrc === 'manual_staff') {
      locationSource = 'manual_staff';
    } else if (ownerSrc === 'estimated_area') {
      locationSource = 'estimated_area';
    } else if (
      // Legacy sah: data lama hanya punya flag share_location_sent (belum ada
      // kolom location_source) DAN tidak ada penanda campur tangan staf.
      // A-001: pin_from_staff_at menandakan kontaminasi flag → jangan perlakukan sebagai konfirmasi customer.
      (customer?.share_location_sent === true || Boolean(customer?.preferences?.pin_from_customer_at)) &&
      hasCustCoords &&
      (coordOwner === 'customer' || samePoint) &&
      !resolveEffectiveLocationSource(customer) &&
      !customer?.preferences?.location_updated_by_staff_name &&
      !customer?.preferences?.location_updated_by_staff_id &&
      !customer?.preferences?.pin_from_staff_at &&
      customer?.preferences?.field_gps_lat == null
    ) {
      locationSource = 'gps_pin';
    }
    // ownerSrc === null → tetap null (netral). BUKAN estimated_area (A-016).
  }

  const hasStaffVerification = Boolean(
    customer?.preferences?.location_updated_by_staff_name ||
    customer?.preferences?.location_updated_by_staff_id ||
    customer?.preferences?.location_accuracy_m != null ||
    customer?.preferences?.location_history?.some?.(
      (h: any) => h?.source === 'manual_staff' || h?.source === 'field_verified' || h?.raw_source === 'FIELD_STAFF_GPS'
    )
  );
  const hasFreshFieldGps = Boolean(
    hasFieldVerifiedGpsHistory(customer?.preferences) ||
    (customer?.preferences?.location_accuracy_m != null && Number(customer?.preferences?.location_accuracy_m) <= 50 && hasStaffVerification)
  );

  const isFieldVerified = deriveFieldVerification({
    housePhotoUrl,
    accuracyM: customer?.preferences?.location_accuracy_m ?? null,
    hasFreshFieldGps,
    sameLocation: Boolean(coordOwner !== null && (samePoint || coordOwner === 'customer')),
    preferences: customer?.preferences || null,
    purchaseCount: Number(customer?.purchase_count || 0),
  }).verified && locationSource !== 'estimated_area';

  return { locationSource, isFieldVerified, housePhotoUrl, coordOwner };
}

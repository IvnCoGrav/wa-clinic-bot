/**
 * customerMapUtils.ts
 * Utilitas murni (pure) untuk peta sebaran pelanggan: normalisasi nama kota,
 * warna marker, dan penentuan label wilayah. Dipisah dari komponen agar dapat
 * diuji secara deterministik.
 */

export interface MapPointLike {
  lat: number;
  lng: number;
  kota?: string | null;
  kecamatan?: string | null;
  status?: string | null;
  is_mql?: boolean;
  has_reservation?: boolean | null;
  is_out_of_coverage?: boolean;
  distance_km?: number | null;
  is_estimated_centroid?: boolean;
  location_source?: 'gps_pin' | 'estimated_area' | 'manual_staff' | null;
}

/**
 * Menormalkan variasi penulisan nama kota dari DB menjadi nama kanonik yang
 * ringkas, mis. "Kota Surabaya" -> "Surabaya", "Kabupaten Sidoarjo" -> "Sidoarjo",
 * "Gresik Regency" -> "Gresik", "sby" -> "Surabaya", "sda" -> "Sidoarjo".
 * Kota di luar 3 wilayah layanan dikembalikan apa adanya (setelah dibersihkan
 * dari sisa teks non-wilayah).
 */
export function normalizeCity(raw?: string | null): string {
  let value = String(raw ?? '').trim();
  if (!value) return '';
  // Buang jika teks merupakan nomor telepon atau label kontak
  if (/(?:no\.?\s*hp|telp|wa)\s*[:\-]?/i.test(value) || value.replace(/\D/g, '').length >= 6) {
    return '';
  }
  // Bersihkan sisa label teknis & nomor telepon yang menempel pada nama kota.
  value = value
    .replace(/^(kota|kabupaten|kab\.?)\s*[:\-]?\s*/i, '')
    .replace(/^[:\-–—,.\s]+/, '')
    .replace(/[\s,.:\-–—]+$/, '')
    .trim();
  if (!value) return '';

  const lower = value.toLowerCase();
  if (/\bsby\b/.test(lower) || lower === 'sby') return 'Surabaya';
  if (/\bsda\b/.test(lower) || lower === 'sda') return 'Sidoarjo';
  for (const city of ['surabaya', 'sidoarjo', 'gresik']) {
    if (lower.includes(city)) {
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }
  return value;
}

/**
 * Menentukan daftar kota unik (kanonik) dari sekumpulan titik, terurut A-Z.
 */
export function uniqueCities(points: Array<{ kota?: string | null }>): string[] {
  const set = new Set<string>();
  for (const p of points) {
    const c = normalizeCity(p.kota);
    if (
      c &&
      !/^(no\.?\s*hp|telp|wa|jl\.?|jalan|rt|rw|\d+)/i.test(c) &&
      !/\d{5,}/.test(c) &&
      c.length >= 3 &&
      c.length <= 30
    ) {
      set.add(c);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Memfilter titik berdasarkan nama kota kanonik (case-insensitive). Bila `city`
 * kosong, kembalikan seluruh titik.
 */
export function filterPointsByCity<T extends { kota?: string | null }>(
  points: T[],
  city: string
): T[] {
  if (!city) return points;
  const target = normalizeCity(city).toLowerCase();
  return points.filter((p) => normalizeCity(p.kota).toLowerCase() === target);
}

/**
 * Warna marker berdasarkan prioritas status. Urutan prioritas:
 * 1. Di luar jangkauan (abu)
 * 2. Sudah reservasi (hijau) — mengalahkan MQL
 * 3. MQL (biru)
 */
export function markerColor(point: MapPointLike): string {
  if (point.is_out_of_coverage) return '#94a3b8';
  if (point.has_reservation) return '#008069';
  return '#2563eb';
}

/** Validasi rentang koordinat (lat -90..90, lng -180..180). */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Kategori status untuk legenda interaktif (hanya MQL & reservasi). */
export type SpatialStatus = 'reserved' | 'mql' | 'out_of_coverage';

/** Kategori sumber koordinat lokasi (pembeda visual di peta). */
export type LocationSourceKind = 'gps_pin' | 'estimated_area' | 'manual_staff';

export interface LocationVisual {
  source: LocationSourceKind;
  /** Label ringkas untuk popup & legenda. */
  label: string;
  /** Warna outline marker. */
  borderColor: string;
  dashArray?: string;
  fillOpacity: number;
  radius: number;
}

const LOCATION_VISUALS: Record<LocationSourceKind, Omit<LocationVisual, 'source'>> = {
  // GPS asli (shareloc customer/bidan) — marker padat tegas.
  gps_pin: { label: '📍 GPS Akurat', borderColor: '#ffffff', fillOpacity: 0.9, radius: 6 },
  // Estimasi wilayah (gazetteer/geocoding) — outline putus-putus & fill transparan.
  estimated_area: {
    label: '⚪ Estimasi Wilayah',
    borderColor: '#64748b',
    dashArray: '4 3',
    fillOpacity: 0.5,
    radius: 7,
  },
  // Diedit manual oleh bidan/staf — outline ungu tegas, fill pekat.
  manual_staff: { label: '🛠️ Diedit Bidan/Staf', borderColor: '#7c3aed', fillOpacity: 0.9, radius: 7 },
};

/**
 * Menentukan visual marker berdasarkan sumber koordinat.
 * Kompatibilitas data lama: bila `location_source` null/kosong, turunkan dari
 * `is_estimated_centroid` (sentroid → estimated_area, selain itu → gps_pin).
 */
export function locationVisual(point: MapPointLike): LocationVisual {
  const raw = point.location_source;
  const source: LocationSourceKind =
    raw === 'gps_pin' || raw === 'estimated_area' || raw === 'manual_staff'
      ? raw
      : point.is_estimated_centroid
        ? 'estimated_area'
        : 'gps_pin';
  return { source, ...LOCATION_VISUALS[source] };
}

/** Menentukan kategori status satu titik (satu kategori, prioritas tetap). */
export function statusOf(point: MapPointLike): SpatialStatus {
  if (point.is_out_of_coverage) return 'out_of_coverage';
  if (point.has_reservation) return 'reserved';
  return 'mql';
}

/**
 * Memfilter titik berdasarkan kategori status yang diizinkan (legenda interaktif).
 * Set kosong → kembalikan seluruh titik (tidak ada yang disembunyikan).
 */
export function filterPointsByStatus<T extends MapPointLike>(
  points: T[],
  allowedStatuses: Set<SpatialStatus>
): T[] {
  if (!allowedStatuses || allowedStatuses.size === 0) return points;
  return points.filter((p) => allowedStatuses.has(statusOf(p)));
}

export interface SpatialMetrics {
  totalPoints: number;
  preciseCount: number;
  estimatedCount: number;
  inCoverageCount: number;
  outOfCoverageCount: number;
  inCoveragePercent: number;
  averageDistanceKm: number | null;
  topKecamatan: Array<{ name: string; count: number }>;
}

/**
 * Menghitung metrik spasial dari sekumpulan titik untuk KPI cards.
 * Semua perhitungan deterministik & tahan data kosong.
 */
export function computeSpatialMetrics(points: MapPointLike[]): SpatialMetrics {
  const totalPoints = points.length;
  let preciseCount = 0;
  let estimatedCount = 0;
  let inCoverageCount = 0;
  let outOfCoverageCount = 0;
  let distanceSum = 0;
  let distanceCount = 0;
  const kecamatanCount = new Map<string, number>();

  for (const p of points) {
    const visual = locationVisual(p);
    if (visual.source === 'estimated_area') {
      estimatedCount++;
    } else {
      preciseCount++;
    }

    if (p.is_out_of_coverage) outOfCoverageCount++;
    else inCoverageCount++;

    if (typeof p.distance_km === 'number' && Number.isFinite(p.distance_km)) {
      distanceSum += p.distance_km;
      distanceCount++;
    }

    const kec = String(p.kecamatan ?? '').trim();
    if (kec) kecamatanCount.set(kec, (kecamatanCount.get(kec) || 0) + 1);
  }

  const topKecamatan = Array.from(kecamatanCount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);

  return {
    totalPoints,
    preciseCount,
    estimatedCount,
    inCoverageCount,
    outOfCoverageCount,
    inCoveragePercent: totalPoints > 0 ? Math.round((inCoverageCount / totalPoints) * 100) : 0,
    averageDistanceKm: distanceCount > 0 ? Math.round((distanceSum / distanceCount) * 10) / 10 : null,
    topKecamatan,
  };
}

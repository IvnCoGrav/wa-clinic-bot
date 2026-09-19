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
  is_out_of_coverage?: boolean;
  distance_km?: number | null;
  is_estimated_centroid?: boolean;
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
    if (c) set.add(c);
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
 * 1. Di luar jangkauan (abu)  2. MQL (biru)
 * 3. Status non-aktif (oranye)  4. Aktif (hijau).
 */
export function markerColor(point: MapPointLike): string {
  if (point.is_out_of_coverage) return '#94a3b8';
  if (point.is_mql) return '#2563eb';
  if (point.status && point.status !== 'active') return '#f59e0b';
  return '#008069';
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

/** Kategori status untuk legenda interaktif. */
export type SpatialStatus = 'active' | 'mql' | 'other' | 'out_of_coverage';

/** Menentukan kategori status satu titik (satu kategori, prioritas tetap). */
export function statusOf(point: MapPointLike): SpatialStatus {
  if (point.is_out_of_coverage) return 'out_of_coverage';
  if (point.is_mql) return 'mql';
  if (point.status && point.status !== 'active') return 'other';
  return 'active';
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
    if (p.is_estimated_centroid) estimatedCount++;
    else preciseCount++;

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

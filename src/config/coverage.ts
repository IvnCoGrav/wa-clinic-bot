/**
 * Wilayah cakupan homecare (kota/kabupaten + alias) yang dipakai tool
 * calculate_delivery untuk klasifikasi dalam/luar jangkauan.
 *
 * Sumber (SaaS-ready, pola sama seperti service-areas.ts):
 * env COVERAGE_CITIES / COVERAGE_INSIDE_REGIONS / OUTSIDE_CITIES (format CSV).
 * Jika kosong, fallback ke daftar default historis agar perilaku lama (dan test)
 * tidak berubah. Di masa depan nilai ini dibaca per-tenant dari DB.
 *
 * PENTING: modul ini single source untuk daftar wilayah di calculate-delivery.tool.ts.
 * Jangan menambah array kota hardcode paralel di file lain — tambah via env di sini.
 */

function parseCsvList(envName: string, fallback: string[]): string[] {
  const raw = (process.env[envName] || '').trim();
  if (!raw) return [...fallback];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** Kota/kab dalam hierarki cakupan homecare (+ alias umum). */
const DEFAULT_COVERAGE_CITIES = ['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda'];

/** Wilayah yang dianggap "di dalam" termasuk provinsi (untuk isOutsideCoverageKota). */
const DEFAULT_INSIDE_REGIONS = ['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda', 'jawa timur'];

/** Kota luar sebagai DATA (bukan regex); keputusan final tetap berbasis jarak riil. */
const DEFAULT_OUTSIDE_CITIES = [
  'malang', 'jakarta', 'bandung', 'semarang', 'yogyakarta', 'jogja', 'bali', 'denpasar',
  'kediri', 'blitar', 'madiun', 'probolinggo', 'pasuruan', 'jember', 'banyuwangi',
  'bojonegoro', 'tuban', 'lamongan', 'ngawi', 'magetan', 'ponorogo', 'pacitan',
  'trenggalek', 'tulungagung', 'lumajang', 'bondowoso', 'situbondo', 'medan',
];

export function getCoverageCities(): string[] {
  return parseCsvList('COVERAGE_CITIES', DEFAULT_COVERAGE_CITIES);
}

export function getInsideRegions(): string[] {
  return parseCsvList('COVERAGE_INSIDE_REGIONS', DEFAULT_INSIDE_REGIONS);
}

export function getOutsideCities(): string[] {
  return parseCsvList('OUTSIDE_CITIES', DEFAULT_OUTSIDE_CITIES);
}

/** Nilai default (untuk test/dokumentasi — perilaku identik bila env kosong). */
export const DEFAULT_COVERAGE = {
  cities: DEFAULT_COVERAGE_CITIES,
  inside: DEFAULT_INSIDE_REGIONS,
  outside: DEFAULT_OUTSIDE_CITIES,
} as const;

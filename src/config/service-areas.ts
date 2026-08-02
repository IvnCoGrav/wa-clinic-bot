/**
 * Daftar wilayah layanan (nama kelurahan/kecamatan/kota) yang dikenali
 * sebagai penanda lokasi oleh classifier deterministik.
 *
 * Sumber (SaaS-ready): env SERVICE_AREAS (format CSV). Jika kosong, fallback
 * ke daftar default historis di bawah agar perilaku lama (dan test) tidak berubah.
 * Di masa depan nilai ini dibaca per-tenant dari DB (tenant.service_areas).
 *
 * Lihat Fase 5.1 docs/HARDCODED_FIX_PLAN.md.
 */
const DEFAULT_SERVICE_AREAS = [
  'rungkut',
  'mulyosari',
  'sidoklumpuk',
  'surabaya',
  'sidoarjo',
  'waru',
  'candi',
  'kenjeran',
  'kenjern',
  'wonokromo',
  'gubeng',
  'tandes',
  'sukolilo',
  'tenggilis',
  'gayungan',
  'wedi',
  'porong',
  'gedangan',
  'buduran',
  'taman',
  'sedati',
  'krian',
  'balongbendo',
  'tanggungan',
  'bubutan',
  'genteng',
  'mulyorejo',
  'sby',
];

function parseServiceAreas(): string[] {
  const raw = (process.env.SERVICE_AREAS || '').trim();
  if (!raw) return DEFAULT_SERVICE_AREAS;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export const SERVICE_AREAS = parseServiceAreas();

/** Regex alternation dari SERVICE_AREAS, aman untuk disisipkan ke pattern. */
export const SERVICE_AREAS_ALTERNATION = SERVICE_AREAS.join('|');

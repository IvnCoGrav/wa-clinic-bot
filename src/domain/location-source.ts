/**
 * location-source.ts — seam kanonis pengetahuan "sumber lokasi".
 * Dipisah dari location-adequacy agar tidak ada siklus import dengan
 * staff-reservation.service.ts (gate NO_NEW_CYCLE).
 */
export type LocationSourceKind = 'gps_pin' | 'manual_staff' | 'estimated_area' | null;

const GPS_SOURCES = new Set(['gps_pin', 'bidan_shareloc', 'customer_shareloc', 'url_coords']);
const MANUAL_SOURCES = new Set(['manual_staff', 'field_staff_gps', 'field_verified']);
const ESTIMATED_SOURCES = new Set([
  'estimated_area',
  'db_coords',
  'geocoding',
  'url_text_geocoded',
  'gazetteer',
]);

export const STAFF_VERIFIED_LOCATION_LABEL = '📍 Terverifikasi Staf';
export const FIELD_VERIFIED_LOCATION_LABEL = '📍 Terverifikasi Lapangan';

export function buildLocationSourceLabel(source: LocationSourceKind, fieldVerified = false): string | null {
  if (fieldVerified) return FIELD_VERIFIED_LOCATION_LABEL;
  if (source === 'gps_pin') return '📍 Titik Presisi';
  if (source === 'manual_staff') return STAFF_VERIFIED_LOCATION_LABEL;
  if (source === 'estimated_area') return '🟡 Estimasi';
  return null;
}

function normalizeRaw(raw?: string | null): LocationSourceKind {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (GPS_SOURCES.has(s)) return 'gps_pin';
  if (MANUAL_SOURCES.has(s)) return 'manual_staff';
  if (ESTIMATED_SOURCES.has(s)) return 'estimated_area';
  return null;
}

export function resolveEffectiveLocationSource(
  input?: string | { source?: string | null; location_source?: string | null } | null
): LocationSourceKind {
  if (!input) return null;
  if (typeof input === 'string') return normalizeRaw(input);
  return normalizeRaw(input.source ?? input.location_source ?? null);
}

/** Dipindah apa adanya dari staff-reservation.service.ts (perilaku identik). */
export function resolveLocationSource(
  c: any
): 'gps_pin' | 'estimated_area' | 'manual_staff' | null {
  if (!c) return null;
  const col = c.location_source;
  if (col === 'gps_pin' || col === 'estimated_area' || col === 'manual_staff') return col;

  const pref = (c.preferences as any) || {};
  const src = pref.location_source || pref.source;
  if (src === 'bidan_shareloc' || src === 'customer_shareloc' || src === 'url_coords') return 'gps_pin';
  if (src === 'geocoding' || src === 'url_text_geocoded' || src === 'gazetteer') return 'estimated_area';
  if (src === 'manual_staff' || src === 'FIELD_STAFF_GPS') return 'manual_staff';

  if (pref.location_updated_by_staff_name || pref.location_updated_by_staff_id || pref.field_gps_lat) {
    return 'manual_staff';
  }
  if (c.share_location_sent === true && c.lat != null && c.lng != null) return 'gps_pin';
  return null;
}

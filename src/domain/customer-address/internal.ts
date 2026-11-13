/**
 * DOM-02: helper internal buku alamat (tidak diekspor dari index domain).
 */

/** Normalisasi ringan data-driven (bukan daftar hafalan bisnis): lowercase + rapatkan spasi. */
export function norm(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasText(value?: string | null): boolean {
  return norm(value).length > 0;
}

/** Jarak Haversine meter (fallback tanpa network — sejalan DeliveryService). */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bothCoords(
  a: { lat?: number | null; lng?: number | null },
  b: { lat?: number | null; lng?: number | null }
): boolean {
  return (
    typeof a.lat === 'number' &&
    typeof a.lng === 'number' &&
    typeof b.lat === 'number' &&
    typeof b.lng === 'number'
  );
}

/** Jarak edit Levenshtein (murni tanpa dependency eksternal). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/** Normalisasi kota: buang prefix administratif & dukung singkatan baku kota (sby/sda). */
export function normCity(value?: string | null): string {
  const s = norm(value)
    .replace(/^(kota|kabupaten|kab\.|kotamadya)\s+/i, '')
    .trim();
  if (s === 'sby') return 'surabaya';
  if (s === 'sda') return 'sidoarjo';
  return s;
}

export function hasCoords(v: { lat?: number | null; lng?: number | null }): boolean {
  return (
    typeof v.lat === 'number' &&
    Number.isFinite(v.lat) &&
    typeof v.lng === 'number' &&
    Number.isFinite(v.lng)
  );
}

export function isPreciseGps(v: {
  lat?: number | null;
  lng?: number | null;
  locationSource?: string | null;
}): boolean {
  return hasCoords(v) && v.locationSource === 'gps_pin';
}

import fs from 'fs';
import path from 'path';

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface GazetteerRow {
  Kabupaten_Kota: string;
  Kecamatan: string;
  Kelurahan_Desa: string;
  Kode_Pos: string;
  Koordinat: string;
}

// ---------------------------------------------------------------------------
// Single Source of Truth — lazy single-load + indexes built once
// ---------------------------------------------------------------------------
let initialized = false;
let rawDataCache: GazetteerRow[] | null = null;

let cachedGazetteerAreas: Map<string, string> | null = null;
let cachedPrefixIndex: Map<string, string[]> | null = null;
let cachedKecamatanNames: string[] | null = null;
let cachedKecamatanEntries: Array<{ lower: string; orig: string }> | null = null;

// For O(1) coordinate lookups
let coordByKelLower = new Map<string, { lat: number; lng: number; row: GazetteerRow }>();
let coordByKecLower = new Map<string, { lat: number; lng: number; row: GazetteerRow }>();
let coordByKelKecKey = new Map<string, { lat: number; lng: number; row: GazetteerRow }>(); // "kel|kec"
let sortedByKelLengthDesc: GazetteerRow[] = [];
let sortedByKecLengthDesc: GazetteerRow[] = [];

function getCandidates(): string[] {
  return [
    path.join(process.cwd(), 'src', 'config', 'surabaya_sidoarjo_subdistricts.json'),
    path.join(process.cwd(), 'dist', 'config', 'surabaya_sidoarjo_subdistricts.json'),
    path.resolve(__dirname, '../config/surabaya_sidoarjo_subdistricts.json'),
    path.resolve(__dirname, '../../src/config/surabaya_sidoarjo_subdistricts.json'),
    path.resolve(__dirname, '../../../src/config/surabaya_sidoarjo_subdistricts.json'),
  ];
}

function loadRawDataInternal(): GazetteerRow[] {
  if (rawDataCache) return rawDataCache;
  for (const c of getCandidates()) {
    if (fs.existsSync(c)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(c, 'utf-8')) as GazetteerRow[];
        rawDataCache = parsed;
        return parsed;
      } catch (_) {
        continue;
      }
    }
  }
  rawDataCache = [];
  return rawDataCache;
}

function parseKoordinat(koordinat: string): { lat: number; lng: number } | null {
  if (!koordinat) return null;
  const parts = koordinat.split(',');
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function ensureInit(): void {
  if (initialized) return;
  const data = loadRawDataInternal();

  // Build areas map (kelurahan + kecamatan)
  const areaMap = new Map<string, string>();
  const seenKec = new Map<string, string>(); // lower -> orig
  const kelList: GazetteerRow[] = [];
  const kecDedupSet = new Set<string>();

  for (const item of data) {
    if (item.Kelurahan_Desa) {
      const raw = item.Kelurahan_Desa.trim();
      const lower = raw.toLowerCase();
      if (lower.length >= 3 && !['surabaya', 'sidoarjo', 'desa', 'kota'].includes(lower)) {
        if (!areaMap.has(lower)) areaMap.set(lower, raw);
      }
    }
    if (item.Kecamatan) {
      const raw = item.Kecamatan.trim();
      const lower = raw.toLowerCase();
      if (lower.length >= 3 && !['surabaya', 'sidoarjo', 'kota'].includes(lower)) {
        if (!areaMap.has(lower)) areaMap.set(lower, raw);
      }
      if (lower.length >= 3 && !seenKec.has(lower)) {
        seenKec.set(lower, raw);
      }
      if (!kecDedupSet.has(lower)) kecDedupSet.add(lower);
    }
  }
  cachedGazetteerAreas = areaMap;

  // Build kecamatan names / entries
  cachedKecamatanNames = Array.from(seenKec.values());
  cachedKecamatanEntries = Array.from(seenKec.entries()).map(([lower, orig]) => ({ lower, orig }));

  // Build prefix index
  const prefixMap = new Map<string, string[]>();
  const seenPrefix = new Map<string, Set<string>>();
  for (const item of data) {
    const kelurahan = (item.Kelurahan_Desa || '').trim();
    const words = kelurahan.split(/\s+/);
    if (words.length >= 2) {
      const prefix = words[0].toLowerCase();
      if (prefix.length < 3 || ['desa', 'kelurahan', 'kota', 'kabupaten'].includes(prefix)) continue;
      if (!seenPrefix.has(prefix)) seenPrefix.set(prefix, new Set());
      seenPrefix.get(prefix)!.add(kelurahan);
    }
  }
  for (const [prefix, kelSet] of seenPrefix.entries()) {
    const list = Array.from(kelSet);
    if (list.length >= 1) prefixMap.set(prefix, list);
  }
  cachedPrefixIndex = prefixMap;

  // Build coordinate indexes (O(1) maps + sorted lists for substring scan)
  coordByKelLower = new Map();
  coordByKecLower = new Map();
  coordByKelKecKey = new Map();
  for (const row of data) {
    const coord = parseKoordinat(row.Koordinat || '');
    if (!coord) continue;
    const kelLower = (row.Kelurahan_Desa || '').trim().toLowerCase();
    const kecLower = (row.Kecamatan || '').trim().toLowerCase();
    if (kelLower && !coordByKelLower.has(kelLower)) {
      coordByKelLower.set(kelLower, { lat: coord.lat, lng: coord.lng, row });
    }
    if (kecLower && !coordByKecLower.has(kecLower)) {
      coordByKecLower.set(kecLower, { lat: coord.lat, lng: coord.lng, row });
    }
    if (kelLower && kecLower) {
      const key = `${kelLower}|${kecLower}`;
      if (!coordByKelKecKey.has(key)) coordByKelKecKey.set(key, { lat: coord.lat, lng: coord.lng, row });
    }
  }
  // Sorted lists longest first for substring matching (e.g., "sawotratap" before "waru")
  sortedByKelLengthDesc = [...data].sort((a, b) => (b.Kelurahan_Desa || '').length - (a.Kelurahan_Desa || '').length);
  sortedByKecLengthDesc = [...data].sort((a, b) => (b.Kecamatan || '').length - (a.Kecamatan || '').length);

  initialized = true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Raw dataset — cached, no redundant JSON I/O */
export function getGazetteerData(): GazetteerRow[] {
  ensureInit();
  return rawDataCache || [];
}

export function getGazetteerAreas(): Map<string, string> {
  ensureInit();
  return cachedGazetteerAreas!;
}

/**
 * Prefix auto-index: untuk kelurahan 2 kata (misal "Manukan Kulon"),
 * index kata pertamanya ("manukan") → daftar kelurahan lengkap yang berbagi prefix sama.
 */
export function getGazetteerPrefixIndex(): Map<string, string[]> {
  ensureInit();
  return cachedPrefixIndex!;
}

/**
 * Cek apakah sebuah kata tunggal adalah prefix colloquial untuk kelurahan di SBY/SDA.
 */
export function resolvePrefixMatches(singleWord: string): string[] | null {
  const prefixIndex = getGazetteerPrefixIndex();
  const lower = singleWord.toLowerCase().trim();
  const exact = prefixIndex.get(lower);
  if (exact) return exact;
  for (const [prefix, list] of prefixIndex.entries()) {
    if (prefix.length >= 4 && lower.startsWith(prefix) && lower.length >= prefix.length + 2) {
      return list;
    }
  }
  const aliasMap: Record<string, string> = {
    'jemursari': 'jemur',
    'jemur sari': 'jemur',
  };
  const alias = aliasMap[lower];
  if (alias) {
    const aliased = prefixIndex.get(alias);
    if (aliased) return aliased;
  }
  return null;
}

/** Daftar nama kecamatan unik (raw casing) */
export function getGazetteerKecamatanNames(): string[] {
  ensureInit();
  return cachedKecamatanNames ? [...cachedKecamatanNames] : [];
}

/** Daftar kecamatan sebagai { lower, orig } untuk matching toleran-typo */
export function getGazetteerKecamatanEntries(): Array<{ lower: string; orig: string }> {
  ensureInit();
  return cachedKecamatanEntries ? [...cachedKecamatanEntries] : [];
}

/**
 * O(1) / indexed coordinate lookup.
 * - Exact kelurahan lower → hit
 * - Exact kecamatan lower → hit
 * - Substring scan longest-first (kelurahan then kecamatan)
 * Returns lat/lng + row metadata, or null.
 */
export function getGazetteerCoordinates(query: string): { lat: number; lng: number; kelurahan: string; kecamatan: string; kota: string; zipcode: string } | null {
  ensureInit();
  if (!query) return null;
  const qLower = query.toLowerCase();
  const qNorm = qLower.replace(/\s+/g, ' ').trim();

  // Fast exact map lookups (O(1))
  const exactKel = coordByKelLower.get(qNorm);
  if (exactKel) {
    return { lat: exactKel.lat, lng: exactKel.lng, kelurahan: exactKel.row.Kelurahan_Desa, kecamatan: exactKel.row.Kecamatan, kota: exactKel.row.Kabupaten_Kota, zipcode: exactKel.row.Kode_Pos };
  }
  const exactKec = coordByKecLower.get(qNorm);
  if (exactKec) {
    return { lat: exactKec.lat, lng: exactKec.lng, kelurahan: exactKec.row.Kelurahan_Desa, kecamatan: exactKec.row.Kecamatan, kota: exactKec.row.Kabupaten_Kota, zipcode: exactKec.row.Kode_Pos };
  }
  // Substring scan: kelurahan first (longest first)
  for (const row of sortedByKelLengthDesc) {
    const kelLower = (row.Kelurahan_Desa || '').toLowerCase().trim();
    if (!kelLower || kelLower.length < 3) continue;
    if (qLower.includes(kelLower)) {
      const coord = parseKoordinat(row.Koordinat);
      if (coord) return { lat: coord.lat, lng: coord.lng, kelurahan: row.Kelurahan_Desa, kecamatan: row.Kecamatan, kota: row.Kabupaten_Kota, zipcode: row.Kode_Pos };
    }
  }
  for (const row of sortedByKecLengthDesc) {
    const kecLower = (row.Kecamatan || '').toLowerCase().trim();
    if (!kecLower || kecLower.length < 3) continue;
    if (qLower.includes(kecLower)) {
      const coord = parseKoordinat(row.Koordinat);
      if (coord) return { lat: coord.lat, lng: coord.lng, kelurahan: row.Kelurahan_Desa, kecamatan: row.Kecamatan, kota: row.Kabupaten_Kota, zipcode: row.Kode_Pos };
    }
  }
  return null;
}

/**
 * Thin zipcode delegate — resolves via central data so resolver can delegate.
 * For full 3-layer logic use gazetteer-zipcode-resolver.ts (which itself now delegates to this dataset).
 */
export function getGazetteerZipcode(query: string): string | null {
  const hit = getGazetteerCoordinates(query);
  return hit ? hit.zipcode : null;
}

/** Reset all caches — for tests that mock dataset */
export function __resetGazetteerCache(): void {
  initialized = false;
  rawDataCache = null;
  cachedGazetteerAreas = null;
  cachedPrefixIndex = null;
  cachedKecamatanNames = null;
  cachedKecamatanEntries = null;
  coordByKelLower = new Map();
  coordByKecLower = new Map();
  coordByKelKecKey = new Map();
  sortedByKelLengthDesc = [];
  sortedByKecLengthDesc = [];
  try {
    // Also reset dependent resolver cache so next resolveZipcode re-reads fresh central data
    const resolver = require('./gazetteer-zipcode-resolver') as { __resetGazetteerResolverCache?: () => void };
    if (resolver && typeof resolver.__resetGazetteerResolverCache === 'function') {
      resolver.__resetGazetteerResolverCache();
    }
  } catch {}
}

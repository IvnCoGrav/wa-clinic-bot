import fs from 'fs';
import path from 'path';
import { resolveArteryCorridor } from '../config/landmarks';
import {
  normalizeToponymAbbreviations,
  extractCityScope,
  getCanonicalCities,
} from './toponym-normalizer';
import { isTypoAtMostOne, GEO_TOKEN_SKIPLIST } from './typo-match';

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
let cachedCanonicalCities: string[] = [];

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

  // Kanonis kota (data-driven) — dipakai extractCityScope di setiap query.
  cachedCanonicalCities = getCanonicalCities(rawDataCache || []);

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

/** Nama kota kanonis unik dari dataset (cache sekali boot) — untuk city scope. */
export function getGazetteerCanonicalCities(): string[] {
  ensureInit();
  return [...cachedCanonicalCities];
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
  const qNorm = normalizeToponymAbbreviations(query).replace(/\s+/g, ' ').trim();
  const cityScope = extractCityScope(qNorm, getGazetteerCanonicalCities());
  if (!qNorm) return null;

  // Koridor arteri (Plan 6 FASE 3, Issue #21): nama jalan populer tanpa "Jl."
  // langsung terpetakan ke kelurahan induk — tanpa menodong customer.
  // Koordinat tetap dari dataset (single source); rantai fallback:
  // kelurahan koridor → kecamatan koridor → logika eksisting di bawah.
  const corridor = resolveArteryCorridor(qNorm);
  if (corridor) {
    const kelHit = coordByKelLower.get(corridor.kelurahan.toLowerCase());
    if (kelHit) {
      return { lat: kelHit.lat, lng: kelHit.lng, kelurahan: kelHit.row.Kelurahan_Desa, kecamatan: kelHit.row.Kecamatan, kota: kelHit.row.Kabupaten_Kota, zipcode: kelHit.row.Kode_Pos };
    }
    const kecHit = coordByKecLower.get(corridor.kecamatan.toLowerCase());
    if (kecHit) {
      return { lat: kecHit.lat, lng: kecHit.lng, kelurahan: kecHit.row.Kelurahan_Desa, kecamatan: kecHit.row.Kecamatan, kota: kecHit.row.Kabupaten_Kota, zipcode: kecHit.row.Kode_Pos };
    }
  }

  // Fast exact map lookups (O(1)) — city-aware: bila query menyebut kota dan
  // exact-hit bertentangan kota, biarkan ranked scan menentukannya (jangan return).
  const exactKel = coordByKelLower.get(qNorm);
  if (exactKel) {
    if (!cityScope || exactKel.row.Kabupaten_Kota === cityScope) {
      return { lat: exactKel.lat, lng: exactKel.lng, kelurahan: exactKel.row.Kelurahan_Desa, kecamatan: exactKel.row.Kecamatan, kota: exactKel.row.Kabupaten_Kota, zipcode: exactKel.row.Kode_Pos };
    }
  }
  const exactKec = coordByKecLower.get(qNorm);
  if (exactKec) {
    if (!cityScope || exactKec.row.Kabupaten_Kota === cityScope) {
      return { lat: exactKec.lat, lng: exactKec.lng, kelurahan: exactKec.row.Kelurahan_Desa, kecamatan: exactKec.row.Kecamatan, kota: exactKec.row.Kabupaten_Kota, zipcode: exactKec.row.Kode_Pos };
    }
  }

  return rankedGazetteerScan(qNorm, cityScope);
}

/**
 * Thin zipcode delegate — resolves via central data so resolver can delegate.
 * For full 3-layer logic use gazetteer-zipcode-resolver.ts (which itself now delegates to this dataset).
 */
export function getGazetteerZipcode(query: string): string | null {
  const hit = getGazetteerCoordinates(query);
  return hit ? hit.zipcode : null;
}

// ---------------------------------------------------------------------------
// Ranked phrase-hit scan (Fondasional: city scope + anti-subtoken hijack)
// ---------------------------------------------------------------------------
interface PhraseCandidate {
  row: GazetteerRow;
  level: 'kelurahan' | 'kecamatan';
  phrase: string;
  start: number;
  end: number;
}

function boundedMatchIndex(qNorm: string, phrase: string): { start: number; end: number } | null {
  const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`);
  const m = re.exec(qNorm);
  if (!m) return null;
  return { start: m.index, end: m.index + phrase.length };
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Pencocokan frase berbatas kata (word boundary) + partisi scope kota +
 * anti-subtoken hijack generik + ranking deterministik.
 * - Anti-subtoken hijack: tolak kelurahan 1 kata yang span-nya tertutup penuh
 *   oleh frasa kandidat lebih panjang (misal "kupang" ⊂ frasa majemuk) —
 *   generik, tanpa daftar token.
 * - City scope: bila query menyebut kota, entri kota lain DIDISKUALIFIKASI.
 * - Ranking: jumlah kata desc → kecamatan-cocok-yang-disebut desc → panjang
 *   frase desc → kelurahan > kecamatan.
 */
function rankedGazetteerScan(
  qNorm: string,
  cityScope: string | null
): { lat: number; lng: number; kelurahan: string; kecamatan: string; kota: string; zipcode: string } | null {
  const rows = rawDataCache || [];
  const candidates: PhraseCandidate[] = [];
  const alreadyMatchedPhrases = new Set<string>();

  for (const row of rows) {
    const kec = (row.Kecamatan || '').toLowerCase().trim();
    if (kec && kec.length >= 3) {
      const km = boundedMatchIndex(qNorm, kec);
      if (km) {
        candidates.push({ row, level: 'kecamatan', phrase: kec, start: km.start, end: km.end });
        alreadyMatchedPhrases.add(`kec:${kec}`);
      }
    }
    const kel = (row.Kelurahan_Desa || '').toLowerCase().trim();
    if (kel && kel.length >= 3 && kel !== kec && !['surabaya', 'sidoarjo', 'gresik', 'desa', 'kota', 'kabupaten'].includes(kel)) {
      const km = boundedMatchIndex(qNorm, kel);
      if (km) {
        candidates.push({ row, level: 'kelurahan', phrase: kel, start: km.start, end: km.end });
        alreadyMatchedPhrases.add(`kel:${kel}`);
      }
    }
  }

  // Fase 2: fallback typo generik 1-edit untuk kelurahan/kecamatan single-word (tanpa hardcode desa)
  // Contoh: 'damarsih' (typo) → 'damarsi'. Hanya token ≥4 huruf, bukan skiplist, dan tidak sudah exact-match.
  if (qNorm && qNorm.length >= 3) {
    const qTokens = qNorm
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !GEO_TOKEN_SKIPLIST.has(t));
    if (qTokens.length > 0) {
      const findTypoIndex = (phraseLower: string): { start: number; end: number } | null => {
        if (phraseLower.includes(' ') || phraseLower.length < 4) return null;
        for (const tok of qTokens) {
          if (isTypoAtMostOne(tok, phraseLower)) {
            // cari posisi token di qNorm (first occurrence)
            const idx = qNorm.toLowerCase().indexOf(tok);
            if (idx !== -1) return { start: idx, end: idx + tok.length };
          }
        }
        return null;
      };
      for (const row of rows) {
        const kec = (row.Kecamatan || '').toLowerCase().trim();
        if (kec && kec.length >= 4 && !alreadyMatchedPhrases.has(`kec:${kec}`)) {
          const typoIdx = findTypoIndex(kec);
          if (typoIdx) {
            candidates.push({ row, level: 'kecamatan', phrase: kec, start: typoIdx.start, end: typoIdx.end });
            alreadyMatchedPhrases.add(`kec:${kec}`);
          }
        }
        const kel = (row.Kelurahan_Desa || '').toLowerCase().trim();
        if (kel && kel.length >= 4 && kel !== kec && !['surabaya', 'sidoarjo', 'gresik', 'desa', 'kota', 'kabupaten'].includes(kel) && !alreadyMatchedPhrases.has(`kel:${kel}`)) {
          const typoIdx = findTypoIndex(kel);
          if (typoIdx) {
            candidates.push({ row, level: 'kelurahan', phrase: kel, start: typoIdx.start, end: typoIdx.end });
            alreadyMatchedPhrases.add(`kel:${kel}`);
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Coverage guard (generic): tolak kelurahan 1 kata yang tertutup frasa lebih panjang.
  const kept = candidates.filter((c) => {
    if (c.level !== 'kelurahan' || c.phrase.includes(' ')) return true;
    return !candidates.some((o) => o.phrase.length > c.phrase.length && o.start <= c.start && o.end >= c.end);
  });
  if (kept.length === 0) return null;

  // Partisi scope kota.
  const scoped = cityScope ? kept.filter((c) => c.row.Kabupaten_Kota === cityScope) : kept;
  if (cityScope && scoped.length === 0) return null;

  // Anti-homonim hijacking: token kota ("sidoarjo"/"gresik") jangan kalahkan distrik spesifik karena panjang karakter.
  // cityBaseTokens data-driven dari dataset (tanpa hardcode).
  const canonicalCities = getGazetteerCanonicalCities();
  const cityBaseTokens = new Set(
    canonicalCities.map((c) => c.toLowerCase().replace(/^(kabupaten|kota)\s+/i, '').trim().replace(/[()]/g, '').replace(/\s+/g, ' ').trim())
  );
  const normalizeParen = (s: string): string => s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  const isSpecificDistrict = (c: PhraseCandidate): boolean => !cityBaseTokens.has(normalizeParen(c.phrase));

  const kecMentioned = (c: PhraseCandidate): boolean =>
    !!c.row.Kecamatan && boundedMatchIndex(qNorm, c.row.Kecamatan.toLowerCase().trim()) != null;

  const best = scoped.reduce<PhraseCandidate | null>((bestSoFar, c) => {
    if (!bestSoFar) return c;
    const a = [wordCount(c.phrase), c.level === 'kelurahan' ? 1 : 0, isSpecificDistrict(c) ? 1 : 0, kecMentioned(c) ? 1 : 0, c.phrase.length];
    const b = [wordCount(bestSoFar.phrase), bestSoFar.level === 'kelurahan' ? 1 : 0, isSpecificDistrict(bestSoFar) ? 1 : 0, kecMentioned(bestSoFar) ? 1 : 0, bestSoFar.phrase.length];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] > b[i] ? c : bestSoFar;
    }
    return bestSoFar;
  }, null);
  if (!best) return null;

  const coord = parseKoordinat(best.row.Koordinat || '');
  if (!coord) return null;
  return {
    lat: coord.lat,
    lng: coord.lng,
    kelurahan: best.row.Kelurahan_Desa,
    kecamatan: best.row.Kecamatan,
    kota: best.row.Kabupaten_Kota,
    zipcode: best.row.Kode_Pos,
  };
}

/** Hasil pencocokan spasial terbalik terdekat (reverse geocoding lokal). */
export interface NearestSubdistrictMatch {
  kelurahan: string;
  kecamatan: string;
  kota: string;
  zipcode: string;
  distanceKm: number;
  lat: number;
  lng: number;
}

/** Jarak Haversine antar dua titik koordinat (km). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

/**
 * Reverse geocoding lokal: cari kelurahan/desa terdekat dari koordinat
 * terhadap dataset gazetteer (local-first, tanpa API).
 * Di luar radius operasional (default 35 km) kembalikan null —
 * pemanggil WAJIB meneruskan koordinat murni tanpa mengarang nama wilayah.
 */
export function findNearestSubdistrict(
  lat: number,
  lng: number,
  maxDistanceKm = 35
): NearestSubdistrictMatch | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  ensureInit();
  const data = rawDataCache || [];
  let best: GazetteerRow | null = null;
  let bestLat = 0;
  let bestLng = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const row of data) {
    const coord = parseKoordinat(row.Koordinat || '');
    if (!coord) continue;
    const dist = haversineKm(lat, lng, coord.lat, coord.lng);
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
      bestLat = coord.lat;
      bestLng = coord.lng;
    }
  }
  if (!best || bestDist > maxDistanceKm) return null;
  return {
    kelurahan: (best.Kelurahan_Desa || '').trim(),
    kecamatan: (best.Kecamatan || '').trim(),
    kota: (best.Kabupaten_Kota || '').trim(),
    zipcode: (best.Kode_Pos || '').trim(),
    distanceKm: bestDist,
    lat: bestLat,
    lng: bestLng,
  };
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

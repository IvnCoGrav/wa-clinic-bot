import fs from 'fs';
import path from 'path';

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let cachedGazetteerAreas: Map<string, string> | null = null;
let cachedPrefixIndex: Map<string, string[]> | null = null;

export function getGazetteerAreas(): Map<string, string> {
  if (cachedGazetteerAreas) return cachedGazetteerAreas;
  const map = new Map<string, string>();
  try {
    const candidates = [
      path.join(process.cwd(), 'src', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.join(process.cwd(), 'dist', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../config/surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../../src/config/surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../../../src/config/surabaya_sidoarjo_subdistricts.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const data = JSON.parse(fs.readFileSync(c, 'utf-8'));
        for (const item of data) {
          if (item.Kelurahan_Desa) {
            const raw = item.Kelurahan_Desa.trim();
            const lower = raw.toLowerCase();
            if (lower.length >= 3 && !['surabaya', 'sidoarjo', 'desa', 'kota'].includes(lower)) {
              map.set(lower, raw);
            }
          }
          if (item.Kecamatan) {
            const raw = item.Kecamatan.trim();
            const lower = raw.toLowerCase();
            if (lower.length >= 3 && !['surabaya', 'sidoarjo', 'kota'].includes(lower)) {
              map.set(lower, raw);
            }
          }
        }
        break;
      }
    }
  } catch (_) {}
  cachedGazetteerAreas = map;
  return map;
}

/**
 * Prefix auto-index: untuk kelurahan 2 kata (misal "Manukan Kulon"),
 * index kata pertamanya ("manukan") → daftar kelurahan lengkap yang berbagi prefix sama.
 * Dipakai untuk colloquial truncation: customer bilang "Manukan" → match Manukan Kulon/Wetan.
 */
export function getGazetteerPrefixIndex(): Map<string, string[]> {
  if (cachedPrefixIndex) return cachedPrefixIndex;
  const prefixMap = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>(); // prefix -> Set of full kelurahan names (dedup)
  try {
    const candidates = [
      path.join(process.cwd(), 'src', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.join(process.cwd(), 'dist', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../config/surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../../src/config/surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../../../src/config/surabaya_sidoarjo_subdistricts.json'),
    ];
    let data: any[] | null = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        data = JSON.parse(fs.readFileSync(c, 'utf-8'));
        break;
      }
    }
    if (data) {
      for (const item of data) {
        const kelurahan = (item.Kelurahan_Desa || '').trim();
        const words = kelurahan.split(/\s+/);
        if (words.length >= 2) {
          const prefix = words[0].toLowerCase();
          // Hanya prefix yang bermakna (>=3 huruf, bukan stop word)
          if (prefix.length < 3 || ['desa', 'kelurahan', 'kota', 'kabupaten'].includes(prefix)) continue;
          if (!seen.has(prefix)) seen.set(prefix, new Set());
          seen.get(prefix)!.add(kelurahan);
        }
      }
      for (const [prefix, kelurahanSet] of seen.entries()) {
        // Hanya index prefix yang punya >=2 kelurahan dengan prefix sama ATAU prefix unik tapi bermakna
        // Untuk "manukan" → [Manukan Kulon, Manukan Wetan] (2 entries, perlu disambiguasi)
        // Untuk "medokan" → [Medokan Ayu, Medokan Semampir] (2 entries)
        // Untuk "kutisari" → [Kutisari] (1 entry, tapi tetap berguna untuk single-word match)
        const list = Array.from(kelurahanSet);
        if (list.length >= 1) {
          prefixMap.set(prefix, list);
        }
      }
    }
  } catch (_) {}
  cachedPrefixIndex = prefixMap;
  return prefixMap;
}

/**
 * Cek apakah sebuah kata tunggal adalah prefix colloquial untuk kelurahan di SBY/SDA.
 * Return daftar kelurahan lengkap yang match prefix tersebut.
 * Juga handle colloquial merged forms: "jemursari" → "jemur" (prefix of query).
 */
export function resolvePrefixMatches(singleWord: string): string[] | null {
  const prefixIndex = getGazetteerPrefixIndex();
  const lower = singleWord.toLowerCase().trim();
  // Exact match
  const exact = prefixIndex.get(lower);
  if (exact) return exact;
  // Colloquial merged: query starts with a known prefix (e.g., "jemursari" starts with "jemur")
  // Hanya jika prefix >=4 huruf untuk hindari false positive
  for (const [prefix, list] of prefixIndex.entries()) {
    if (prefix.length >= 4 && lower.startsWith(prefix) && lower.length >= prefix.length + 2) {
      return list;
    }
  }
  // Alias eksplisit untuk kasus khusus yang tidak ter-cover prefix
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

/**
 * customer-name-healing.ts
 * Helper MURNI (pure, unit-testable) untuk skrip sanitasi
 * `src/scripts/sanitize-customer-names-and-kelurahan.ts`.
 * DILARANG menaruh query DB di sini — semua fungsi hanya transformasi string.
 */
import { escapeRegex } from './gazetteer';

// Gerbang pencemaran kolom kelurahan dipusatkan di `kelurahan-guard` (pure,
// bebas dataset) agar dapat dipanggil hot-path service tanpa menyeret gazetteer.
// Re-export demi kompatibilitas pemanggil lama (skrip sanitasi & test).
export { isCorruptedKelurahan, sanitizeKelurahanInput } from './kelurahan-guard';

/**
 * Kelupas suffix wilayah di akhir nama ("Bunda Retno Gedangan" → "Bunda Retno").
 * Mengembalikan distrik terluar yang terkelupas (daftar pre-sort desc by length).
 */
export function stripTrailingDistrict(
  name: string,
  districts: string[]
): { cleanName: string; district: string | null } {
  let cur = (name || '').trim();
  let found: string | null = null;
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of districts) {
      const re = new RegExp(`\\s+${escapeRegex(d)}$`, 'i');
      if (re.test(cur)) {
        if (!found) found = cur.match(re)?.[0]?.trim() || d;
        cur = cur.replace(re, '').trim();
        changed = true;
        break;
      }
    }
  }
  return { cleanName: cur, district: found };
}

/** Kapitalisasi tiap kata ("gedangan" → "Gedangan"). */
export function toTitleCase(s: string): string {
  return (s || '')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/**
 * Format nama orang dengan mempertahankan sapaan Bunda / Ayah di awal:
 * "bunda anggi zulfika" -> "Bunda Anggi Zulfika"
 * "ayah rudi" -> "Ayah Rudi"
 * "anggi zulfika" -> "Anggi Zulfika"
 */
export function toTitleCasePreservingPrefix(name: string): string {
  const m = /^(bunda|ayah)\s+(.*)$/i.exec((name || '').trim());
  if (!m) return toTitleCase(name);
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${toTitleCase(m[2])}`;
}

/**
 * Pastikan prefix sapaan Bunda / Ayah di awal berhuruf kapital, tanpa
 * merusak kapitalisasi asli nama (mis. gelar S.Kep atau casing khusus).
 */
export function normalizeHonorificPrefix(name: string): string {
  const m = /^(bunda|ayah)\s+(.*)$/i.exec((name || '').trim());
  if (!m) return (name || '').trim();
  const prefix = m[1].toLowerCase() === 'ayah' ? 'Ayah' : 'Bunda';
  return `${prefix} ${m[2].trim()}`;
}

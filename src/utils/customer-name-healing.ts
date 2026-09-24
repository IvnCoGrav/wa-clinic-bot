/**
 * customer-name-healing.ts
 * Helper MURNI (pure, unit-testable) untuk skrip sanitasi
 * `src/scripts/sanitize-customer-names-and-kelurahan.ts`.
 * DILARANG menaruh query DB di sini — semua fungsi hanya transformasi string.
 */
import { escapeRegex } from './gazetteer';

/** Pola pencemaran kolom kelurahan: URL maps / alamat jalan fisik / RT-RW. */
const CORRUPTION_PATTERNS = /https?:\/\/|goo\.gl|maps|\bjl\.|\bjalan\b|\bblok\b|\bgang\b|\brt\s*\d|\brw\s*\d|\bno\.\s*\d/i;

/**
 * True bila nilai kelurahan tercemar (URL, alamat jalan, atau terlalu panjang
 * untuk nama desa/kelurahan resmi).
 */
export function isCorruptedKelurahan(v: string | null | undefined): boolean {
  const s = (v || '').trim();
  if (!s) return false;
  if (s.length > 40) return true;
  return CORRUPTION_PATTERNS.test(s);
}

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

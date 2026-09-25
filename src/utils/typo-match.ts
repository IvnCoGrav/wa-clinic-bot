/**
 * typo-match.ts — Utilitas typo 1-huruf terpusat (Levenshtein ≤1).
 * Satu sumber kebenaran untuk masker pre-LLM dan tool geocoding.
 * Non-semantik: komparasi token teknis, diizinkan mandat regex.
 */

export function isTypoAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (la === lb) { i++; j++; } else if (la > lb) { i++; } else { j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

export const GEO_TOKEN_SKIPLIST = new Set([
  'kota', 'desa', 'jawa', 'timur', 'kecamatan', 'kabupaten',
  'surabaya', 'sidoarjo', 'gresik', 'sby', 'sda',
  // Kata benda generik area — DILARANG di-typo-match ke nama asli (mis. 'kawasan' 1-edit dari 'kapasan'
  // menghalusinasi 'Kawasan Tak Dikenal XYZ' → Kapasan; google-contacts.test.ts TC-08b).
  'kawasan', 'wilayah', 'daerah', 'area',
]);

export function isSkippedGeoToken(t: string): boolean {
  return GEO_TOKEN_SKIPLIST.has(t);
}

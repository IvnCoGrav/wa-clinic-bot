/**
 * env-numeric.ts — Helper parsing env numerik dengan fail-closed.
 *
 * `parseInt`/`Number` mentah pada env menghasilkan NaN/negatif/nol yang merambat
 * diam-diam (mis. timeout 0ms → request langsung timeout; batch limit -5 →
 * loop kosong). Helper ini memaksa fallback default untuk nilai tidak valid.
 */

/** Parse env sebagai integer POSITIF (> 0). NaN, <=0, atau non-integer → fallback. */
export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
  return n;
}

/** Parse env sebagai angka NON-NEGATIF (>= 0). NaN/negatif → fallback. */
export function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Parser pencarian LiveChat presisi boundary (Matt Pocock: Parse, Don't Validate).
 *
 * Memecah query mentah pengguna menjadi discriminated union yang aman:
 * - `unit_boundary`: angka + satuan (7km, 7 km, 100rb, 3hari, 30mnt) — anti "17km" ikut cocok.
 * - `phone_digits`: nomor telepon murni (digit + spasi/-/+) — pencarian contains digit.
 * - `word_boundary`: kata/frasa umum dengan word boundary — anti substring overlap.
 * - `empty`: query kosong.
 *
 * Seluruh konstruksi regex memakai `escapeRegExp` sehingga karakter khusus
 * (`(`, `[`, `+`, `?`, `\`, `.` …) tidak pernah melempar SyntaxError (ReDoS-proof).
 * Batas panjang query (MAX_QUERY_LEN) menjaga event-loop dari pola raksasa.
 */

export const MAX_SEARCH_QUERY_LEN = 100;

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type ParsedSearchQuery =
  | {
      kind: 'unit_boundary';
      original: string;
      value: number;
      unit: string;
      jsRegex: RegExp;
      pgRegex: string;
    }
  | { kind: 'phone_digits'; original: string; cleanDigits: string }
  | { kind: 'word_boundary'; original: string; jsRegex: RegExp; pgRegex: string }
  | { kind: 'empty' };

function truncateQuery(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.length > MAX_SEARCH_QUERY_LEN ? trimmed.slice(0, MAX_SEARCH_QUERY_LEN) : trimmed;
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  if (!raw) return { kind: 'empty' };
  const trimmed = truncateQuery(raw);
  if (!trimmed) return { kind: 'empty' };

  // 1. Angka + satuan: "7km", "7 km", "100rb", "3hari", "30mnt", "2 jam"
  const unitMatch = trimmed.match(/^(\d+)\s*([a-zA-Z]+)$/);
  if (unitMatch) {
    const val = parseInt(unitMatch[1], 10);
    if (!Number.isSafeInteger(val)) return { kind: 'empty' };
    const rawUnit = unitMatch[2].slice(0, 20);
    const unitEscaped = escapeRegExp(rawUnit);
    // JS: (^|[^\d])7\s*km(?!\w) — digit kiri anti "17km", \w kanan anti "7kml"
    const jsRegex = new RegExp(`(^|[^\\d])${val}\\s*${unitEscaped}(?!\\w)`, 'i');
    // PostgreSQL POSIX: (^|[^0-9])7[[:space:]]*km([^a-zA-Z0-9]|$)
    const pgRegex = `(^|[^0-9])${val}[[:space:]]*${unitEscaped}([^a-zA-Z0-9]|$)`;
    return { kind: 'unit_boundary', original: trimmed, value: val, unit: rawUnit, jsRegex, pgRegex };
  }

  // 2. Nomor telepon murni: hanya digit + pemisah umum (spasi, -, +)
  const strippedSeparators = trimmed.replace(/[\s\-+().]/g, '');
  const cleanDigits = trimmed.replace(/\D/g, '');
  if (cleanDigits.length >= 3 && /^\d+$/.test(strippedSeparators)) {
    return { kind: 'phone_digits', original: trimmed, cleanDigits };
  }

  // 3. Kata/frasa umum dengan word boundary
  const escaped = escapeRegExp(trimmed);
  const jsRegex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'i');
  const pgRegex = `(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`;
  return { kind: 'word_boundary', original: trimmed, jsRegex, pgRegex };
}

/**
 * Uji konten pesan terhadap hasil parsing (dipakai fallback in-memory store).
 * `phone_digits` memakai contains digit sederhana; boundary memakai jsRegex.
 */
export function matchesParsedContent(parsed: ParsedSearchQuery, content: string): boolean {
  if (parsed.kind === 'empty') return true;
  if (!content) return false;
  if (parsed.kind === 'phone_digits') {
    const digits = content.replace(/\D/g, '');
    return digits.includes(parsed.cleanDigits);
  }
  try {
    // RegExp global tidak dipakai di sini (tanpa flag g) sehingga .test stateless.
    return parsed.jsRegex.test(content);
  } catch {
    return false;
  }
}

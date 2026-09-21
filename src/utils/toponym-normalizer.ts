/**
 * toponym-normalizer.ts
 * Normalisasi leksikal toponimi & ekstraksi hierarki kota (semantics deterministik).
 * Murni LINGUISTIK — TIDAK berisi data bisnis (nama jalan/kawasan/kelurahan,
 * daftar kota kanonis di-generate dari dataset). Satu-satunya pengecualian:
 * singkatan alias kota kelas tertutup (sby/sda) — lihat TOWN_ALIASES.
 */

// Alias kota kelas tertutup (toponim singkat — sejajar gn/gg/jl, bukan data bisnis).
// Arah "teks pengguna -> token proper". Override tenant (nama kota dari DB)
// diatur di panggil: hasil alias diverifikasi terhadap knownCities yang diberi.
export const TOWN_ALIASES: Record<string, string> = {
  sby: 'surabaya',
  sda: 'sidoarjo',
};

const ABBREVIATION_RULES: Array<{ re: RegExp; replacement: string }> = [
  { re: /\bgn\.?(?![a-z0-9])/g, replacement: 'gunung' },
  { re: /\bgg\.?(?![a-z0-9])/g, replacement: 'gang' },
  { re: /\bjln?\.?(?![a-z0-9])/g, replacement: 'jalan' },
  { re: /\bds\.?(?![a-z0-9])/g, replacement: 'desa' },
  { re: /\bkel\.?(?![a-z0-9])/g, replacement: 'kelurahan' },
  { re: /\bkec\.?(?![a-z0-9])/g, replacement: 'kecamatan' },
];

/**
 * Ekspansi singkatan baku toponimi Indonesia dengan word boundary.
 * "Kupang gn barat gg 3" -> "kupang gunung barat gang 3".
 */
export function normalizeToponymAbbreviations(text: string): string {
  if (!text) return '';
  let out = text.toLowerCase();
  for (const rule of ABBREVIATION_RULES) {
    out = out.replace(rule.re, rule.replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Ambil token proper dari nama kota kanonis (buang imbuhan administratif). */
function cityPropertyTokens(cityName: string): string[] {
  return cityName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && w !== 'kota' && w !== 'kabupaten');
}

/** Escape literal untuk disisipkan ke RegExp (tanpa import lintas modul). */
function escapeToken(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Daftar nama kota kanonis UNIK dari dataset gazetteer (data-driven).
 * Tidak ada literal nama kota di pemanggil; kanonis = string persis kolom Kabupaten_Kota.
 */
export function getCanonicalCities(
  rows: Array<{ Kabupaten_Kota?: string }>
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const city = (row.Kabupaten_Kota || '').trim();
    if (city) set.add(city);
  }
  return Array.from(set).sort();
}

/**
 * Deteksi scope kota induk secara deterministik dari teks query.
 * - Cocokkan token proper (surabaya/sidoarjo/gresik) + alias sby/sda.
 * - Verifikasi hasil TERHADAP daftar kanonis yang diberikan (data-driven).
 * - Bila beberapa kota disebut, yang terakhir menang (last-mention wins).
 * - Tanpa sebutan kota -> null (bukan tebakan).
 */
export function extractCityScope(
  text: string,
  knownCities: string[]
): string | null {
  if (!text || knownCities.length === 0) return null;
  const lower = text.toLowerCase();
  const hits: Array<{ index: number; city: string }> = [];

  const getCity = (token: string): string | null =>
    knownCities.find((c) => cityPropertyTokens(c).includes(token)) || null;

  for (const city of knownCities) {
    const name = cityPropertyTokens(city).join(' ');
    if (!name) continue;
    const re = new RegExp(`\\b${escapeToken(name)}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      hits.push({ index: m.index, city });
    }
  }

  for (const [alias, token] of Object.entries(TOWN_ALIASES)) {
    const re = new RegExp(`\\b${escapeToken(alias)}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const city = getCity(token);
      if (city) hits.push({ index: m.index, city });
    }
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index);
  return hits[hits.length - 1].city;
}
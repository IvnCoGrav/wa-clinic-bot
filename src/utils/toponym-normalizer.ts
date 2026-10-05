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
 * Ekspansi singkatan baku toponimi Indonesia dengan word boundary, TANPA
 * merendahkan huruf (case-preserving). Dipakai hot-path sanitasi NAMA customer
 * agar "Kec. Sawahan" → "Kecamatan Sawahan" sehingga gerbang wilayah
 * deterministik (bukan regex hafalan per-kasus) dapat mengelupasnya.
 * "Bunda Dewy Kec. Sawahan" -> "Bunda Dewy Kecamatan Sawahan".
 */
export function expandToponymAbbreviations(text: string): string {
  if (!text) return '';
  let out = text;
  for (const rule of ABBREVIATION_RULES) {
    const re = new RegExp(rule.re.source, 'gi');
    out = out.replace(re, (m) => {
      const first = m[0];
      const upper = first === first.toUpperCase() && first !== first.toLowerCase();
      return upper ? rule.replacement[0].toUpperCase() + rule.replacement.slice(1) : rule.replacement;
    });
  }
  return out.replace(/\s+/g, ' ').trim();
}

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

// ---------------------------------------------------------------------------
// Toponimi MAJEMUK (data-driven): dataset menulis nama kelurahan gabungan
// sebagai SATU kata ("Tambakoso", "Pepelegi", "Sawotratap"), sedangkan
// customer/admin sering mengetik dengan spasi ("tambak oso", "pepe legi").
// Pencocokan word-boundary eksak gagal → fallback kecamatan membajak lokasi.
//
// Solusi: generator indeks morfologis yang MENGURAI setiap nama 1-kata menjadi
// varian spasi kanonis, dibangun sekali dari dataset (tanpa hardcode nama).
// ---------------------------------------------------------------------------

/**
 * Bangun peta varian spasi → nama kanonis dari seluruh baris dataset.
 * Contoh: "tambak oso" -> "Tambakoso", "pepe legi" -> "Pepelegi".
 *
 * Aturan:
 * - Hanya nama kelurahan 1-kata (panjang >= 6) yang diurai.
 * - Setiap belahan harus >= 3 huruf (hindari morfem terlalu pendek/berisik).
 * - Kunci yang BERTABRAKAN dengan nama kelurahan 2-kata resmi dilewati, agar
 *   "kali rungkut" tidak dipaksa menjadi "Kalirungkut" bila keduanya sah.
 */
export function buildCompoundToponymMap(
  rows: Array<{ Kelurahan_Desa?: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  const existing = new Set<string>();
  for (const row of rows) {
    const k = (row.Kelurahan_Desa || '').trim().toLowerCase();
    if (k) existing.add(k);
  }
  for (const row of rows) {
    const kel = (row.Kelurahan_Desa || '').trim();
    if (!kel || kel.includes(' ')) continue;
    const low = kel.toLowerCase();
    if (low.length < 6) continue;
    for (let i = 3; i <= low.length - 3; i++) {
      const key = `${low.slice(0, i)} ${low.slice(i)}`;
      if (existing.has(key)) continue;
      if (!map.has(key)) map.set(key, kel);
    }
  }
  return map;
}

/**
 * Terapkan normalisasi toponimi majemuk pada teks: ganti frasa berspasi dengan
 * nama kanonis (lowercase). Mendukung juga bentuk terpotong pada token terakhir
 * (mis. "tambak os" -> "Tambakoso") HANYA bila kandidatnya UNIK di leksikon —
 * mencegah pembajakan ambigu (mis. "tambak s" tidak diselesaikan).
 */
export function normalizeCompoundToponym(
  text: string,
  map: Map<string, string>
): string {
  if (!text || map.size === 0) return text;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return text;

  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    const nxt = i + 1 < tokens.length ? tokens[i + 1].toLowerCase() : '';
    if (nxt) {
      const exact = map.get(`${t} ${nxt}`);
      if (exact) {
        out.push(exact.toLowerCase());
        i++;
        continue;
      }
      // Bentuk terpotong: token terakhir pendek & unik di leksikon.
      if (nxt.length >= 2) {
        let found: string | null = null;
        let count = 0;
        for (const [k, v] of map) {
          const sp = k.indexOf(' ');
          if (sp < 0 || k.slice(0, sp) !== t) continue;
          const second = k.slice(sp + 1);
          if (second !== nxt && second.startsWith(nxt)) {
            count++;
            found = v;
            if (count > 1) break;
          }
        }
        if (count === 1 && found) {
          out.push(found.toLowerCase());
          i++;
          continue;
        }
      }
    }
    out.push(tokens[i].toLowerCase());
  }
  return out.join(' ');
}
/**
 * entity-concatenation-guard.ts
 *
 * RC-4 (sesi 535222): Router Call 1 dapat menggabungkan entitas wilayah LAMA
 * (kecamatan yang sudah diketahui sesi) dengan entitas BARU yang disebut
 * customer menjadi string artifisial — mis. "Buduran Bungurasih". String ini
 * salah secara geografis: customer TIDAK pindah ke perbatasan dua wilayah,
 * ia sedang menjawab pertanyaan tentang tempat barunya.
 *
 * Guard ini membuang prefiks wilayah basi secara DETERMINISTIK: hanya prefiks
 * yang benar-benar merupakan wilayah yang SUDAH DIKETAHUI sesi (kecamatan/
 * kelurahan), bukan sembarang nama kecamatan. Bila keraguan muncul (mis. hasil
 * strip kosong), string asli dikembalikan utuh — fail-open demi keamanan.
 */

export interface KnownRegion {
  kecamatan?: string | null;
  kelurahan?: string | null;
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Buang prefiks nama wilayah basi (kecamatan/kelurahan yang sudah diketahui
 * sesi) dari `locationText`, menyisakan hanya entitas baru.
 *
 * Contoh: ("Buduran Bungurasih", { kecamatan: 'Buduran' }) → "Bungurasih".
 * Mendukung wilayah basi multi-kata (mis. "Tenggilis Mejoyo X").
 *
 * Aturan aman:
 * - Tanpa regionKnown → kembalikan apa adanya.
 * - Hanya strip prefiks (token awal) yang cocok PERSIS dengan wilayah sesi.
 * - Hanya strip bila sisa string tetap bermakna (fail-open bila kosong).
 */
export function stripStaleRegionPrefix(locationText: string, known: KnownRegion | null | undefined): string {
  if (!locationText) return locationText;
  const raw = locationText.trim();
  if (!known) return raw;

  const staleNorm = [known.kecamatan, known.kelurahan]
    .map((v) => norm(v || ''))
    .filter((v) => v.length > 0);
  if (staleNorm.length === 0) return raw;

  const tokens = tokenize(raw);
  if (tokens.length < 2) return raw;

  // Cari prefiks terpanjang yang normalisasinya sama dengan salah satu wilayah
  // basi sesi. Iterasi dari token terbanyak → token tunggal (longest match).
  let cut = 0;
  for (let end = tokens.length - 1; end >= 1; end--) {
    const joined = norm(tokens.slice(0, end).join(''));
    if (staleNorm.includes(joined)) {
      cut = end;
      break;
    }
  }

  if (cut === 0) return raw;
  const remainder = tokens.slice(cut).join(' ').trim();
  // Fail-open: jangan pernah mengembalikan string kosong / terlalu pendek.
  return remainder.length >= 2 ? remainder : raw;
}

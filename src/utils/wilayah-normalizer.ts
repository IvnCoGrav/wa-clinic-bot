import { getGazetteerKecamatanEntries, getGazetteerCanonicalCities } from './gazetteer';
/**
 * wilayah-normalizer.ts
 * Sanitasi nama wilayah (kota/kecamatan/kelurahan) yang berasal dari data
 * bebas hasil scraping chat. Data produksi memuat polusi nyata seperti
 * `kecamatan = "Kota :"` atau `kota = "No. Hp : 087852674363"`, serta nama
 * perumahan/jalan alih-alih nama wilayah resmi.
 *
 * Fungsi murni (pure) — dipakai endpoint map-points dan script backfill untuk
 * memutuskan apakah sebuah teks wilayah layak di-resolve ke gazetteer.
 */

const NOISE_PREFIXES = [
  'kota :',
  'kota:',
  'kabupaten :',
  'kabupaten:',
  'kecamatan :',
  'kecamatan:',
  'kelurahan :',
  'kelurahan:',
  'no. hp :',
  'no hp :',
  'no. hp:',
  'no hp:',
  'hp :',
  'hp:',
  'telp :',
  'telp:',
  'wa :',
  'wa:',
  'alamat :',
  'alamat:',
];

/**
 * Membersihkan teks wilayah dari prefix polusi dan whitespace berlebih.
 * Tidak melakukan pencocokan hafalan per-kasus; hanya membuang label teknis.
 */
export function normalizeWilayahText(raw?: string | null): string {
  let value = String(raw ?? '').trim();
  if (!value) return '';

  let changed = true;
  while (changed) {
    changed = false;
    const lower = value.toLowerCase();
    for (const prefix of NOISE_PREFIXES) {
      if (lower.startsWith(prefix)) {
        value = value.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }

  // Buang sisa karakter pemisah di tepi (mis. ": Surabaya" → "Surabaya").
  value = value.replace(/^[:\-–—,.\s]+/, '').replace(/[\s,.:\-–—]+$/, '').trim();
  return value;
}

/**
 * Menilai apakah teks layak dianggap nama wilayah administratif.
 * Menolak: kosong, terlalu pendek, didominasi digit (nomor telepon), atau
 * mengandung karakter non-huruf yang menandakan bukan nama wilayah.
 */
export function isValidAreaName(raw?: string | null): boolean {
  const value = normalizeWilayahText(raw);
  if (!value) return false;
  // Harus punya minimal 3 huruf alfabet.
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  // Didominasi digit (nomor telepon / nomor rumah) → bukan wilayah.
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length >= 6) return false;
  return true;
}

export interface SplitWilayahResult {
  kecamatan?: string;
  kelurahan?: string;
  kota?: string;
}

/**
 * Memisahkan teks wilayah gabungan (misal "pacar Keling, Tambaksari" atau "Tambaksari, Surabaya")
 * secara level-aware menggunakan daftar kecamatan resmi dataset Gazetteer.
 * Mencegah kesalahan penafsiran nama kota luas sebagai kelurahan ("Tambaksari, Surabaya", "Waru, Sidoarjo").
 */
export function splitWilayahComposite(raw?: string | null): SplitWilayahResult {
  const text = normalizeWilayahText(raw);
  if (!text) return {};

  if (!/[\,\/\;]/.test(text)) {
    return { kecamatan: text };
  }

  const parts = text.split(/[\,\/\;]+/).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length <= 1) {
    return { kecamatan: text };
  }

  // Ambil daftar kecamatan dan kota dari gazetteer secara aman
    const kecEntries: Array<{ lower: string; orig: string }> = getGazetteerKecamatanEntries();
  const canonicalCities: string[] = getGazetteerCanonicalCities();

  const isCity = (s: string) => {
    const sl = s.toLowerCase().replace(/^(kota|kabupaten|kab|kab\.)\s+/i, '').trim();
    if (!sl) return false;
    return canonicalCities.some((c) => {
      const cl = c.toLowerCase().replace(/^(kota|kabupaten|kab|kab\.)\s+/i, '').trim();
      return cl === sl || cl.includes(sl) || sl.includes(cl);
    });
  };

  const findKec = (s: string) => {
    const sl = s.toLowerCase().replace(/^kecamatan\s+/i, '').trim();
    return kecEntries.find((k) => k.lower === sl || k.lower.replace(/\s+/g, '') === sl.replace(/\s+/g, ''));
  };

  const p0 = parts[0];
  const p1 = parts[1];

  // Prioritas 1: Bila salah satu bagian adalah nama KOTA resmi (misal "Tambaksari, Surabaya" atau "Waru, Sidoarjo")
  if (isCity(p1)) {
    const kHit = findKec(p0);
    return { kecamatan: kHit ? kHit.orig : p0, kota: p1 };
  }
  if (isCity(p0)) {
    const kHit = findKec(p1);
    return { kecamatan: kHit ? kHit.orig : p1, kota: p0 };
  }

  // Prioritas 2: Bila bukan kota, cek bagian yang merupakan nama KECAMATAN resmi (misal "pacar Keling, Tambaksari")
  const kecHit1 = findKec(p1);
  if (kecHit1) {
    return { kecamatan: kecHit1.orig, kelurahan: p0 };
  }

  const kecHit0 = findKec(p0);
  if (kecHit0) {
    return { kecamatan: kecHit0.orig, kelurahan: p1 };
  }

  // Fallback bila tidak cocok entri resmi: pertahankan teks bersih
  return { kecamatan: text };
}

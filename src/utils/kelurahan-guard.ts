/**
 * kelurahan-guard.ts
 * Gerbang MURNI (pure, tanpa I/O & tanpa dependensi berat) untuk validasi nilai
 * yang akan dipersist ke kolom `Customer.kelurahan`.
 *
 * Dipisah dari `customer-name-healing.ts` (yang mengimpor gazetteer/dataset) agar
 * dapat dipanggil dari hot-path service (`customer.service`) tanpa menyeret beban
 * import dataset. `customer-name-healing.ts` me-re-export helper ini demi
 * kompatibilitas pemanggil lama.
 */

/**
 * Pola pencemaran kolom kelurahan: URL maps, label alamat generik, dan detail
 * alamat fisik (jalan/gang/blok/RT-RW/No rumah). Diambil dari kata yang TERBUKTI
 * tidak muncul pada 573 nama kelurahan resmi dataset (anti-false-positive).
 */
const CORRUPTION_PATTERNS =
  /https?:\/\/|goo\.gl|maps|\bjl\.|\bjln\.|\bjalan\b|\bblok\b|\bgang\b|\bgg\.|\bperum\b|\bperumahan\b|\bresidence\b|\bapartemen\b|\bapartment\b|\bkomplek\b|\bdusun\b|\brt\s*\d|\brw\s*\d|\bno\.\s*\d|\bnomor\s*\d/i;

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
 * Gerbang SEAM TULIS (fondasional): kolom `kelurahan` HANYA boleh berisi nama
 * desa/kelurahan resmi. Jalur form reservasi mengirim field "Alamat"
 * (jalan/perumahan/blok) dan sempat menyimpannya ke kolom ini → kartu terapis
 * menampilkan "Kel. Jalan ...". Kembalikan `undefined` bila tercemar sehingga
 * pemanggil TIDAK menulis nilai tersebut ke kolom kelurahan.
 */
export function sanitizeKelurahanInput(v?: string | null): string | undefined {
  const s = (v || '').trim();
  if (!s) return undefined;
  if (isCorruptedKelurahan(s)) return undefined;
  return s;
}

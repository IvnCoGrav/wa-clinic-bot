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

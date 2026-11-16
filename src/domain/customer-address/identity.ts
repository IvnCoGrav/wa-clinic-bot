/**
 * DOM-02: identitas rumah berbasis TEKS ALAMAT (murni, tanpa I/O).
 *
 * Dipakai untuk mencegah kartu alamat ganda saat pelanggan mengirim ulang alamat
 * yang SAMA dengan variasi penulisan (prefix "jl", keterangan dalam kurung,
 * atau URL Google Maps yang menempel di pesan).
 *
 * Batas aman: HANYA menilai kesamaan bila nomor rumah eksplisit sama (atau teks
 * identik setelah normalisasi). Dua rumah beda nomor / beda jalan tetap TERPISAH.
 */
import { norm } from './internal';

/**
 * Token generik administratif/penulisan jalan. Dibuang agar
 * "Jl. Tropodo 1 Gg. Merah Delima No.225A" == "tropodo 1 merah delima 225a".
 * BUKAN daftar kata kunci bisnis: tidak ada nama jalan/wilayah yang di-hardcode.
 */
const GENERIC_ADDRESS_TOKENS = new Set([
  'jl',
  'jalan',
  'jln',
  'gg',
  'gang',
  'no',
  'nomor',
  'nomer',
  'rt',
  'rw',
  'perum',
  'perumahan',
  'komplek',
  'kompleks',
  'cluster',
  'kel',
  'kelurahan',
  'kec',
  'kecamatan',
  'kota',
  'kabupaten',
  'provinsi',
  'indonesia',
]);

/** Host Google Maps yang lazim dipakai untuk berbagi lokasi. */
const MAPS_SHARE_HOSTS = new Set([
  'goo.gl',
  'maps.app.goo.gl',
  'share.google',
  'maps.google.com',
  'www.google.com',
  'google.com',
  'maps.google.co.id',
  'www.google.co.id',
  'google.co.id',
]);

function isUrlToken(token: string): boolean {
  const cleaned = token.replace(/^[("'“”‘’<[{-]+|[)"'“”‘’>\],.;!?]+$/g, '');
  if (!cleaned) return false;
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('www.')) {
    return true;
  }
  if (!lower.includes('.') || lower.includes(' ')) return false;
  try {
    const parsed = new URL(`https://${lower}`);
    return MAPS_SHARE_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.google.com');
  } catch {
    return false;
  }
}

/**
 * Buang tautan (Google Maps/URL apa pun) dari teks alamat.
 * URL adalah metadata teknis, BUKAN alamat — dilarang disimpan sebagai teks alamat.
 */
export function stripUrlsFromAddress(value?: string | null): string {
  return norm(
    String(value ?? '')
      .split(/\s+/)
      .filter((token) => token.length > 0 && !isUrlToken(token))
      .join(' ')
  );
}

export interface StreetIdentity {  /** Teks kanonis tanpa URL, keterangan non-angka, dan token generik. */
  key: string;
  tokens: string[];
  /** Nomor rumah eksplisit ("no/nomor 225a"), jika ada. */
  houseNumber: string | null;
}

function extractHouseNumber(value: string): string | null {
  const match = /\b(?:no|nomor|nomer)\s*\.?\s*([0-9]+[a-z]?(?:[-/][0-9a-z]+)?)\b/i.exec(value);
  if (!match) return null;
  const cleaned = match[1].toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned || null;
}

/** Penanda blok/perumahan yang sah sebagai bukti rumah (tanpa nomor angka). */
const HOUSE_BLOCK_MARKERS = /\b(?:blok|kavling|kav|cluster|perum|perumahan|komplek|kompleks)\b/i;

/**
 * Bukti minimal bahwa teks memang menyebut sebuah RUMAH (bukan obrolan biasa):
 * mengandung angka (nomor rumah/RT/RW/blok) ATAU penanda blok/perumahan.
 * Dipakai sebagai gerbang sebelum MELAHIRKAN kartu alamat baru.
 */
export function hasHouseEvidence(address?: string | null): boolean {
  const text = stripUrlsFromAddress(address);
  if (!text) return false;
  return /\d/.test(text) || HOUSE_BLOCK_MARKERS.test(text);
}

/** Bentuk identitas jalan dari teks bebas (deterministik, tanpa I/O). */
export function streetIdentity(address?: string | null): StreetIdentity {
  const withoutUrls = stripUrlsFromAddress(address);
  // Keterangan dalam kurung yang TIDAK memuat angka dianggap catatan
  // (mis. "(rumah pertama abu putih)"). Kurung berisi nomor/blok dipertahankan.
  const withoutNotes = withoutUrls.replace(/\([^)\d]*\)/g, ' ');
  const tokens = withoutNotes
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((token) => !GENERIC_ADDRESS_TOKENS.has(token));
  const houseNumber = extractHouseNumber(withoutUrls);
  return { key: tokens.join(' '), tokens, houseNumber };
}

/**
 * Dua teks alamat menunjuk RUMAH YANG SAMA bila teks kanonisnya identik
 * setelah URL, keterangan non-angka, dan token generik dibuang (minimal 2 token).
 * Bila kedua sisi punya nomor rumah eksplisit, nomornya WAJIB sama.
 *
 * Sengaja TIDAK memakai aturan "subset token": nomor jalan (mis. "Tropodo 1"
 * vs "Tropodo 2") bisa bertabrakan dengan nomor rumah sehingga berisiko
 * menggabungkan dua rumah berbeda. Variasi teks yang tidak menambah/mengurangi
 * token alamat tetap tertangkap (prefix "jl/gg", URL, keterangan dalam kurung).
 */
export function houseIdentityMatch(
  a?: string | null,
  b?: string | null
): boolean {
  const first = streetIdentity(a);
  const second = streetIdentity(b);
  if (!first.key || !second.key) return false;
  if (first.tokens.length < 2 || second.tokens.length < 2) return false;
  if (first.houseNumber && second.houseNumber && first.houseNumber !== second.houseNumber) {
    return false;
  }
  return first.key === second.key;
}

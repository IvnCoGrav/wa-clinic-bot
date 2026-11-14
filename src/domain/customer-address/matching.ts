/**
 * DOM-02: pencocokan & identitas rumah (murni).
 */
import {
  SAME_POINT_MAX_METERS,
  type SavedCustomerAddress,
  type UpsertSavedAddressInput,
} from './types';
import {
  bothCoords,
  hasCoords,
  hasText,
  haversineMeters,
  isPreciseGps,
  levenshtein,
  norm,
  normCity,
} from './internal';
import { houseIdentityMatch } from './identity';
/**
 * Pencocokan wilayah berbasis token: memecah string pada delimitasi `, / ;`.
 * Mencegah false positive substring (misal "sukomanunggal" !== "manunggal"),
 * tetapi mengenali entitas gabungan (misal "pacar keling, tambaksari" memuat token "tambaksari").
 */
export function wilayahTokenMatch(a?: string | null, b?: string | null): boolean {
  if (!hasText(a) || !hasText(b)) return false;
  const tokensA = String(a)
    .split(/[\,\/\;]+/)
    .map((t) => norm(t))
    .filter((t) => t.length > 2);
  const tokensB = String(b)
    .split(/[\,\/\;]+/)
    .map((t) => norm(t))
    .filter((t) => t.length > 2);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  return tokensA.some((ta) => tokensB.some((tb) => ta === tb));
}

/** Evaluasi kemiripan toponimi: identik, child ⊂ parent, atau typo Levenshtein <= 2. */
function isWilayahSimilar(a?: string | null, b?: string | null): boolean {
  if (!hasText(a) || !hasText(b)) return false;
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  // Child-name ⊂ parent-name (misal Morokrembangan ⊃ Krembangan)
  // Cegah over-match pada token pendek (<5 karakter misal "aru", "batu", "barat")
  if (Math.min(na.length, nb.length) >= 5 && (na.includes(nb) || nb.includes(na))) return true;
  // Typo toponimi wajar (Levenshtein <= 2, panjang minimal 4 karakter)
  if (na.length >= 4 && nb.length >= 4 && levenshtein(na, nb) <= 2) return true;
  return false;
}

/**
 * Dedup deterministik. Dua entri dianggap RUMAH SAMA bila:
 *  1. titik <150 m (bukti fisik), ATAU
 *  2. alamat jalan + kelurahan + kecamatan identik (keduanya punya jalan), ATAU
 *  3. hanya wilayah (tanpa jalan) + kelurahan + kecamatan + kota identik, ATAU
 *  4. jalan identik + toponimi / typo wajar kecamatan/kelurahan + toleransi sentroid <= 3 km.
 * Beda jalan dalam kecamatan sama → TIDAK match (biar 2 rumah tetap terpisah).
 */
export function addressesMatch(
  a: UpsertSavedAddressInput,
  b: UpsertSavedAddressInput,
  maxMeters = SAME_POINT_MAX_METERS
): boolean {
  if (bothCoords(a, b) && haversineMeters(a as any, b as any) <= maxMeters) {
    // Titik sangat dekat = bukti fisik, TETAPI lintas kota/kabupaten tidak boleh
    // disatukan hanya karena sentroid/geocoder meleset. Salah satu sisi kosong
    // tetap kompatibel (data lama).
    const aKota = normCity(a.kota);
    const bKota = normCity(b.kota);
    return !hasText(a.kota) || !hasText(b.kota) || aKota === bKota;
  }

  const aAddr = hasText(a.address);
  const bAddr = hasText(b.address);
  const sameStreet = aAddr && bAddr && norm(a.address) === norm(b.address);
  const kelSamaPersis =
    hasText(a.kelurahan) && hasText(b.kelurahan) && norm(a.kelurahan) === norm(b.kelurahan);
  const sameKel = kelSamaPersis;
  const kelKompatibel = kelSamaPersis || !hasText(a.kelurahan) || !hasText(b.kelurahan);
  const sameKec =
    hasText(a.kecamatan) && hasText(b.kecamatan) && norm(a.kecamatan) === norm(b.kecamatan);
  const sameKota = hasText(a.kota) && hasText(b.kota) && norm(a.kota) === norm(b.kota);

  // Aturan: jalan sama + kecamatan sama + desa kompatibel = COCOK.
  // Dua desa SAMA-SAMA isi tapi BEDA -> TETAP TIDAK cocok (Rumah-2 sah).
  if (sameStreet && sameKec && kelKompatibel) return true;

  // Cabang toponimi & typo fuzzy (Mikro 1.2): HANYA aktif bila jalan sama persis DAN kota kompatibel.
  // Mencegah over-merge: jalan beda / kota beda DILARANG masuk ke sini.
  const aKota = normCity(a.kota);
  const bKota = normCity(b.kota);
  const kotaKompatibel = !hasText(a.kota) || !hasText(b.kota) || aKota === bKota;

  if (sameStreet && kotaKompatibel) {
    // Dua kelurahan berbeda di kecamatan yang sama TETAP TIDAK cocok (Rumah-2 sah).
    if (sameKec && !kelKompatibel) return false;

    const within3km = !bothCoords(a, b) || haversineMeters(a as any, b as any) <= 3000;
    if (within3km) {
      // 1. Cross kelurahan <-> kecamatan (mis. tertukar pada form intake)
      const crossMatch =
        (hasText(a.kecamatan) && hasText(b.kelurahan) && norm(a.kecamatan) === norm(b.kelurahan)) ||
        (hasText(a.kelurahan) && hasText(b.kecamatan) && norm(a.kelurahan) === norm(b.kecamatan));
      if (crossMatch) return true;

      // 2. Typo toponimi pada kecamatan atau cross kelurahan↔kecamatan (mis. morokrembangab vs Morokrembangan)
      const toponimiKec =
        isWilayahSimilar(a.kecamatan, b.kecamatan) &&
        (kelKompatibel || isWilayahSimilar(a.kelurahan, b.kelurahan));
      const toponimiCross =
        isWilayahSimilar(a.kecamatan, b.kelurahan) || isWilayahSimilar(a.kelurahan, b.kecamatan);
      if (toponimiKec || toponimiCross) return true;

      // 3. Alamat jalan identik & spesifik (memuat nomor/blok/RT-RW eksplisit):
      // Hanya alamat yang MEMUAT nomor/blok/RT-RW eksplisit yang boleh merge lintas
      // kecamatan. Nama perumahan tanpa nomor TIDAK cukup (anti-over-merge rumah-2).
      const streetText = `${a.address || ''} ${b.address || ''}`;
      const hasHouseNumber = /\b(?:no|nomor|blok|gang|gg|rt|rw|cluster|perum|perumahan)\b.*?\d+/i.test(
        streetText
      );
      // Jalan + nomor identik boleh merge lintas kecamatan HANYA bila wilayahnya
      // masih kompatibel (typo/toponimi). Dua kecamatan berbeda yang jelas
      // (mis. Karang Pilang vs Buduran) DILARANG dianggap rumah sama.
      const regionOk =
        isRegionCompatible(a, b) || !hasText(a.kecamatan) || !hasText(b.kecamatan);
      if (hasHouseNumber && norm(a.address).length >= 8 && regionOk) return true;
    }
  }

  // Tanpa detail jalan di kedua sisi: samakan bila wilayah desa/kecamatan identik.
  if (!aAddr && !bAddr && sameKec && kelKompatibel && kotaKompatibel) return true;
  // Pengayaan asimetris (ghost primary 2026-10-12): tepat SATU sisi kosong
  // (tanpa teks jalan) dan wilayahnya cocok → rumah yang SAMA sedang
  // dilengkapi, bukan rumah baru. Syarat kecamatan sama; kelurahan sama bila
  // keduanya terisi (sisi yang belum punya kelurahan boleh mengikuti).
  // Dua sisi ber-teleks beda jalan → tetap TIDAK match (rumah-2 aman).
  if (aAddr !== bAddr && (sameKec || wilayahTokenMatch(a.kecamatan, b.kecamatan))) {
    const kelOk = sameKel || !hasText(a.kelurahan) || !hasText(b.kelurahan);
    if (kelOk && kotaKompatibel) return true;
  }

  // Identitas rumah berbasis teks (anti kartu ganda "hantu"): alamat yang sama
  // dengan variasi penulisan — URL Maps menempel, prefix "jl/gg", atau keterangan
  // dalam kurung — WAJIB dianggap rumah yang sama, bukan rumah kedua.
  // Gerbang aman: nomor rumah eksplisit harus sama (lihat houseIdentityMatch).
  if (houseIdentityMatch(a.address, b.address)) {
    const kecOk =
      !hasText(a.kecamatan) ||
      !hasText(b.kecamatan) ||
      sameKec ||
      wilayahTokenMatch(a.kecamatan, b.kecamatan);
    const kelOk = !hasText(a.kelurahan) || !hasText(b.kelurahan) || sameKel;
    return kecOk && kelOk && kotaKompatibel;
  }
  return false;
}

/**
 * Kompatibilitas wilayah untuk pengayaan pin GPS (data-driven, bukan daftar hafalan):
 * - Cross kelurahan <-> kecamatan (misal tertukar pada intake awal), ATAU
 * - Kecamatan sama / token-match / typo Levenshtein <= 2, ATAU
 * - Salah satu sisi kosong kecamatan.
 *
 * Catatan penting: kelurahan hasil reverse-geocode GPS sering berbeda dengan
 * kelurahan intake teks (batas desa, toponimi, atau tebakan geocoder).
 * Selama kecamatannya sama (atau salah satu kosong), wilayah dianggap kompatibel
 * untuk memperkaya kartu yang belum ber-GPS presisi.
 */
export function isRegionCompatible(
  a: { kelurahan?: string | null; kecamatan?: string | null },
  b: { kelurahan?: string | null; kecamatan?: string | null }
): boolean {
  const crossMatch =
    (hasText(a.kecamatan) &&
      hasText(b.kelurahan) &&
      (norm(a.kecamatan) === norm(b.kelurahan) || isWilayahSimilar(a.kecamatan, b.kelurahan))) ||
    (hasText(a.kelurahan) &&
      hasText(b.kecamatan) &&
      (norm(a.kelurahan) === norm(b.kecamatan) || isWilayahSimilar(a.kelurahan, b.kecamatan)));
  if (crossMatch) return true;

  const kecOk =
    !hasText(a.kecamatan) ||
    !hasText(b.kecamatan) ||
    norm(a.kecamatan) === norm(b.kecamatan) ||
    wilayahTokenMatch(a.kecamatan, b.kecamatan) ||
    isWilayahSimilar(a.kecamatan, b.kecamatan);

  return kecOk;
}

/**
 * Gerbang anti "shareloc jadi alamat kedua".
 * Pin GPS baru HANYA boleh membuat kartu baru bila tidak ada kartu lama
 * yang (a) belum memiliki GPS presisi dan (b) wilayahnya kompatibel.
 */
export function selectEnrichmentTarget(
  list: SavedCustomerAddress[],
  input: UpsertSavedAddressInput
): SavedCustomerAddress | null {
  if (input.id) return list.find((a) => a.id === input.id) || null; // eksplisit menang
  if (!hasCoords(input)) return null;

  // Bila input adalah pin GPS native, kartu lama ber-estimated_area / manual_staff / tanpa koordinat
  // adalah kandidat yang berhak diperkaya (upgrade koordinat ke presisi).
  // Bila input bukan gps_pin, hanya kartu tanpa koordinat sama sekali yang berhak diperkaya.
  const isInputGpsPin = input.locationSource === 'gps_pin';
  const candidates = list.filter(
    (a) => (isInputGpsPin ? !isPreciseGps(a) : !hasCoords(a)) && isRegionCompatible(a, input)
  );

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // >1 kandidat: DILARANG menebak (anti menimpa rumah yang salah).
  // Hanya pilih bila ada bukti tunggal yang tegas.
  const kelurahanMatches = candidates.filter(
    (a) =>
      hasText(a.kelurahan) &&
      hasText(input.kelurahan) &&
      (norm(a.kelurahan) === norm(input.kelurahan) ||
        wilayahTokenMatch(a.kelurahan, input.kelurahan) ||
        isWilayahSimilar(a.kelurahan, input.kelurahan))
  );
  if (kelurahanMatches.length === 1) return kelurahanMatches[0];

  // Bukti fisik: hanya kandidat berkoordinat yang berjarak <=150 m dari pin.
  const withCoords = candidates.filter((a) => hasCoords(a));
  if (withCoords.length > 0) {
    const near = withCoords
      .map((a) => ({ card: a, distance: haversineMeters(a as any, input as any) }))
      .filter((x) => x.distance <= SAME_POINT_MAX_METERS)
      .sort((x, y) => x.distance - y.distance);
    if (near.length > 0) {
      const primary = near.map((x) => x.card).find((a) => a.isPrimary);
      return primary || near[0].card;
    }
  }

  // Ambigu → serahkan ke addressesMatch (perilaku lama), jangan menebak.
  return null;
}

/**
 * Normalisasi teks alamat jalan untuk perbandingan IDENTITAS RUMAH.
 * Hanya untuk kesetaraan teks (bukan gerbang intent / pencocokan kalimat bebas):
 * buang tanda baca & rapatkan spasi sehingga "No. 94" == "no 94".
 */
export function normalizeAddressText(value?: string | null): string {
  return norm(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kunci identitas alamat: koordinat presisi bila ada, selain itu teks ternormalisasi. */
export function buildAddressKey(input: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
}): string | null {
  const lat = input.lat != null ? Number(input.lat) : NaN;
  const lng = input.lng != null ? Number(input.lng) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return `geo:${lat.toFixed(5)},${lng.toFixed(5)}`;
  }
  const parts = [input.address, input.kelurahan, input.kecamatan, input.kota]
    .map((v) => (v ? norm(String(v)) : ''))
    .filter(Boolean);
  return parts.length > 0 ? `txt:${parts.join('|')}` : null;
}

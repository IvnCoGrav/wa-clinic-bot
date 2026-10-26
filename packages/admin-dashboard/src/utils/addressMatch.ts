/**
 * CERMIN 1:1 dari `src/domain/customer-address.ts` (norm/hasText/haversine/
 * bothCoords/addressesMatch) untuk FE dashboard (paket terpisah, tanpa import
 * lintas repo backend).
 *
 * ATURAN SINKRONISASI: setiap perubahan semantik di sumber WAJIB disalin ke
 * sini dan sebaliknya — dijaga tes paritas
 * `tests/unit/dashboard-address-match-parity.test.ts` (root vitest).
 */

export const SAME_POINT_MAX_METERS = 150;

export interface AddressMatchInput {
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Normalisasi ringan data-driven (bukan daftar hafalan bisnis): lowercase + rapatkan spasi. */
function norm(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasText(value?: string | null): boolean {
  return norm(value).length > 0;
}

/** Jarak Haversine meter — identik dengan DeliveryService fallback. */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bothCoords(
  a: { lat?: number | null; lng?: number | null },
  b: { lat?: number | null; lng?: number | null }
): boolean {
  return typeof a.lat === 'number' && typeof a.lng === 'number' && typeof b.lat === 'number' && typeof b.lng === 'number';
}

/** Jarak edit Levenshtein (murni tanpa dependency eksternal). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/** Normalisasi kota: buang prefix administratif & dukung singkatan baku kota (sby/sda). */
function normCity(value?: string | null): string {
  const s = norm(value)
    .replace(/^(kota|kabupaten|kab\.|kotamadya)\s+/i, '')
    .trim();
  if (s === 'sby') return 'surabaya';
  if (s === 'sda') return 'sidoarjo';
  return s;
}

/** Evaluasi kemiripan toponimi: identik, child ⊂ parent, atau typo Levenshtein <= 2. */
function isWilayahSimilar(a?: string | null, b?: string | null): boolean {
  if (!hasText(a) || !hasText(b)) return false;
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  // Child-name ⊂ parent-name (misal Morokrembangan ⊃ Krembangan)
  if (na.includes(nb) || nb.includes(na)) return true;
  // Typo toponimi wajar (Levenshtein <= 2, panjang minimal 4 karakter)
  if (na.length >= 4 && nb.length >= 4 && levenshtein(na, nb) <= 2) return true;
  return false;
}

/**
 * Dedup deterministik (identik sumber):
 *  1. titik <150 m, ATAU
 *  2. alamat jalan + kecamatan identik (kelurahan kompatibel), ATAU
 *  3. tanpa teks jalan di kedua sisi + kelurahan + kecamatan identik, ATAU
 *  4. tepat SATU sisi ber-teks jalan + kecamatan sama (pengayaan rumah sama), ATAU
 *  5. jalan identik + toponimi / typo wajar kecamatan/kelurahan + toleransi sentroid <= 3 km.
 * Beda jalan dalam kecamatan sama (keduanya ber-teks) → TIDAK match.
 */
export function addressesMatch(
  a: AddressMatchInput,
  b: AddressMatchInput,
  maxMeters: number = SAME_POINT_MAX_METERS
): boolean {
  if (bothCoords(a, b) && haversineMeters(a as any, b as any) <= maxMeters) return true;

  const aAddr = hasText(a.address);
  const bAddr = hasText(b.address);
  const sameStreet = aAddr && bAddr && norm(a.address) === norm(b.address);
  const kelSamaPersis = hasText(a.kelurahan) && hasText(b.kelurahan) && norm(a.kelurahan) === norm(b.kelurahan);
  const sameKel = kelSamaPersis;
  const kelKompatibel = kelSamaPersis || !hasText(a.kelurahan) || !hasText(b.kelurahan);
  const sameKec = hasText(a.kecamatan) && hasText(b.kecamatan) && norm(a.kecamatan) === norm(b.kecamatan);
  const sameKota = hasText(a.kota) && hasText(b.kota) && norm(a.kota) === norm(b.kota);

  if (sameStreet && sameKec && kelKompatibel) return true;

  // Cabang toponimi & typo fuzzy (Mikro 1.3): HANYA aktif bila jalan sama persis DAN kota kompatibel.
  // Mencegah over-merge: jalan beda / kota beda DILARANG masuk ke sini.
  const aKota = normCity(a.kota);
  const bKota = normCity(b.kota);
  const kotaKompatibel = !hasText(a.kota) || !hasText(b.kota) || aKota === bKota;

  if (sameStreet && kotaKompatibel) {
    const within3km = !bothCoords(a, b) || haversineMeters(a as any, b as any) <= 3000;
    if (within3km) {
      // 1. Cross kelurahan <-> kecamatan (mis. tertukar pada form intake)
      const crossMatch =
        (hasText(a.kecamatan) && hasText(b.kelurahan) && norm(a.kecamatan) === norm(b.kelurahan)) ||
        (hasText(a.kelurahan) && hasText(b.kecamatan) && norm(a.kelurahan) === norm(b.kecamatan));
      if (crossMatch) return true;

      // 2. Typo toponimi pada kecamatan atau cross kelurahan↔kecamatan (mis. morokrembangab vs Morokrembangan)
      const toponimiKec = isWilayahSimilar(a.kecamatan, b.kecamatan) && (kelKompatibel || isWilayahSimilar(a.kelurahan, b.kelurahan));
      const toponimiCross = isWilayahSimilar(a.kecamatan, b.kelurahan) || isWilayahSimilar(a.kelurahan, b.kecamatan);
      if (toponimiKec || toponimiCross) return true;

      // 3. Alamat jalan identik & spesifik (panjang >= 15 karakter atau ada nomor/blok/cluster/rt/rw):
      // Jika jalan sama persis di kota sama dalam radius sentroid <= 3km, ini adalah rumah yang sama
      // meskipun kecamatan administratif berbeda karena pergeseran batas reverse-geocoding peta.
      const isSpecificStreet = norm(a.address).length >= 15 || /\b(?:no|nomor|blok|gang|gg|cluster|perum|perumahan|rt|rw)\b/i.test(a.address || '');
      if (isSpecificStreet) return true;
    }
  }

  if (!aAddr && !bAddr && sameKec && kelKompatibel && kotaKompatibel) return true;
  if (aAddr !== bAddr && sameKec) {
    const kelOk = sameKel || !hasText(a.kelurahan) || !hasText(b.kelurahan);
    if (kelOk) return true;
  }
  return false;
}

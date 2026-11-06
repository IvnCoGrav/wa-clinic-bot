/**
 * reservationAddress.ts — Seam baca alamat tunggal (frontend).
 * Prioritas alamat efektif: KARTU alamat tertaut reservasi → raw_text form →
 * preferences.address/full_address → kolom profil. Paritas dengan
 * `src/utils/reservation-address.ts`. Reuse pola regex form yang sudah terbukti.
 *
 * Kartu adalah otoritas: reservasi multi-rumah WAJIB membaca wilayah/jalan/jarak
 * dari `customer_address_id`, bukan dari profil induk (yang menyimpan rumah utama).
 */
export function extractAddressFromRawText(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(?:alamat\s*&(?:amp;)?\s*shareloc|alamat\s*lengkap|alamat)\s*[:=][ \t]*([^\r\n\t]+)/i);
  const v = m?.[1]?.trim();
  if (v && v !== '-' && v.length > 3) return v;
  return null;
}

export interface ReservationAddressCard {
  label?: string | null;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Baris Prisma `customer_addresses` (snake_case). */
  distance_km?: number | null;
  /** Kontrak domain `SavedCustomerAddress` (camelCase). */
  distanceKm?: number | null;
  ongkir?: number | null;
  is_primary?: boolean | null;
  isPrimary?: boolean | null;
}

export interface ReservationAreaSource {
  raw_text?: string | null;
  customer_address?: ReservationAddressCard | null;
  customer?: {
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
    address?: string | null;
    distance_km?: number | null;
    ongkir?: number | null;
    lat?: number | null;
    lng?: number | null;
    preferences?: any;
  } | null;
}

const cleanPart = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const isSamePart = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const firstClean = (...values: unknown[]): string => {
  for (const v of values) {
    const s = cleanPart(v);
    if (s) return s;
  }
  return '';
};

/**
 * Wilayah efektif: kartu reservasi lebih dulu, lalu profil induk.
 * Duplikasi dilebur agar label tidak berbunyi "Tandes, Tandes, Surabaya".
 */
export function resolveReservationRegion(reservation: ReservationAreaSource | null | undefined): {
  kelurahan: string;
  kecamatan: string;
  kota: string;
  regionLabel: string;
  source: 'card' | 'customer' | 'none';
} {
  const card = reservation?.customer_address || null;
  const customer = reservation?.customer || null;
  const fromCard = Boolean(cleanPart(card?.kelurahan) || cleanPart(card?.kecamatan) || cleanPart(card?.kota));
  const kelurahan = fromCard ? cleanPart(card?.kelurahan) : cleanPart(customer?.kelurahan);
  const kecamatan = fromCard ? cleanPart(card?.kecamatan) : cleanPart(customer?.kecamatan);
  const kota = fromCard ? cleanPart(card?.kota) : cleanPart(customer?.kota);

  const parts: string[] = [];
  for (const part of [kelurahan, kecamatan, kota]) {
    if (!part) continue;
    if (parts.length > 0 && isSamePart(parts[parts.length - 1], part)) continue;
    parts.push(part);
  }

  return {
    kelurahan,
    kecamatan,
    kota,
    regionLabel: parts.join(', '),
    source: fromCard ? 'card' : parts.length > 0 ? 'customer' : 'none',
  };
}

export interface ReservationAddressView {
  street: string;
  kelurahan: string;
  kecamatan: string;
  kota: string;
  regionLabel: string;
  distanceKm: number | null;
  ongkir: number | null;
  lat: number | null;
  lng: number | null;
  cardLabel: string | null;
  cardIsPrimary: boolean | null;
  source: 'card' | 'raw_text' | 'preferences' | 'customer' | 'none';
}

/**
 * Proyeksi alamat efektif satu reservasi — dipakai Detail Reservasi agar jalan,
 * wilayah, jarak, ongkir, dan titik peta berasal dari sumber yang SAMA.
 *
 * Prioritas: kartu tertaut → raw_text form → preferences → kolom profil.
 */
export function resolveReservationAddress(
  reservation: ReservationAreaSource | null | undefined
): ReservationAddressView {
  const card = reservation?.customer_address || null;
  const customer = reservation?.customer || null;
  const prefs = (customer?.preferences as any) || {};

  const fromRaw = extractAddressFromRawText(reservation?.raw_text);
  const fromPrefs = firstClean(prefs?.address_detail, prefs?.address, prefs?.full_address, customer?.address);
  const streetFromCard = cleanPart(card?.address);

  const region = resolveReservationRegion(reservation);
  const street = streetFromCard || fromRaw || fromPrefs || '';
  const source: ReservationAddressView['source'] = streetFromCard
    ? 'card'
    : fromRaw
      ? 'raw_text'
      : region.source === 'customer'
        ? 'customer'
        : fromPrefs
          ? 'preferences'
          : 'none';

  return {
    street,
    kelurahan: region.kelurahan,
    kecamatan: region.kecamatan,
    kota: region.kota,
    regionLabel: region.regionLabel,
    distanceKm: toNumberOrNull(card?.distance_km ?? card?.distanceKm) ?? toNumberOrNull(customer?.distance_km),
    ongkir: toNumberOrNull(card?.ongkir) ?? toNumberOrNull(customer?.ongkir),
    lat: toNumberOrNull(card?.lat) ?? toNumberOrNull(customer?.lat),
    lng: toNumberOrNull(card?.lng) ?? toNumberOrNull(customer?.lng),
    cardLabel: cleanPart(card?.label) || null,
    cardIsPrimary:
      card?.is_primary !== undefined && card?.is_primary !== null
        ? Boolean(card.is_primary)
        : card?.isPrimary !== undefined && card?.isPrimary !== null
          ? Boolean(card.isPrimary)
          : null,
    source,
  };
}

/**
 * formatReservationArea — label "daerah" ringkas untuk kartu kalender.
 *
 * Seam tunggal agar view Bulanan, Mingguan, dan Harian menampilkan daerah yang
 * sama untuk reservasi yang sama. Membaca field terstruktur (`customer.kelurahan`,
 * `kecamatan`, `kota`) — bukan regex terhadap kalimat bebas.
 *
 * Prioritas: kelurahan+kecamatan → kecamatan → kelurahan → kota (opsional).
 * Duplikasi dilebur ("Mulyorejo, Mulyorejo" → "Mulyorejo").
 *
 * @param options.includeKota Sertakan `kota` sebagai cadangan terakhir. Default
 *   `false` karena pada klinik dengan satu kota, label kota hanya jadi derau.
 */
export function formatReservationArea(
  reservation: ReservationAreaSource | null | undefined,
  options: { includeKota?: boolean } = {}
): string {
  const region = resolveReservationRegion(reservation);
  if (region.kelurahan && region.kecamatan) {
    return isSamePart(region.kelurahan, region.kecamatan)
      ? region.kecamatan
      : `${region.kelurahan}, ${region.kecamatan}`;
  }
  if (region.kecamatan) return region.kecamatan;
  if (region.kelurahan) return region.kelurahan;
  if (options.includeKota && region.kota) return region.kota;
  return '';
}

/**
 * formatReservationKelurahan — label wilayah paling ringkas untuk kartu Harian.
 *
 * F-33: kartu Harian cukup menampilkan kelurahan; gabungan "kelurahan, kecamatan"
 * memakan lebar dan mendorong elemen lain (nama bidan) keluar kartu.
 *
 * Cadangan ke `kecamatan` WAJIB: data produksi hanya 337/1001 customer punya
 * `kelurahan` (413/1001 punya `kecamatan`). Tanpa cadangan, mayoritas kartu
 * kehilangan label wilayah.
 *
 * Tidak menggantikan `formatReservationArea` — view Bulanan & Mingguan tetap
 * memakai gabungan tersebut.
 */
export function formatReservationKelurahan(
  reservation: ReservationAreaSource | null | undefined
): string {
  const region = resolveReservationRegion(reservation);
  return region.kelurahan || region.kecamatan || '';
}

/**
 * Alamat jalan tunggal. Kartu tertaut menang (otoritas per-jadwal), lalu
 * raw_text form booking, lalu preferences profil.
 */
export function resolveStreetAddress(
  reservation: ReservationAreaSource | null | undefined,
  customer?: { preferences?: any } | null
): string {
  const cardAddress = cleanPart(reservation?.customer_address?.address);
  if (cardAddress) return cardAddress;
  const fromRaw = extractAddressFromRawText(reservation?.raw_text);
  if (fromRaw) return fromRaw;
  const prefs = (customer?.preferences ?? reservation?.customer?.preferences) as any;
  const pref = prefs?.address_detail || prefs?.address || prefs?.full_address;
  return typeof pref === 'string' && pref.trim() ? pref.trim() : '';
}

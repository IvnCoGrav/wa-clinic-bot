/**
 * reservationAddress.ts — Seam baca alamat jalan tunggal (frontend).
 * Prioritas: raw_text form → preferences.address/full_address. Paritas dengan
 * `src/utils/reservation-address.ts`. Reuse pola regex form yang sudah terbukti.
 */
export function extractAddressFromRawText(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(?:alamat\s*&(?:amp;)?\s*shareloc|alamat\s*lengkap|alamat)\s*[:=][ \t]*([^\r\n\t]+)/i);
  const v = m?.[1]?.trim();
  if (v && v !== '-' && v.length > 3) return v;
  return null;
}

export interface ReservationAreaSource {
  customer?: {
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
  } | null;
}

const cleanPart = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isSamePart = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

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
  const customer = reservation?.customer;
  const kelurahan = cleanPart(customer?.kelurahan);
  const kecamatan = cleanPart(customer?.kecamatan);
  const kota = cleanPart(customer?.kota);

  if (kelurahan && kecamatan) {
    return isSamePart(kelurahan, kecamatan) ? kecamatan : `${kelurahan}, ${kecamatan}`;
  }
  if (kecamatan) return kecamatan;
  if (kelurahan) return kelurahan;
  if (options.includeKota && kota) return kota;
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
  const customer = reservation?.customer;
  return cleanPart(customer?.kelurahan) || cleanPart(customer?.kecamatan) || '';
}

export function resolveStreetAddress(
  reservation: { raw_text?: string | null; customer?: { preferences?: any } | null } | null | undefined,
  customer?: { preferences?: any } | null
): string {
  const fromRaw = extractAddressFromRawText(reservation?.raw_text);
  if (fromRaw) return fromRaw;
  const prefs = (customer?.preferences ?? reservation?.customer?.preferences) as any;
  const pref = prefs?.address_detail || prefs?.address || prefs?.full_address;
  return typeof pref === 'string' && pref.trim() ? pref.trim() : '';
}

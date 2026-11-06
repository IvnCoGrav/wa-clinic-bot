/**
 * reservation-address.ts — Seam baca alamat jalan tunggal (backend).
 * Prioritas: kartu alamat tertaut reservasi → raw_text form →
 * preferences.address/full_address. Paritas dengan
 * `packages/admin-dashboard/src/utils/reservationAddress.ts`.
 *
 * Kartu adalah otoritas per-jadwal: pelanggan multi-rumah tidak boleh
 * menampilkan alamat rumah utama saat reservasi tertaut ke rumah kedua.
 */
export function extractAddressFromRawText(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(?:alamat\s*&(?:amp;)?\s*shareloc|alamat\s*lengkap|alamat)\s*[:=][ \t]*([^\r\n\t]+)/i);
  const v = m?.[1]?.trim();
  if (v && v !== '-' && v.length > 3) return v;
  return null;
}

export interface ReservationAddressSource {
  raw_text?: string | null;
  customer_address?: { address?: string | null } | null;
  customer?: { preferences?: any } | null;
}

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function resolveStreetAddress(
  reservation: ReservationAddressSource | null | undefined,
  customer?: { preferences?: any } | null
): string {
  const cardAddress = cleanText(reservation?.customer_address?.address);
  if (cardAddress) return cardAddress;
  const fromRaw = extractAddressFromRawText(reservation?.raw_text);
  if (fromRaw) return fromRaw;
  const prefs = (customer?.preferences ?? reservation?.customer?.preferences) as any;
  const pref = prefs?.address_detail || prefs?.address || prefs?.full_address;
  return typeof pref === 'string' && pref.trim() ? pref.trim() : '';
}

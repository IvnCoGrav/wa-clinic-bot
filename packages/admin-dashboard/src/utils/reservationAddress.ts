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

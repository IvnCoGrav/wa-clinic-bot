/**
 * Modul Kanonis Unit Komersial (Reservation Unit)
 *
 * Mendefinisikan kontrak tunggal bahwa paket layanan berseri (ReservationSeries)
 * dihitung sebagai SATU unit komersial / transaksi, bukan N transaksi terpisah.
 */

export type UnitRow = {
  id: string;
  customer_id: string;
  created_at: Date | string;
  series_id?: string | null;
  session_number?: number | null;
};

/** Kunci unit komersial: satu paket = satu unit. */
export function unitKeyOf(r: Pick<UnitRow, 'id' | 'series_id'>): string {
  return r.series_id ? `series:${r.series_id}` : `res:${r.id}`;
}

/** Hanya sesi 1 (atau reservasi tunggal) yang boleh membawa event komersial. */
export function isCommercialAnchor(r: Pick<UnitRow, 'series_id' | 'session_number'>): boolean {
  if (!r.series_id) return true;
  return (r.session_number ?? 1) === 1;
}

/**
 * Ordinal unit per customer. Deterministik walau created_at identik:
 * urut (min created_at, unitKey) — bukan urutan baris DB.
 * Mengembalikan Map: unitKey -> ordinal (1, 2, ...)
 */
export function assignUnitOrdinals(rows: UnitRow[]): Map<string, number> {
  const group = new Map<string, Map<string, { minAt: number; key: string }>>();
  for (const r of rows) {
    const key = unitKeyOf(r);
    const at = new Date(r.created_at).getTime();
    const perCust = group.get(r.customer_id) ?? new Map<string, { minAt: number; key: string }>();
    const prev = perCust.get(key);
    if (!prev) {
      perCust.set(key, { minAt: at, key });
    } else if (at < prev.minAt) {
      prev.minAt = at;
    }
    group.set(r.customer_id, perCust);
  }
  const out = new Map<string, number>();
  for (const perCust of group.values()) {
    const sorted = [...perCust.values()].sort((a, b) => a.minAt - b.minAt || a.key.localeCompare(b.key));
    sorted.forEach((u, i) => out.set(u.key, i + 1));
  }
  return out;
}

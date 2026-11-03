/**
 * Domain: Rekonsiliasi Buku Alamat JSON <-> tabel `customer_addresses` (FUNGSI MURNI).
 *
 * Aturan operasional (disepakati dari audit double-alamat 2026-11-03):
 *  1. Baris tabel yang TIDAK ada di JSON tetapi DIPAKAI reservasi -> DIADOPSI ke JSON
 *     (jangan dihapus; FK/history reservasi harus tetap utuh).
 *  2. Baris tabel yang TIDAK ada di JSON dan TIDAK dipakai reservasi -> DIHAPUS.
 *  3. Kartu JSON yang belum ada di tabel -> di-UPSERT ke tabel.
 *  4. Primary mengikuti TABEL (sumber operasional staf/reservasi), fallback JSON,
 *     lalu `lastUsedAt` terbaru. Invarian: tepat 1 primary.
 */
import { ensureSinglePrimary, type SavedCustomerAddress } from './customer-address';

export interface TableAddressRow {
  id: string;
  label?: string | null;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_km?: number | null;
  ongkir?: number | null;
  landmark?: string | null;
  location_source?: string | null;
  is_primary?: boolean | null;
  created_at?: Date | string | null;
  last_used_at?: Date | string | null;
}

export interface ReconciliationPlan {
  nextJson: SavedCustomerAddress[];
  adoptedIds: string[];
  deletedIds: string[];
  primaryId: string | null;
}

function iso(value?: Date | string | null): string {
  if (!value) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Normalisasi baris tabel (snake_case) ke kontrak domain (camelCase). */
export function tableRowToSaved(row: TableAddressRow): SavedCustomerAddress {
  const label = String(row.label ?? '').trim() || 'Rumah';
  return {
    id: row.id,
    label,
    address: row.address ?? '',
    kelurahan: row.kelurahan ?? null,
    kecamatan: row.kecamatan ?? null,
    kota: row.kota ?? null,
    lat: typeof row.lat === 'number' ? row.lat : null,
    lng: typeof row.lng === 'number' ? row.lng : null,
    distanceKm: typeof row.distance_km === 'number' ? row.distance_km : null,
    ongkir: typeof row.ongkir === 'number' ? row.ongkir : null,
    landmark: row.landmark ?? null,
    locationSource: (row.location_source as SavedCustomerAddress['locationSource']) ?? null,
    isPrimary: Boolean(row.is_primary),
    createdAt: iso(row.created_at),
    lastUsedAt: iso(row.last_used_at),
  };
}

export function buildReconciliationPlan(
  jsonList: SavedCustomerAddress[],
  tableRows: TableAddressRow[],
  referencedIds: Set<string>
): ReconciliationPlan {
  const jsonById = new Map(jsonList.map((a) => [a.id, a]));
  const next: SavedCustomerAddress[] = [...jsonList];
  const adoptedIds: string[] = [];
  const deletedIds: string[] = [];

  for (const row of tableRows) {
    if (jsonById.has(row.id)) continue;
    if (referencedIds.has(row.id)) {
      next.push(tableRowToSaved(row));
      adoptedIds.push(row.id);
    } else {
      deletedIds.push(row.id);
    }
  }

  const tablePrimary = tableRows.find((r) => r.is_primary);
  const tablePrimaryInNext = tablePrimary && next.some((a) => a.id === tablePrimary.id);
  const jsonPrimary = next.find((a) => a.isPrimary);
  const latest = [...next].sort((x, y) => (x.lastUsedAt < y.lastUsedAt ? 1 : -1))[0];

  const primaryId =
    (tablePrimaryInNext ? tablePrimary!.id : null) ||
    jsonPrimary?.id ||
    latest?.id ||
    null;

  const nextJson = primaryId ? ensureSinglePrimary(next, primaryId) : next;
  return { nextJson, adoptedIds, deletedIds, primaryId };
}

/**
 * DOM-02: tombstone alamat (murni) — mencegah alamat terhapus muncul kembali.
 */
import { z } from 'zod';
import type { UpsertSavedAddressInput } from './types';
import { addressesMatch } from './matching';

export const AddressTombstoneSchema = z.object({
  address: z.string().nullable().optional().default(null),
  kelurahan: z.string().nullable().optional().default(null),
  kecamatan: z.string().nullable().optional().default(null),
  kota: z.string().nullable().optional().default(null),
  lat: z.number().nullable().optional().default(null),
  lng: z.number().nullable().optional().default(null),
  deletedAt: z.string(),
});

export type AddressTombstone = z.infer<typeof AddressTombstoneSchema>;

export const MAX_ADDRESS_TOMBSTONES = 20;
export const TOMBSTONE_MAX_AGE_DAYS = 90;

/** Baca daftar tombstone dari preferences JSON (tahan data kotor). */
export function parseAddressTombstones(preferences: unknown): AddressTombstone[] {
  const raw = (preferences as any)?.address_tombstones;
  if (!Array.isArray(raw)) return [];
  const out: AddressTombstone[] = [];
  for (const item of raw) {
    const parsed = AddressTombstoneSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Buang tombstone yang sudah kedaluwarsa (>90 hari) dan batasi maksimal 20 FIFO. */
export function pruneAddressTombstones(
  list: AddressTombstone[],
  nowIso = new Date().toISOString(),
  maxAgeDays = TOMBSTONE_MAX_AGE_DAYS
): AddressTombstone[] {
  const cutoffMs = new Date(nowIso).getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return list
    .filter((t) => {
      const tMs = new Date(t.deletedAt).getTime();
      return !Number.isNaN(tMs) && tMs >= cutoffMs;
    })
    .sort((a, b) => new Date(a.deletedAt).getTime() - new Date(b.deletedAt).getTime())
    .slice(-MAX_ADDRESS_TOMBSTONES);
}

/** Cek apakah input alamat cocok dengan sebuah tombstone (menggunakan semantik addressesMatch). */
export function matchesTombstone(
  tombstone: AddressTombstone,
  input: UpsertSavedAddressInput
): boolean {
  return addressesMatch(
    {
      address: tombstone.address ?? '',
      kelurahan: tombstone.kelurahan,
      kecamatan: tombstone.kecamatan,
      kota: tombstone.kota,
      lat: tombstone.lat,
      lng: tombstone.lng,
    },
    input
  );
}

/** Hapus tombstone yang cocok saat admin/pelanggan secara sengaja mendaftarkan kembali alamat tersebut. */
export function removeMatchingTombstones(
  list: AddressTombstone[],
  input: UpsertSavedAddressInput
): AddressTombstone[] {
  return list.filter((t) => !matchesTombstone(t, input));
}

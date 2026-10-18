/**
 * Domain: Buku Alamat Pelanggan (Multi-Address Support) — FUNGSI MURNI.
 *
 * Fondasi state machine buku alamat: seluruh keputusan (dedup, label unik,
 * primary tunggal, resolusi alamat aktif) dihitung DETERMINISTIK di sini dari
 * data, BUKAN dari pencocokan kalimat pengguna. Service hanya menyimpan/membaca
 * hasilnya ke `Customer.preferences.saved_addresses` (zero-migration).
 *
 * Invarian:
 *  - `isPrimary` tepat 1 bila daftar tidak kosong.
 *  - Label unik per customer (auto-suffix angka bila kembar).
 *  - Dedup ketat: dua rumah beda jalan dalam kecamatan sama TETAP 2 entri;
 *    hanya alamat identik (jalan+kelurahan+kecamatan) atau titik <150 m yang digabung.
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';

export const MAX_SAVED_ADDRESSES = 10;
export const SAME_POINT_MAX_METERS = 150;
/** Batas panjang label kartu alamat (teknis, bukan data bisnis) — UI + API + domain. */
export const MAX_ADDRESS_LABEL_LENGTH = 60;

/** Normalisasi label: trim, buang kosong, potong ke batas maksimum. */
export function normalizeAddressLabel(value?: string | null): string | null {
  const clean = String(value ?? '').trim();
  if (!clean) return null;
  return clean.slice(0, MAX_ADDRESS_LABEL_LENGTH);
}

export const SavedCustomerAddressSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  address: z.string().default(''),
  kelurahan: z.string().nullable().optional().default(null),
  kecamatan: z.string().nullable().optional().default(null),
  kota: z.string().nullable().optional().default(null),
  lat: z.number().nullable().optional().default(null),
  lng: z.number().nullable().optional().default(null),
  distanceKm: z.number().nullable().optional().default(null),
  ongkir: z.number().nullable().optional().default(null),
  landmark: z.string().nullable().optional().default(null),
  locationSource: z
    .enum(['gps_pin', 'estimated_area', 'manual_staff'])
    .nullable()
    .optional()
    .default(null),
  isPrimary: z.boolean().optional().default(false),
  createdAt: z.string(),
  lastUsedAt: z.string(),
});

export type SavedCustomerAddress = z.infer<typeof SavedCustomerAddressSchema>;

export interface UpsertSavedAddressInput {
  id?: string;
  label?: string;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm?: number | null;
  ongkir?: number | null;
  landmark?: string | null;
  locationSource?: 'gps_pin' | 'estimated_area' | 'manual_staff' | null;
  isPrimary?: boolean;
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

/** Jarak Haversine meter (fallback tanpa network — sejalan DeliveryService). */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bothCoords(
  a: { lat?: number | null; lng?: number | null },
  b: { lat?: number | null; lng?: number | null }
): boolean {
  return typeof a.lat === 'number' && typeof a.lng === 'number' && typeof b.lat === 'number' && typeof b.lng === 'number';
}

/**
 * Dedup deterministik. Dua entri dianggap RUMAH SAMA bila:
 *  1. titik <150 m (bukti fisik), ATAU
 *  2. alamat jalan + kelurahan + kecamatan identik (keduanya punya jalan), ATAU
 *  3. hanya wilayah (tanpa jalan) + kelurahan + kecamatan + kota identik.
 * Beda jalan dalam kecamatan sama → TIDAK match (biar 2 rumah tetap terpisah).
 */
export function addressesMatch(
  a: UpsertSavedAddressInput,
  b: UpsertSavedAddressInput,
  maxMeters = SAME_POINT_MAX_METERS
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

  // Aturan: jalan sama + kecamatan sama + desa kompatibel = COCOK.
  // Dua desa SAMA-SAMA isi tapi BEDA -> TETAP TIDAK cocok (Rumah-2 sah).
  if (sameStreet && sameKec && kelKompatibel) return true;
  // Tanpa detail jalan di kedua sisi: samakan bila wilayah desa/kecamatan identik.
  if (!aAddr && !bAddr && sameKel && sameKec) return true;
  // Pengayaan asimetris (ghost primary 2026-10-12): tepat SATU sisi kosong
  // (tanpa teks jalan) dan wilayahnya cocok → rumah yang SAMA sedang
  // dilengkapi, bukan rumah baru. Syarat kecamatan sama; kelurahan sama bila
  // keduanya terisi (sisi yang belum punya kelurahan boleh mengikuti).
  // Dua sisi ber-teleks beda jalan → tetap TIDAK match (rumah-2 aman).
  if (aAddr !== bAddr && sameKec) {
    const kelOk =
      sameKel ||
      !hasText(a.kelurahan) ||
      !hasText(b.kelurahan);
    if (kelOk) return true;
  }
  return false;
}

/** Baca daftar dari preferences JSON (tahan data kotor — entri invalid dibuang). */
export function parseSavedAddresses(preferences: unknown): SavedCustomerAddress[] {
  const raw = (preferences as any)?.saved_addresses;
  if (!Array.isArray(raw)) return [];
  const out: SavedCustomerAddress[] = [];
  for (const item of raw) {
    const parsed = SavedCustomerAddressSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Label otomatis data-driven + anti-kembar ("Rumah Waru", "Rumah Waru 2"). */
export function buildAutoLabel(
  existing: SavedCustomerAddress[],
  place?: string | null,
  requested?: string | null
): string {
  const clean = (s?: string | null) => String(s ?? '').trim();
  const base =
    normalizeAddressLabel(requested) || `Rumah ${clean(place) || 'Baru'}`.slice(0, MAX_ADDRESS_LABEL_LENGTH);
  if (!existing.some((a) => norm(a.label) === norm(base))) return base;
  let i = 2;
  while (existing.some((a) => norm(a.label) === norm(`${base} ${i}`))) i++;
  return `${base} ${i}`.slice(0, MAX_ADDRESS_LABEL_LENGTH);
}

function pickDefined<T extends Record<string, any>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

/** Pastikan tepat 1 primary (atau tidak ada bila daftar kosong). */
export function ensureSinglePrimary(
  list: SavedCustomerAddress[],
  primaryId?: string
): SavedCustomerAddress[] {
  if (list.length === 0) return list;
  let id = primaryId && list.some((a) => a.id === primaryId) ? primaryId : undefined;
  if (!id) {
    const existing = list.find((a) => a.isPrimary);
    id = existing?.id || resolveActiveAddress(list)?.id;
  }
  return list.map((a) => ({ ...a, isPrimary: a.id === id }));
}

/** Alamat aktif: primary menang; fallback `lastUsedAt` terbaru. */
export function resolveActiveAddress(list: SavedCustomerAddress[]): SavedCustomerAddress | null {
  if (list.length === 0) return null;
  const primary = list.find((a) => a.isPrimary);
  if (primary) return primary;
  return [...list].sort((x, y) => (x.lastUsedAt < y.lastUsedAt ? 1 : -1))[0] || null;
}

/**
 * Penghapusan kartu dari buku alamat (murni). Invarian tetap dijaga:
 * bila daftar tersisa tidak kosong, tepat 1 kartu menangkap gelar primary
 * (kartu `lastUsedAt` terbaru) via ensureSinglePrimary. Idempoten: id yang
 * tidak ada → daftar utuh + removed null.
 */
export function removeAddressFromList(
  list: SavedCustomerAddress[],
  addressId: string
): { list: SavedCustomerAddress[]; removed: SavedCustomerAddress | null } {
  const removed = list.find((a) => a.id === addressId) || null;
  const next = list.filter((a) => a.id !== addressId);
  return { list: next.length > 0 ? ensureSinglePrimary(next) : next, removed };
}

export interface UpsertResult {
  list: SavedCustomerAddress[];
  entry: SavedCustomerAddress;
}

/**
 * Update-tambah atomik (murni). Entri yang match diperbarui (ID & createdAt tetap);
 * bila tidak match → entri baru. Selalu menandai entri ini sebagai `lastUsedAt` terbaru.
 * Kapasitas dijaga FIFO untuk entri NON-primary.
 */
export function upsertAddressIntoList(
  list: SavedCustomerAddress[],
  input: UpsertSavedAddressInput,
  nowIso: string
): UpsertResult {
  const idx = list.findIndex((a) => addressesMatch(a, input));
  const place = input.kecamatan || input.kota || null;

  if (idx >= 0) {
    const prev = list[idx];
    const nextLat = typeof input.lat === 'number' && Number.isFinite(input.lat) ? input.lat : prev.lat;
    const nextLng = typeof input.lng === 'number' && Number.isFinite(input.lng) ? input.lng : prev.lng;
    const nextDistanceKm = typeof input.distanceKm === 'number' && Number.isFinite(input.distanceKm) ? input.distanceKm : prev.distanceKm;
    const nextOngkir = typeof input.ongkir === 'number' && Number.isFinite(input.ongkir) ? input.ongkir : prev.ongkir;
    const nextLandmark = hasText(input.landmark) ? input.landmark : prev.landmark;

    // Hormati kunci gps_pin: gps_pin tidak boleh diturunkan oleh input teks/manual
    let nextLocSource = prev.locationSource;
    if (prev.locationSource === 'gps_pin') {
      nextLocSource = 'gps_pin';
    } else if (input.locationSource != null) {
      nextLocSource = input.locationSource;
    }

    const merged: SavedCustomerAddress = {
      ...prev,
      address: hasText(input.address) ? String(input.address) : prev.address,
      kelurahan: hasText(input.kelurahan) ? input.kelurahan! : (prev.kelurahan ?? null),
      kecamatan: hasText(input.kecamatan) ? input.kecamatan! : (prev.kecamatan ?? null),
      kota: hasText(input.kota) ? input.kota! : (prev.kota ?? null),
      lat: nextLat ?? null,
      lng: nextLng ?? null,
      distanceKm: nextDistanceKm ?? null,
      ongkir: nextOngkir ?? null,
      landmark: hasText(input.landmark) ? input.landmark! : (prev.landmark ?? null),
      locationSource: nextLocSource ?? null,
      label: normalizeAddressLabel(input.label) ?? prev.label,
      // input.isPrimary === true → jadikan entri ini primary (pindah rumah eksplisit).
      isPrimary: input.isPrimary === true ? true : prev.isPrimary,
      id: prev.id,
      createdAt: prev.createdAt,
      lastUsedAt: nowIso,
    };
    const next = list.slice();
    next[idx] = merged;
    return {
      list: ensureSinglePrimary(next, input.isPrimary === true ? merged.id : undefined),
      entry: merged,
    };
  }

  const entry: SavedCustomerAddress = {
    id: input.id && input.id.trim() ? input.id.trim() : randomUUID(),
    label: buildAutoLabel(list, place, input.label),
    address: String(input.address ?? ''),
    kelurahan: input.kelurahan ?? null,
    kecamatan: input.kecamatan ?? null,
    kota: input.kota ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    distanceKm: input.distanceKm ?? null,
    ongkir: input.ongkir ?? null,
    landmark: input.landmark ?? null,
    locationSource: input.locationSource ?? null,
    isPrimary: input.isPrimary ?? list.length === 0,
    createdAt: nowIso,
    lastUsedAt: nowIso,
  };
  let next = [...list, entry];
  if (next.length > MAX_SAVED_ADDRESSES) {
    // FIFO: buang non-primary terlama (jangan buang primary / entri baru).
    const removable = next
      .filter((a) => !a.isPrimary && a.id !== entry.id)
      .sort((x, y) => (x.lastUsedAt < y.lastUsedAt ? -1 : 1));
    while (next.length > MAX_SAVED_ADDRESSES && removable.length > 0) {
      const victim = removable.shift()!;
      next = next.filter((a) => a.id !== victim.id);
    }
  }
  return { list: ensureSinglePrimary(next), entry };
}

// ── Address Tombstones (F-3 / S-3) ──────────────────────────────────────────

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


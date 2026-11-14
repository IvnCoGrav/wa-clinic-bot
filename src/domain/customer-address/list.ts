/**
 * DOM-02: operasi daftar buku alamat (murni, tanpa I/O).
 */
import { randomUUID } from 'crypto';
import {
  MAX_SAVED_ADDRESSES,
  MAX_ADDRESS_LABEL_LENGTH,
  SavedCustomerAddressSchema,
  normalizeAddressLabel,
  type SavedCustomerAddress,
  type UpsertResult,
  type UpsertSavedAddressInput,
} from './types';
import { hasText, norm } from './internal';
import { addressesMatch } from './matching';

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
    normalizeAddressLabel(requested) ||
    `Rumah ${clean(place) || 'Baru'}`.slice(0, MAX_ADDRESS_LABEL_LENGTH);
  if (!existing.some((a) => norm(a.label) === norm(base))) return base;
  let i = 2;
  while (existing.some((a) => norm(a.label) === norm(`${base} ${i}`))) i++;
  return `${base} ${i}`.slice(0, MAX_ADDRESS_LABEL_LENGTH);
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

/**
 * Rekonsiliasi dua sumber buku alamat (murni, tanpa I/O).
 *
 * `canonical` WAJIB menang (tabel `customer_addresses` = sumber operasional
 * reservasi/staf). `secondary` (cache `preferences.saved_addresses`) hanya
 * menyumbang kartu yang BELUM ada di kanonis — baik berdasarkan id maupun
 * identitas rumah (`addressesMatch`), sehingga drift lama tidak hilang tetapi
 * juga tidak menghasilkan kartu ganda.
 *
 * Invarian: tepat 1 primary bila hasil tidak kosong; primary kanonis diutamakan.
 */
export function reconcileAddressLists(
  canonical: SavedCustomerAddress[],
  secondary: SavedCustomerAddress[]
): SavedCustomerAddress[] {
  const merged = canonical.slice();
  for (const candidate of secondary) {
    if (merged.some((a) => a.id === candidate.id)) continue;
    if (merged.some((a) => addressesMatch(a, candidate))) continue;
    merged.push(candidate);
  }
  if (merged.length === 0) return merged;
  const preferredPrimaryId =
    canonical.find((a) => a.isPrimary)?.id ?? secondary.find((a) => a.isPrimary)?.id;
  return ensureSinglePrimary(merged, preferredPrimaryId);
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
  const targetId = input.id ? input.id.trim() : null;
  const byIdIdx = targetId ? list.findIndex((a) => a.id === targetId) : -1;
  const idx = byIdIdx >= 0 ? byIdIdx : list.findIndex((a) => addressesMatch(a, input));
  const place = input.kecamatan || input.kota || null;

  if (idx >= 0) {
    const prev = list[idx];
    // ANTI-DOWNGRADE: kartu gps_pin tidak boleh kehilangan koordinat presisi
    // karena input teks/manual/estimasi. Koordinat hanya boleh berubah bila
    // input benar-benar pin GPS baru.
    const preservePreciseCoords =
      prev.locationSource === 'gps_pin' && input.locationSource !== 'gps_pin';
    const nextLat = preservePreciseCoords
      ? prev.lat
      : typeof input.lat === 'number' && Number.isFinite(input.lat)
        ? input.lat
        : prev.lat;
    const nextLng = preservePreciseCoords
      ? prev.lng
      : typeof input.lng === 'number' && Number.isFinite(input.lng)
        ? input.lng
        : prev.lng;
    const nextDistanceKm =
      typeof input.distanceKm === 'number' && Number.isFinite(input.distanceKm)
        ? input.distanceKm
        : prev.distanceKm;
    const nextOngkir =
      typeof input.ongkir === 'number' && Number.isFinite(input.ongkir)
        ? input.ongkir
        : prev.ongkir;
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
      kelurahan: hasText(input.kelurahan) ? input.kelurahan! : prev.kelurahan ?? null,
      kecamatan: hasText(input.kecamatan) ? input.kecamatan! : prev.kecamatan ?? null,
      kota: hasText(input.kota) ? input.kota! : prev.kota ?? null,
      lat: nextLat ?? null,
      lng: nextLng ?? null,
      distanceKm: nextDistanceKm ?? null,
      ongkir: nextOngkir ?? null,
      landmark: hasText(input.landmark) ? input.landmark! : prev.landmark ?? null,
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
  return { list: ensureSinglePrimary(next, input.isPrimary === true ? entry.id : undefined), entry };
}

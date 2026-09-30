/**
 * location-drift.ts
 * Gerbang MURNI (pure, tanpa I/O & tanpa DB) untuk memutuskan apakah lokasi
 * pelanggan perlu direkonsiliasi. Berbasis STATE kolom DB (location_source,
 * kelurahan, koordinat) — BUKAN pencocokan kalimat.
 *
 * Dipisah dari skrip `reconcile-trapped-customer-locations.ts` agar dapat
 * diuji tanpa menyeret koneksi Prisma.
 */
import { haversineKm } from './gazetteer';

export interface StoredLocation {
  kelurahan?: string | null;
  kecamatan?: string | null;
  lat?: number | null;
  lng?: number | null;
  location_source?: string | null;
  preferences?: unknown;
}

export interface ResolvedLocation {
  kelurahan?: string | null;
  kecamatan?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export type DriftReason =
  | 'locked_manual_staff'
  | 'no_reference_text'
  | 'no_resolution'
  | 'kelurahan_mismatch'
  | 'ok';

export interface DriftDecision {
  shouldReconcile: boolean;
  reason: DriftReason;
  /** Jarak (km) antara titik tersimpan dan hasil resolve ulang; null bila tak bisa dihitung. */
  driftKm: number | null;
}

/**
 * Putuskan apakah lokasi pelanggan perlu direkonsiliasi.
 * Prioritas: terkunci staf > tanpa rujukan > resolve gagal > beda kelurahan.
 *
 * Catatan: TIDAK ada heuristik "titik air" — audit Google Maps membuktikan
 * koordinat timur dataset (mis. Tambakoso 112.8135) memang titik darat yang
 * sah, sehingga ambang longitude bukan sinyal andal.
 */
export function classifyLocationDrift(
  stored: StoredLocation,
  resolved: ResolvedLocation | null,
  referenceText: string | null
): DriftDecision {
  // 1. Terkunci staf → JANGAN pernah ditimpa otomasi.
  if ((stored.location_source || '') === 'manual_staff') {
    return { shouldReconcile: false, reason: 'locked_manual_staff', driftKm: null };
  }

  // 2. Tanpa teks rujukan (alamat/nama) → tidak ada dasar resolve ulang.
  if (!referenceText || !referenceText.trim()) {
    return { shouldReconcile: false, reason: 'no_reference_text', driftKm: null };
  }

  // 3. Resolve ulang gagal → jangan mengarang.
  if (!resolved || resolved.lat == null || resolved.lng == null) {
    return { shouldReconcile: false, reason: 'no_resolution', driftKm: null };
  }

  // 4. Hitung drift bila koordinat lama ada.
  let driftKm: number | null = null;
  if (stored.lat != null && stored.lng != null) {
    driftKm = haversineKm(stored.lat, stored.lng, resolved.lat, resolved.lng);
  }

  // 5. Hijack sentroid: kelurahan tersimpan BEDA dari hasil resolve ulang.
  const storedKel = (stored.kelurahan || '').trim().toLowerCase();
  const resolvedKel = (resolved.kelurahan || '').trim().toLowerCase();
  if (storedKel && resolvedKel && storedKel !== resolvedKel) {
    return { shouldReconcile: true, reason: 'kelurahan_mismatch', driftKm };
  }

  return { shouldReconcile: false, reason: 'ok', driftKm };
}

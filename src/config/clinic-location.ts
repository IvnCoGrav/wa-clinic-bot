/**
 * clinic-location.ts
 * Sumber tunggal lokasi fisik (basecamp) klinik + batas jangkauan layanan.
 *
 * Multi-tenant: override per-tenant dibaca dari kolom `Tenant.settings`
 * (`settings.clinicLocation = { lat?, lng?, name?, maxCoverageKm? }`) via
 * `getClinicLocationAsync(tenantId)` dengan in-memory cache per-tenant. Tanpa
 * override → default dari env `clinicConfig` (zero behavior change).
 *
 * Pola identik `brand.ts` — business data tenant-aware, fallback aman saat DB
 * offline atau kolom belum termigrasi.
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';
import { clinicConfig } from './clinic';
import { isMissingColumnError } from '../utils/prisma-errors';

export interface ClinicLocation {
  lat: number;
  lng: number;
  name: string;
  /** Batas maksimal jangkauan layanan (km). Sumber utama coverage tetap tier ongkir DB. */
  maxCoverageKm: number;
}

export const DEFAULT_CLINIC_LOCATION: ClinicLocation = {
  lat: clinicConfig.lat,
  lng: clinicConfig.lng,
  name: clinicConfig.name,
  maxCoverageKm: clinicConfig.maxDeliveryDistanceKm,
};

const clinicLocationCache = new Map<string, ClinicLocation>();

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * Varian async tenant-aware: overlay `Tenant.settings.clinicLocation` di atas
 * default. Best-effort penuh — DB offline / tenant tanpa override → default.
 */
export async function getClinicLocationAsync(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<ClinicLocation> {
  const cached = clinicLocationCache.get(tenantId);
  if (cached) return cached;

  let resolved: ClinicLocation = { ...DEFAULT_CLINIC_LOCATION };
  try {
    // Cast `as any` karena generated client bisa lag dari schema (pola brand.ts).
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const override = (tenant?.settings as any)?.clinicLocation;
    if (override && typeof override === 'object') {
      const lat = toFiniteNumber(override.lat);
      const lng = toFiniteNumber(override.lng);
      const maxCoverageKm = toFiniteNumber(override.maxCoverageKm);
      const name =
        typeof override.name === 'string' && override.name.trim()
          ? override.name.trim()
          : resolved.name;
      resolved = {
        lat: lat ?? resolved.lat,
        lng: lng ?? resolved.lng,
        name,
        maxCoverageKm: maxCoverageKm != null && maxCoverageKm > 0 ? maxCoverageKm : resolved.maxCoverageKm,
      };
    }
  } catch (err: any) {
    if (!isMissingColumnError(err, 'settings')) {
      console.warn(
        `[CLINIC_LOCATION] Gagal load override tenant ${tenantId}, gunakan default:`,
        err.message
      );
    }
  }

  clinicLocationCache.set(tenantId, resolved);
  return resolved;
}

/** Varian sinkron (default) — untuk jalur yang tidak butuh override tenant. */
export function getClinicLocation(): ClinicLocation {
  return { ...DEFAULT_CLINIC_LOCATION };
}

/** Clear cache untuk testing. */
export function __clearClinicLocationCacheForTest(tenantId?: string): void {
  if (tenantId) clinicLocationCache.delete(tenantId);
  else clinicLocationCache.clear();
}

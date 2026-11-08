import { LocationSource } from '@prisma/client';

// In-Memory store fallback — HANYA untuk test offline (VITEST). Produksi: fail-fast + alert.
export const memoryCustomers = new Map<string, any>();

export function isTestRuntime(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
}

export type CustomerNameSource = 'pushname' | 'sync' | 'reservation' | 'admin';

export const NAME_SOURCE_RANK: Record<string, number> = {
  unknown: 0,
  pushname: 1,
  sync: 1,
  reservation: 2,
  admin: 3,
};

/**
 * Koerce input koordinat (bisa string dari WAHA/LLM/DB) menjadi number,
 * demi menghindari error Prisma "Expected Float, provided String".
 * null/undefined/NaN → null.
 */
export function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * Gerbang deterministik: apakah customer sudah memiliki koordinat PRESISI
 * (pin GPS asli / shareloc native / link Maps ber-koordinat) yang WAJIB
 * dilindungi dari penimpaan oleh hasil geocoding teks / sentroid gazetteer.
 */
export function isPreciseGps(c: any): boolean {
  if (!c) return false;
  if (c.lat == null || c.lng == null) return false;
  return c.location_source === LocationSource.gps_pin || c.share_location_sent === true;
}

export interface CustomerGroundTruth {
  name: string | null;
  activeServices: string[];
  historicalServices: string[];
  preferences?: Record<string, any>;
}

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';

/**
 * Konfigurasi jendela akses chat per-jadwal untuk terapis (data-driven, tenant-aware).
 *
 * Aturan bisnis (dapat di-override per-tenant tanpa deploy ulang):
 * - Chat terbuka mulai `openHoursBefore` jam sebelum jam treatment.
 * - Chat tertutup `closeHoursAfter` jam setelah treatment ditandai selesai.
 * - Pergantian hari WIB (00:00) menutup akses secara absolut, terlepas dari
 *   `closeHoursAfter` (mencegah akses lintas hari untuk riwayat lampau).
 *
 * Sumber nilai (prioritas):
 * 1. Cache in-memory (TTL 5 menit)
 * 2. DB `Tenant.settings.staffChatWindow = { openHoursBefore, closeHoursAfter }`
 * 3. Default: 3 jam / 3 jam
 */
export interface StaffChatWindowConfig {
  openHoursBefore: number; // default 3
  closeHoursAfter: number; // default 3
}

const DEFAULT_STAFF_CHAT_WINDOW_CONFIG: StaffChatWindowConfig = {
  openHoursBefore: 3,
  closeHoursAfter: 3,
};

const MIN_HOURS = 0;
const MAX_HOURS = 24;

const configCache = new Map<string, { config: StaffChatWindowConfig; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function sanitizeHours(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.floor(n)));
  return clamped;
}

export async function getStaffChatWindowConfig(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<StaffChatWindowConfig> {
  const cached = configCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  let resolved: StaffChatWindowConfig = { ...DEFAULT_STAFF_CHAT_WINDOW_CONFIG };

  try {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const override = (tenant?.settings as any)?.staffChatWindow;
    if (override && typeof override === 'object') {
      resolved = {
        openHoursBefore: sanitizeHours(override.openHoursBefore, resolved.openHoursBefore),
        closeHoursAfter: sanitizeHours(override.closeHoursAfter, resolved.closeHoursAfter),
      };
    }
  } catch {
    // DB offline / schema lag -> fallback ke default deterministik
  }

  configCache.set(tenantId, { config: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

export function clearStaffChatWindowConfigCache(tenantId?: string): void {
  if (tenantId) {
    configCache.delete(tenantId);
  } else {
    configCache.clear();
  }
}

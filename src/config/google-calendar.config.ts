import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';

/**
 * google-calendar.config.ts — konfigurasi Google Calendar PER TENANT (I-006).
 *
 * Sebelumnya service hanya membaca `GOOGLE_CALENDAR_ID` dari env, sehingga
 * semua tenant menulis ke satu kalender yang sama. Sekarang:
 * - `Tenant.settings.googleCalendar = { enabled?: boolean, calendarId?: string }`
 *   menentukan kalender tujuan & apakah sinkronisasi aktif untuk tenant itu.
 * - Kredensial service account tetap dari env (satu service account boleh
 *   di-share ke beberapa kalender). Ini menghindari penyimpanan private key
 *   di kolom JSON yang bisa terbaca lewat API settings.
 * - Tanpa konfigurasi / DB offline → perilaku lama: `GOOGLE_CALENDAR_ID` atau
 *   `primary`, sinkronisasi aktif (zero behavior change).
 */

export interface GoogleCalendarConfig {
  enabled: boolean;
  calendarId: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CALENDAR_ID_LENGTH = 320;

const configCache = new Map<string, { config: GoogleCalendarConfig; expiresAt: number }>();

export function parseGoogleCalendarConfig(raw: unknown, fallbackCalendarId: string): GoogleCalendarConfig {
  const fallback: GoogleCalendarConfig = {
    enabled: true,
    calendarId: fallbackCalendarId || 'primary',
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;

  const enabled =
    typeof (raw as any).enabled === 'boolean' ? (raw as any).enabled : fallback.enabled;
  const rawId = (raw as any).calendarId;
  const calendarId =
    typeof rawId === 'string' &&
    rawId.trim().length > 0 &&
    rawId.trim().length <= MAX_CALENDAR_ID_LENGTH &&
    !/[\r\n\t]/.test(rawId)
      ? rawId.trim()
      : fallback.calendarId;

  return { enabled, calendarId };
}

export async function getGoogleCalendarConfig(
  tenantId: string = DEFAULT_TENANT_ID,
  fallbackCalendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<GoogleCalendarConfig> {
  const cacheKey = `${tenantId}::${fallbackCalendarId}`;
  const cached = configCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  let resolved: GoogleCalendarConfig;
  try {
    const tenant = await (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { settings: true },
    });
    resolved = parseGoogleCalendarConfig(
      (tenant?.settings as any)?.googleCalendar,
      fallbackCalendarId
    );
  } catch {
    // DB offline / kolom belum ada → perilaku lama (env).
    resolved = parseGoogleCalendarConfig(null, fallbackCalendarId);
  }

  configCache.set(cacheKey, { config: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

export function clearGoogleCalendarConfigCache(tenantId?: string): void {
  if (!tenantId) {
    configCache.clear();
    return;
  }
  for (const key of Array.from(configCache.keys())) {
    if (key.startsWith(`${tenantId}::`)) configCache.delete(key);
  }
}

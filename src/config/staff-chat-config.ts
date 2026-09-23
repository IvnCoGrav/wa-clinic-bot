import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';

export interface StaffChatNotificationConfig {
  enabled: boolean;
  startHourWib: number; // 0-23 (default 7)
  endHourWib: number;   // 0-23 (default 21)
}

const DEFAULT_STAFF_CHAT_CONFIG: StaffChatNotificationConfig = {
  enabled: true,
  startHourWib: 7,
  endHourWib: 21,
};

// In-memory cache per tenant dengan TTL 5 menit
const configCache = new Map<string, { config: StaffChatNotificationConfig; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Mengambil konfigurasi jam notifikasi chat staf untuk tenant tertentu.
 * Urutan prioritas:
 * 1. Cache in-memory
 * 2. Database: `Tenant.settings.staffChatNotification`
 * 3. Database: `ClinicPolicy` topic 'operational_hours_and_booking' (ekstraksi jam)
 * 4. Default: 07:00 - 21:00 WIB
 */
export async function getStaffChatNotificationConfig(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<StaffChatNotificationConfig> {
  const cached = configCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  let resolved: StaffChatNotificationConfig = { ...DEFAULT_STAFF_CHAT_CONFIG };

  try {
    // 1. Cek Tenant.settings
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const override = (tenant?.settings as any)?.staffChatNotification;
    if (override && typeof override === 'object') {
      const enabled = typeof override.enabled === 'boolean' ? override.enabled : resolved.enabled;
      const startHour = Number.isInteger(override.startHourWib) && override.startHourWib >= 0 && override.startHourWib <= 23
        ? override.startHourWib
        : resolved.startHourWib;
      const endHour = Number.isInteger(override.endHourWib) && override.endHourWib >= 0 && override.endHourWib <= 23
        ? override.endHourWib
        : resolved.endHourWib;

      resolved = { enabled, startHourWib: startHour, endHourWib: endHour };
      configCache.set(tenantId, { config: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
      return resolved;
    }

    // 2. Cek ClinicPolicy topic 'operational_hours_and_booking'
    const policy = await (prisma as any).clinicPolicy.findUnique({
      where: { tenant_id_topic: { tenant_id: tenantId, topic: 'operational_hours_and_booking' } },
      select: { factual_summary: true, is_active: true },
    });

    if (policy && policy.is_active && policy.factual_summary) {
      // Contoh: "Layanan homecare buka setiap hari (Senin - Minggu) pukul 08.00 - 17.00 WIB"
      const match = policy.factual_summary.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
      if (match) {
        const rawStart = parseInt(match[1], 10);
        const rawEnd = parseInt(match[3], 10);
        if (!isNaN(rawStart) && !isNaN(rawEnd)) {
          // Berikan toleransi koordinasi 1 jam sebelum buka dan 2-4 jam setelah tutup (default chat window)
          resolved = {
            enabled: true,
            startHourWib: Math.max(0, rawStart - 1),
            endHourWib: Math.min(23, rawEnd + 4),
          };
        }
      }
    }
  } catch (err: any) {
    // Database offline / schema lag fallback ke default
  }

  configCache.set(tenantId, { config: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

/**
 * Memeriksa apakah saat ini berada dalam rentang jam notifikasi chat staf (dalam zona waktu WIB / Asia/Jakarta).
 */
export function isWithinWibHourRange(startHour: number, endHour: number, referenceDate: Date = new Date()): boolean {
  try {
    const wibHourStr = referenceDate.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Jakarta',
      hour12: false,
      hour: '2-digit',
    });
    const currentHour = parseInt(wibHourStr, 10);
    if (isNaN(currentHour)) {
      // Fallback manual UTC+7
      const fallbackHour = (referenceDate.getUTCHours() + 7) % 24;
      return fallbackHour >= startHour && fallbackHour < endHour;
    }
    return currentHour >= startHour && currentHour < endHour;
  } catch {
    const fallbackHour = (referenceDate.getUTCHours() + 7) % 24;
    return fallbackHour >= startHour && fallbackHour < endHour;
  }
}

/**
 * Menghapus cache konfigurasi notifikasi chat staf (misal setelah admin mengupdate pengaturan).
 */
export function clearStaffChatConfigCache(tenantId?: string): void {
  if (tenantId) {
    configCache.delete(tenantId);
  } else {
    configCache.clear();
  }
}

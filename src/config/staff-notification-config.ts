import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';

/**
 * Konfigurasi kanal notifikasi staf (data-driven, tenant-aware).
 *
 * Kebijakan "In-System PWA Only": notifikasi ke terapis WAJIB lewat in-system
 * (Web Push PWA + SSE LiveChatHub). Pengiriman Telegram eksternal ke akun
 * pribadi terapis DEFAULT OFF dan hanya boleh diaktifkan eksplisit per-tenant
 * lewat `Tenant.settings.staffNotification.telegramEnabled = true`.
 *
 * Sumber nilai (prioritas):
 * 1. Cache in-memory (TTL 5 menit)
 * 2. DB `Tenant.settings.staffNotification = { telegramEnabled: boolean }`
 * 3. Default deterministik: `false` (Telegram OFF)
 */
export interface StaffNotificationConfig {
  telegramEnabled: boolean;
}

const DEFAULT_STAFF_NOTIFICATION_CONFIG: StaffNotificationConfig = {
  telegramEnabled: false,
};

const configCache = new Map<string, { config: StaffNotificationConfig; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getStaffNotificationConfig(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<StaffNotificationConfig> {
  const cached = configCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  let resolved: StaffNotificationConfig = { ...DEFAULT_STAFF_NOTIFICATION_CONFIG };

  try {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const override = (tenant?.settings as any)?.staffNotification;
    if (override && typeof override === 'object' && typeof override.telegramEnabled === 'boolean') {
      resolved = { telegramEnabled: override.telegramEnabled };
    }
  } catch {
    // DB offline / schema lag -> default deterministik (Telegram OFF)
  }

  configCache.set(tenantId, { config: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

export function clearStaffNotificationConfigCache(tenantId?: string): void {
  if (tenantId) {
    configCache.delete(tenantId);
  } else {
    configCache.clear();
  }
}

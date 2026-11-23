/**
 * delay-watchdog-config.ts
 * Sumber tunggal setelan Delay Watchdog (peringatan dini keterlambatan keberangkatan bidan).
 *
 * Presedensi ambang:
 * 1) Tenant.settings.delayWatchdog.toleranceMinutes
 * 2) StaffScorecardPolicy.tolerance_minutes (via query DB)
 * 3) 30 menit (fallback default)
 *
 * Cache 5 menit per tenant, fail-safe saat DB offline.
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';
import { isMissingColumnError } from '../utils/prisma-errors';
import { normalizePhoneID } from '../utils/phone-normalizer';

export interface DelayWatchdogSettings {
  toleranceMinutes: number;      // default 30  (level "warning")
  criticalExtraMinutes: number;  // default 15  (level "critical" = tolerance + extra)
  maxPrevOriginGapHours: number; // default 3   (batas pakai alamat pasien sebelumnya)
  adminRecipients: string[];     // nomor admin/CS (E.164/08xx), maks 5
}

export const DEFAULT_DELAY_WATCHDOG_SETTINGS: DelayWatchdogSettings = {
  toleranceMinutes: 30,
  criticalExtraMinutes: 15,
  maxPrevOriginGapHours: 3,
  adminRecipients: [],
};

interface CachedDelayWatchdogSettings {
  settings: DelayWatchdogSettings;
  expiresAt: number;
}

const delayWatchdogCache = new Map<string, CachedDelayWatchdogSettings>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function clearDelayWatchdogCache(tenantId?: string): void {
  if (tenantId) {
    delayWatchdogCache.delete(tenantId);
  } else {
    delayWatchdogCache.clear();
  }
}

export async function getDelayWatchdogSettings(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<DelayWatchdogSettings> {
  const cached = delayWatchdogCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  let resolved: DelayWatchdogSettings = { ...DEFAULT_DELAY_WATCHDOG_SETTINGS };

  try {
    // 1. Coba baca override dari Tenant.settings
    const tenant = await (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { settings: true },
    });

    const override = (tenant?.settings as any)?.delayWatchdog;
    let tenantTolerance: number | null = null;
    let criticalExtra: number = DEFAULT_DELAY_WATCHDOG_SETTINGS.criticalExtraMinutes;
    let maxGap: number = DEFAULT_DELAY_WATCHDOG_SETTINGS.maxPrevOriginGapHours;
    let recipients: string[] = [];

    if (override && typeof override === 'object') {
      if (typeof override.toleranceMinutes === 'number' && Number.isFinite(override.toleranceMinutes)) {
        tenantTolerance = Math.round(override.toleranceMinutes);
      }
      if (typeof override.criticalExtraMinutes === 'number' && Number.isFinite(override.criticalExtraMinutes)) {
        criticalExtra = Math.round(override.criticalExtraMinutes);
      }
      if (typeof override.maxPrevOriginGapHours === 'number' && Number.isFinite(override.maxPrevOriginGapHours)) {
        maxGap = Math.round(override.maxPrevOriginGapHours);
      }
      if (Array.isArray(override.adminRecipients)) {
        recipients = override.adminRecipients
          .map((r: any) => normalizePhoneID(String(r || '')))
          .filter((p: string) => Boolean(p));
      }
    }

    // 2. Jika toleranceMinutes belum didapat dari Tenant.settings, baca dari StaffScorecardPolicy
    if (tenantTolerance == null) {
      try {
        const policy = await (prisma as any).staffScorecardPolicy?.findFirst?.({
          where: { tenant_id: tenantId },
          orderBy: { effective_from: 'desc' },
          select: { tolerance_minutes: true },
        });
        if (policy && typeof policy.tolerance_minutes === 'number' && Number.isFinite(policy.tolerance_minutes)) {
          tenantTolerance = policy.tolerance_minutes;
        }
      } catch {
        // Fallback aman saat tabel policy tidak ada atau DB offline
      }
    }

    resolved = {
      toleranceMinutes: tenantTolerance ?? DEFAULT_DELAY_WATCHDOG_SETTINGS.toleranceMinutes,
      criticalExtraMinutes: criticalExtra,
      maxPrevOriginGapHours: maxGap,
      adminRecipients: recipients,
    };
  } catch (err: any) {
    if (!isMissingColumnError(err, 'settings')) {
      console.warn(
        `[DELAY_WATCHDOG_CONFIG] Gagal memuat setelan tenant ${tenantId}, gunakan default:`,
        err?.message
      );
    }
  }

  delayWatchdogCache.set(tenantId, {
    settings: resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return resolved;
}

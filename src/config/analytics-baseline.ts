import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';

export type BaselineMode = 'weekday' | 'calendar';

export interface AnalyticsBaselineSettings {
  months: number;              // 1..12, default 6
  mode: BaselineMode;          // default 'weekday'
  smoothingWindowDays: number; // 0|3|5|7, hanya dipakai mode 'calendar'
  minMonths: number;           // 1..6, default 3
}

export const DEFAULT_ANALYTICS_BASELINE_SETTINGS: AnalyticsBaselineSettings = {
  months: 6,
  mode: 'weekday',
  smoothingWindowDays: 0,
  minMonths: 3,
};

const ALLOWED_SMOOTHING = new Set([0, 3, 5, 7]);
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

interface CachedBaselineSettings {
  settings: AnalyticsBaselineSettings;
  expiresAt: number;
}

const settingsCache = new Map<string, CachedBaselineSettings>();

/**
 * Normalisasi objek pengaturan baseline dengan validasi batas nilai ketat.
 */
export function normalizeAnalyticsBaselineSettings(raw: unknown): AnalyticsBaselineSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_ANALYTICS_BASELINE_SETTINGS };
  }

  const r = raw as Record<string, unknown>;

  // months: integer 1..12, default 6
  let months = DEFAULT_ANALYTICS_BASELINE_SETTINGS.months;
  const rawMonths = Number(r.months);
  if (Number.isInteger(rawMonths) && rawMonths >= 1 && rawMonths <= 12) {
    months = rawMonths;
  }

  // mode: 'weekday' | 'calendar', default 'weekday'
  let mode: BaselineMode = DEFAULT_ANALYTICS_BASELINE_SETTINGS.mode;
  if (r.mode === 'weekday' || r.mode === 'calendar') {
    mode = r.mode;
  }

  // smoothingWindowDays: 0, 3, 5, 7 (hanya untuk mode 'calendar', selain itu 0)
  let smoothingWindowDays = DEFAULT_ANALYTICS_BASELINE_SETTINGS.smoothingWindowDays;
  const rawSmoothing = Number(r.smoothingWindowDays);
  if (ALLOWED_SMOOTHING.has(rawSmoothing)) {
    smoothingWindowDays = rawSmoothing;
  }

  // minMonths: integer 1..6, default 3, tidak boleh melebihi months
  let minMonths = DEFAULT_ANALYTICS_BASELINE_SETTINGS.minMonths;
  const rawMinMonths = Number(r.minMonths);
  if (Number.isInteger(rawMinMonths) && rawMinMonths >= 1 && rawMinMonths <= 6) {
    minMonths = Math.min(rawMinMonths, months);
  } else {
    minMonths = Math.min(minMonths, months);
  }

  return {
    months,
    mode,
    smoothingWindowDays: mode === 'calendar' ? smoothingWindowDays : 0,
    minMonths,
  };
}

export const ALLOWED_BASELINE_MONTHS = [3, 6, 12] as const;
export type BaselineMonthsOverride = (typeof ALLOWED_BASELINE_MONTHS)[number];

/**
 * Terapkan override jendela baseline dari request TANPA memutasi settings tenant.
 * Nilai di luar 3/6/12 diabaikan (fallback ke konfigurasi tenant).
 */
export function resolveBaselineSettingsForRequest(
  settings: AnalyticsBaselineSettings,
  overrideMonths?: number | null
): AnalyticsBaselineSettings {
  if (overrideMonths === undefined || overrideMonths === null) {
    return { ...settings };
  }
  const months = Number(overrideMonths);
  if (!Number.isInteger(months) || !ALLOWED_BASELINE_MONTHS.includes(months as BaselineMonthsOverride)) {
    return { ...settings };
  }
  return {
    ...settings,
    months,
    minMonths: Math.min(settings.minMonths, months),
  };
}

/**
 * Mengambil konfigurasi baseline analitik untuk tenant tertentu.
 * Menggunakan in-memory cache dengan TTL 5 menit dan graceful fallback saat DB offline.
 */
export async function getAnalyticsBaselineSettings(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<AnalyticsBaselineSettings> {
  const cached = settingsCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  let resolved = { ...DEFAULT_ANALYTICS_BASELINE_SETTINGS };

  try {
    const tenant = await (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { settings: true },
    });

    const override = (tenant?.settings as any)?.analyticsBaseline;
    if (override && typeof override === 'object') {
      resolved = normalizeAnalyticsBaselineSettings(override);
    }
  } catch {
    // DB offline atau query error -> gunakan default aman
  }

  settingsCache.set(tenantId, {
    settings: resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return resolved;
}

/**
 * Membersihkan cache konfigurasi baseline (semua tenant atau per tenant spesifik).
 */
export function clearAnalyticsBaselineSettingsCache(tenantId?: string): void {
  if (tenantId) {
    settingsCache.delete(tenantId);
  } else {
    settingsCache.clear();
  }
}

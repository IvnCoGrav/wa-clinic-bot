import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';
import { getClinicLocationAsync, type ClinicLocation } from './clinic-location';
import { getOperationalHours, type OperationalHours } from './operational-hours';
import { getStaffNotificationConfig, type StaffNotificationConfig } from './staff-notification-config';
import { getBrandIdentityAsync, type BrandIdentity } from './brand';

/**
 * tenant-settings.config.ts — kontrak tulis/baca setelan tenant yang sebelumnya
 * hanya punya jalur baca (Cfg-011).
 *
 * Setelan berikut dulu tidak punya endpoint penulis sehingga admin harus
 * menyunting JSON DB secara manual:
 * - `settings.clinicLocation` (titik basecamp + batas jangkauan)
 * - `settings.operationalHours` (jam operasional WIB)
 * - `settings.staffNotification` (kanal notifikasi staf)
 * - `settings.deliverySettings.estimateTtlDays` (masa berlaku estimasi jarak)
 * - `settings.copilot.styleTone` (gaya bahasa ringkasan Copilot)
 * - `settings.brand` (identitas brand lengkap)
 *
 * Modul ini murni untuk bentuk data + validasi (mudah diuji tanpa HTTP/DB);
 * penulisan tetap lewat `updateTenantSettingsSafely` milik route settings agar
 * versioning/OCC (Cfg-008) tidak terduplikasi.
 */

export const DELIVERY_ESTIMATE_TTL_FALLBACK_DAYS = 14;
export const MIN_ESTIMATE_TTL_DAYS = 1;
export const MAX_ESTIMATE_TTL_DAYS = 365;

export interface DeliverySettings {
  estimateTtlDays: number;
}

export interface CopilotSettings {
  styleTone: string | null;
}

export interface TenantSettingsView {
  clinicLocation: ClinicLocation;
  operationalHours: OperationalHours;
  staffNotification: StaffNotificationConfig;
  deliverySettings: DeliverySettings;
  copilot: CopilotSettings;
  brand: BrandIdentity;
}

export interface ClinicLocationPatch {
  lat?: number;
  lng?: number;
  name?: string;
  maxCoverageKm?: number;
}

export interface TenantSettingsPatch {
  clinicLocation?: ClinicLocationPatch;
  operationalHours?: { startHourWib?: number; endHourWib?: number };
  staffNotification?: { telegramEnabled?: boolean };
  deliverySettings?: { estimateTtlDays?: number };
  /** `styleTone: null` menghapus override → prompt Copilot kembali ke default netral. */
  copilot?: { styleTone?: string | null };
  brand?: Partial<BrandIdentity>;
}

export type ParseResult =
  | { ok: true; patch: TenantSettingsPatch }
  | { ok: false; errors: string[] };

const CLINIC_LOCATION_KEYS = ['lat', 'lng', 'name', 'maxCoverageKm'] as const;
const BRAND_KEYS = [
  'botDisplayName',
  'businessName',
  'serviceType',
  'addressTermForCustomer',
  'logoUrl',
] as const;
const TOP_LEVEL_KEYS = [
  'clinicLocation',
  'operationalHours',
  'staffNotification',
  'deliverySettings',
  'copilot',
  'brand',
] as const;
const MAX_TEXT_LENGTH = 200;
const MAX_LOGO_URL_LENGTH = 500;

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(
  obj: Record<string, any>,
  allowed: readonly string[],
  prefix: string,
  errors: string[]
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(`${prefix}${key}: kunci tidak dikenal`);
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validasi PATCH setelan tenant. Menolak kunci tak dikenal (defense-in-depth:
 * endpoint tidak boleh menjadi jalur tulis JSON bebas), tipe salah, dan nilai
 * di luar batas aman. Semua pesan error memakai path agar UI bisa menandai field.
 */
export function parseTenantSettingsPatch(raw: unknown): ParseResult {
  const errors: string[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['Body wajib berupa objek JSON.'] };
  }

  rejectUnknownKeys(raw, TOP_LEVEL_KEYS, '', errors);

  const patch: TenantSettingsPatch = {};

  if (raw.clinicLocation !== undefined) {
    if (!isPlainObject(raw.clinicLocation)) {
      errors.push('clinicLocation harus berupa objek.');
    } else {
      rejectUnknownKeys(raw.clinicLocation, CLINIC_LOCATION_KEYS, 'clinicLocation.', errors);
      const src = raw.clinicLocation;
      const dst: ClinicLocationPatch = {};

      if (src.lat !== undefined) {
        if (!isFiniteNumber(src.lat) || src.lat < -90 || src.lat > 90) {
          errors.push('clinicLocation.lat harus angka antara -90 dan 90.');
        } else dst.lat = src.lat;
      }
      if (src.lng !== undefined) {
        if (!isFiniteNumber(src.lng) || src.lng < -180 || src.lng > 180) {
          errors.push('clinicLocation.lng harus angka antara -180 dan 180.');
        } else dst.lng = src.lng;
      }
      if (src.name !== undefined) {
        if (typeof src.name !== 'string' || !src.name.trim() || src.name.trim().length > MAX_TEXT_LENGTH) {
          errors.push(`clinicLocation.name wajib teks 1-${MAX_TEXT_LENGTH} karakter.`);
        } else dst.name = src.name.trim();
      }
      if (src.maxCoverageKm !== undefined) {
        if (!isFiniteNumber(src.maxCoverageKm) || src.maxCoverageKm <= 0 || src.maxCoverageKm > 1000) {
          errors.push('clinicLocation.maxCoverageKm harus angka > 0 dan <= 1000.');
        } else dst.maxCoverageKm = src.maxCoverageKm;
      }
      if (Object.keys(dst).length > 0) patch.clinicLocation = dst;
    }
  }

  if (raw.operationalHours !== undefined) {
    if (!isPlainObject(raw.operationalHours)) {
      errors.push('operationalHours harus berupa objek.');
    } else {
      rejectUnknownKeys(raw.operationalHours, ['startHourWib', 'endHourWib'], 'operationalHours.', errors);
      const src = raw.operationalHours;
      const dst: { startHourWib?: number; endHourWib?: number } = {};

      const isHour = (v: unknown): v is number =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;

      if (src.startHourWib !== undefined) {
        if (!isHour(src.startHourWib)) errors.push('operationalHours.startHourWib harus bilangan bulat 0-23.');
        else dst.startHourWib = src.startHourWib;
      }
      if (src.endHourWib !== undefined) {
        if (!isHour(src.endHourWib)) errors.push('operationalHours.endHourWib harus bilangan bulat 0-23.');
        else dst.endHourWib = src.endHourWib;
      }
      if (dst.startHourWib !== undefined && dst.endHourWib !== undefined && dst.startHourWib >= dst.endHourWib) {
        errors.push('operationalHours: startHourWib harus lebih kecil dari endHourWib.');
      }
      if (Object.keys(dst).length > 0) patch.operationalHours = dst;
    }
  }

  if (raw.staffNotification !== undefined) {
    if (!isPlainObject(raw.staffNotification)) {
      errors.push('staffNotification harus berupa objek.');
    } else {
      rejectUnknownKeys(raw.staffNotification, ['telegramEnabled'], 'staffNotification.', errors);
      if (raw.staffNotification.telegramEnabled !== undefined) {
        if (typeof raw.staffNotification.telegramEnabled !== 'boolean') {
          errors.push('staffNotification.telegramEnabled harus boolean.');
        } else {
          patch.staffNotification = { telegramEnabled: raw.staffNotification.telegramEnabled };
        }
      }
    }
  }

  if (raw.deliverySettings !== undefined) {
    if (!isPlainObject(raw.deliverySettings)) {
      errors.push('deliverySettings harus berupa objek.');
    } else {
      rejectUnknownKeys(raw.deliverySettings, ['estimateTtlDays'], 'deliverySettings.', errors);
      if (raw.deliverySettings.estimateTtlDays !== undefined) {
        const v = raw.deliverySettings.estimateTtlDays;
        if (
          typeof v !== 'number' ||
          !Number.isInteger(v) ||
          v < MIN_ESTIMATE_TTL_DAYS ||
          v > MAX_ESTIMATE_TTL_DAYS
        ) {
          errors.push(
            `deliverySettings.estimateTtlDays harus bilangan bulat ${MIN_ESTIMATE_TTL_DAYS}-${MAX_ESTIMATE_TTL_DAYS}.`
          );
        } else {
          patch.deliverySettings = { estimateTtlDays: v };
        }
      }
    }
  }

  if (raw.copilot !== undefined) {
    if (!isPlainObject(raw.copilot)) {
      errors.push('copilot harus berupa objek.');
    } else {
      rejectUnknownKeys(raw.copilot, ['styleTone'], 'copilot.', errors);
      if (raw.copilot.styleTone !== undefined) {
        const v = raw.copilot.styleTone;
        if (v === null || (typeof v === 'string' && !v.trim())) {
          patch.copilot = { styleTone: null };
        } else if (typeof v !== 'string' || v.trim().length > 500) {
          errors.push('copilot.styleTone harus teks maksimal 500 karakter atau null untuk menghapus.');
        } else {
          patch.copilot = { styleTone: v.trim() };
        }
      }
    }
  }

  if (raw.brand !== undefined) {
    if (!isPlainObject(raw.brand)) {
      errors.push('brand harus berupa objek.');
    } else {
      rejectUnknownKeys(raw.brand, BRAND_KEYS, 'brand.', errors);
      const dst: Partial<BrandIdentity> = {};
      for (const key of BRAND_KEYS) {
        const v = raw.brand[key];
        if (v === undefined) continue;
        if (typeof v !== 'string') {
          errors.push(`brand.${key} harus teks.`);
          continue;
        }
        const trimmed = v.trim();
        if (key === 'logoUrl') {
          if (trimmed.length > MAX_LOGO_URL_LENGTH) {
            errors.push(`brand.logoUrl maksimal ${MAX_LOGO_URL_LENGTH} karakter.`);
          } else if (trimmed && !/^(https?:\/\/|\/)/i.test(trimmed)) {
            errors.push('brand.logoUrl harus URL http(s) atau path relatif yang diawali "/".');
          } else if (trimmed) {
            dst.logoUrl = trimmed;
          }
          continue;
        }
        if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) {
          errors.push(`brand.${key} wajib teks 1-${MAX_TEXT_LENGTH} karakter.`);
          continue;
        }
        (dst as any)[key] = trimmed;
      }
      if (Object.keys(dst).length > 0) patch.brand = dst;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(patch).length === 0) {
    return { ok: false, errors: ['Tidak ada setelan yang dikirim.'] };
  }
  return { ok: true, patch };
}

/**
 * Gabungkan PATCH ke settings JSON yang ada TANPA menyentuh kunci lain
 * (mis. `aiConfig`, `integrationGuards`, `_version`). Murni & deterministik.
 */
export function applyTenantSettingsPatch(
  current: Record<string, any>,
  patch: TenantSettingsPatch
): Record<string, any> {
  const next: Record<string, any> = { ...current };

  if (patch.clinicLocation) {
    next.clinicLocation = { ...(isPlainObject(current.clinicLocation) ? current.clinicLocation : {}), ...patch.clinicLocation };
  }
  if (patch.operationalHours) {
    next.operationalHours = {
      ...(isPlainObject(current.operationalHours) ? current.operationalHours : {}),
      ...patch.operationalHours,
    };
  }
  if (patch.staffNotification) {
    next.staffNotification = {
      ...(isPlainObject(current.staffNotification) ? current.staffNotification : {}),
      ...patch.staffNotification,
    };
  }
  if (patch.deliverySettings) {
    next.deliverySettings = {
      ...(isPlainObject(current.deliverySettings) ? current.deliverySettings : {}),
      ...patch.deliverySettings,
    };
  }
  if (patch.copilot) {
    const copilot = { ...(isPlainObject(current.copilot) ? current.copilot : {}) };
    if (patch.copilot.styleTone === null) {
      delete copilot.styleTone;
    } else if (patch.copilot.styleTone !== undefined) {
      copilot.styleTone = patch.copilot.styleTone;
    }
    if (Object.keys(copilot).length > 0) next.copilot = copilot;
    else delete next.copilot;
  }
  if (patch.brand) {
    next.brand = { ...(isPlainObject(current.brand) ? current.brand : {}), ...patch.brand };
  }

  return next;
}

async function readDeliveryAndCopilot(
  tenantId: string
): Promise<{ deliverySettings: DeliverySettings; copilot: CopilotSettings }> {
  const fallback: { deliverySettings: DeliverySettings; copilot: CopilotSettings } = {
    deliverySettings: { estimateTtlDays: DELIVERY_ESTIMATE_TTL_FALLBACK_DAYS },
    copilot: { styleTone: null },
  };
  try {
    const tenant = await (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = isPlainObject(tenant?.settings) ? tenant.settings : {};
    const ttl = Number(settings.deliverySettings?.estimateTtlDays);
    const tone = settings.copilot?.styleTone;
    return {
      deliverySettings: {
        estimateTtlDays:
          Number.isFinite(ttl) && ttl >= MIN_ESTIMATE_TTL_DAYS && ttl <= MAX_ESTIMATE_TTL_DAYS
            ? Math.round(ttl)
            : DELIVERY_ESTIMATE_TTL_FALLBACK_DAYS,
      },
      copilot: { styleTone: typeof tone === 'string' && tone.trim() ? tone.trim() : null },
    };
  } catch {
    return fallback;
  }
}

/**
 * Nilai efektif (default + override tenant) untuk ditampilkan/diedit admin.
 * Semua reader sudah punya cache 5 menit & fallback aman saat DB offline.
 */
export async function getTenantSettingsView(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<TenantSettingsView> {
  const [clinicLocation, operationalHours, staffNotification, brand, extra] = await Promise.all([
    getClinicLocationAsync(tenantId),
    getOperationalHours(tenantId),
    getStaffNotificationConfig(tenantId),
    getBrandIdentityAsync(tenantId),
    readDeliveryAndCopilot(tenantId),
  ]);

  return {
    clinicLocation: { ...clinicLocation },
    operationalHours: { ...operationalHours },
    staffNotification: { ...staffNotification },
    deliverySettings: extra.deliverySettings,
    copilot: extra.copilot,
    brand: { ...brand },
  };
}

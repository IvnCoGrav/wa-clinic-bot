/**
 * brand.ts
 * Sumber tunggal identitas brand (nama bisnis, nama bot, panggilan customer).
 * Wajib: seluruh komponen (bot engine, dashboard, click-catcher) memakai brand dari sini,
 * bukan string literal tersebar. Nilai default ini adalah fallback.
 *
 * Multi-tenant (Plan 4): override per-tenant dibaca dari kolom `Tenant.settings`
 * (`settings.brand = { botDisplayName?, businessName?, serviceType?,
 * addressTermForCustomer? }`) via `getBrandIdentityAsync(tenantId)` dengan
 * in-memory cache per-tenant. Tanpa override → default di bawah (zero behavior change).
 * Varian sinkron `getBrandIdentity()` dipertahankan untuk kompatibilitas
 * (template dievaluasi saat module-load & jalur sinkron).
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';
import { isMissingColumnError } from '../utils/prisma-errors';

export interface BrandIdentity {
  botDisplayName: string;
  businessName: string;
  serviceType: string;
  addressTermForCustomer: string;
}

export const DEFAULT_BRAND_IDENTITY: BrandIdentity = {
  botDisplayName: "Bidan Yusi",
  businessName: "Kala Moms and Baby Spa",
  serviceType: "Homecare — treatment dipanggil langsung ke rumah customer",
  addressTermForCustomer: "Bunda", // panggilan ke customer, singkatan informal: "bund"
};

let currentBrand: BrandIdentity = { ...DEFAULT_BRAND_IDENTITY };

export function getBrandIdentity(): BrandIdentity {
  return currentBrand;
}

/**
 * Varian async tenant-aware: overlay `Tenant.settings.brand` di atas default.
 * Best-effort penuh — DB offline / tenant tanpa override → default.
 */
const brandCache = new Map<string, BrandIdentity>();

export async function getBrandIdentityAsync(tenantId: string = DEFAULT_TENANT_ID): Promise<BrandIdentity> {
  const cached = brandCache.get(tenantId);
  if (cached) return cached;

  let resolved: BrandIdentity = { ...DEFAULT_BRAND_IDENTITY };
  try {
    // Pola mapan (few-shot-exemplars.ts): cast `as any` karena generated client
    // lag dari schema + kolom tenants.settings belum ada di sebagian DB (P2022).
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const override = (tenant?.settings as any)?.brand;
    if (override && typeof override === 'object') {
      const pick = (v: any, fallback: string) =>
        typeof v === 'string' && v.trim() ? v.trim() : fallback;
      resolved = {
        botDisplayName: pick(override.botDisplayName, resolved.botDisplayName),
        businessName: pick(override.businessName, resolved.businessName),
        serviceType: pick(override.serviceType, resolved.serviceType),
        addressTermForCustomer: pick(override.addressTermForCustomer, resolved.addressTermForCustomer),
      };
    }
  } catch (err: any) {
    // Kolom belum termigrasi (P2022/42703, Issue #30) → default senyap;
    // error lain tetap di-warn agar masalah riil terlihat di log.
    if (!isMissingColumnError(err, 'settings')) {
      console.warn(`[BRAND] Gagal load override tenant ${tenantId}, gunakan default:`, err.message);
    }
  }

  brandCache.set(tenantId, resolved);
  return resolved;
}

export function setBrandIdentity(partial: Partial<BrandIdentity>): BrandIdentity {
  currentBrand = { ...currentBrand, ...partial };
  return currentBrand;
}

export function resetBrandIdentity(): void {
  currentBrand = { ...DEFAULT_BRAND_IDENTITY };
}

/** Clear cache untuk testing */
export function __clearBrandCacheForTest(tenantId?: string): void {
  if (tenantId) brandCache.delete(tenantId);
  else brandCache.clear();
}

/**
 * pricelist-promo.ts
 * Konfigurasi promosi diskon / penawaran khusus pada landing page Pricelist.
 * Disimpan di `Tenant.settings.promo` (JSON tenant-aware, tanpa migrasi schema).
 *
 * Nilai default adalah NONAKTIF & NETRAL (bukan data brand tertentu).
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';
import { isMissingColumnError } from '../utils/prisma-errors';

export interface PricelistPromoRule {
  title: string;
  body: string;
}

export interface PricelistPromoConfig {
  enabled: boolean;
  delaySeconds: number;
  discountPercent: number;
  instagramAccount: string;
  badgeTitle: string;
  badgeSubtitle: string;
  modalTitle: string;
  modalDescription: string;
  rules: PricelistPromoRule[];
  claimMessageTemplate: string;
}

export const DISABLED_PRICELIST_PROMO: PricelistPromoConfig = {
  enabled: false,
  delaySeconds: 5,
  discountPercent: 0,
  instagramAccount: '',
  badgeTitle: '',
  badgeSubtitle: '',
  modalTitle: '',
  modalDescription: '',
  rules: [],
  claimMessageTemplate: '',
};

/**
 * Sanitasi & clamp input konfigurasi promo agar aman dari nilai tak valid / out-of-range.
 */
export function sanitizePricelistPromoConfig(raw: any): PricelistPromoConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DISABLED_PRICELIST_PROMO };
  }

  const enabled = Boolean(raw.enabled);

  const rawDelay = Number(raw.delaySeconds);
  const delaySeconds = Number.isFinite(rawDelay)
    ? Math.max(0, Math.min(60, Math.round(rawDelay)))
    : 5;

  const rawDiscount = Number(raw.discountPercent);
  const discountPercent = Number.isFinite(rawDiscount)
    ? Math.max(0, Math.min(100, Math.round(rawDiscount)))
    : 0;

  const cleanString = (val: any): string => (typeof val === 'string' ? val.trim() : '');

  let rawIg = cleanString(raw.instagramAccount);
  if (rawIg.startsWith('@')) {
    rawIg = rawIg.substring(1).trim();
  }

  let rules: PricelistPromoRule[] = [];
  if (Array.isArray(raw.rules)) {
    rules = (raw.rules as any[])
      .filter((r: any) => r && typeof r === 'object')
      .map((r: any) => ({
        title: cleanString(r.title),
        body: cleanString(r.body),
      }))
      .filter((r: PricelistPromoRule) => r.title.length > 0 || r.body.length > 0);
  }

  return {
    enabled,
    delaySeconds,
    discountPercent,
    instagramAccount: rawIg,
    badgeTitle: cleanString(raw.badgeTitle),
    badgeSubtitle: cleanString(raw.badgeSubtitle),
    modalTitle: cleanString(raw.modalTitle),
    modalDescription: cleanString(raw.modalDescription),
    rules,
    claimMessageTemplate: cleanString(raw.claimMessageTemplate),
  };
}

const promoCache = new Map<string, PricelistPromoConfig>();

/**
 * Mengambil konfigurasi promo pricelist per-tenant dari database (`Tenant.settings.promo`).
 * Best-effort: jika DB offline atau belum ada config, kembalikan DISABLED_PRICELIST_PROMO.
 */
export async function getPricelistPromoConfigAsync(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<PricelistPromoConfig> {
  const cached = promoCache.get(tenantId);
  if (cached) return cached;

  let resolved: PricelistPromoConfig = { ...DISABLED_PRICELIST_PROMO };
  try {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const promoRaw = (tenant?.settings as any)?.promo;
    if (promoRaw && typeof promoRaw === 'object') {
      resolved = sanitizePricelistPromoConfig(promoRaw);
    }
  } catch (err: any) {
    if (!isMissingColumnError(err, 'settings')) {
      console.warn(`[PROMO] Gagal load promo tenant ${tenantId}, gunakan default disabled:`, err.message);
    }
  }

  promoCache.set(tenantId, resolved);
  return resolved;
}

/**
 * Membersihkan cache konfigurasi promo (untuk pengujian atau setelah update settings).
 */
export function __clearPricelistPromoCacheForTest(tenantId?: string): void {
  if (tenantId) {
    promoCache.delete(tenantId);
  } else {
    promoCache.clear();
  }
}

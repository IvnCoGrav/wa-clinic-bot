/**
 * financial-targets.ts
 * Sumber tunggal setelan Target Finansial Tenant (Target Nilai Booking & Target Reservasi Bulanan).
 *
 * Disimpan di Tenant.settings.financialTargets:
 * - monthlyRevenueTarget: number | null (dalam rupiah, misal 50_000_000)
 * - monthlyBookingTarget: number | null (jumlah reservasi, misal 150)
 *
 * Cache 5 menit per tenant, fail-safe saat DB offline.
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';

export interface FinancialTargets {
  monthlyRevenueTarget: number | null;
  monthlyBookingTarget: number | null;
}

export const DEFAULT_FINANCIAL_TARGETS: FinancialTargets = {
  monthlyRevenueTarget: null,
  monthlyBookingTarget: null,
};

interface CachedFinancialTargets {
  targets: FinancialTargets;
  expiresAt: number;
}

const financialTargetsCache = new Map<string, CachedFinancialTargets>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function clearFinancialTargetsCache(tenantId?: string): void {
  if (tenantId) {
    financialTargetsCache.delete(tenantId);
  } else {
    financialTargetsCache.clear();
  }
}

export async function getFinancialTargets(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<FinancialTargets> {
  const cached = financialTargetsCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.targets;
  }

  let resolved: FinancialTargets = { ...DEFAULT_FINANCIAL_TARGETS };

  try {
    const tenant = await (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { settings: true },
    });

    const settings = tenant?.settings;
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const ft = (settings as any).financialTargets;
      if (ft && typeof ft === 'object' && !Array.isArray(ft)) {
        const rev = Number(ft.monthlyRevenueTarget);
        const book = Number(ft.monthlyBookingTarget);
        resolved = {
          monthlyRevenueTarget: Number.isFinite(rev) && rev > 0 ? Math.round(rev) : null,
          monthlyBookingTarget: Number.isFinite(book) && book > 0 ? Math.round(book) : null,
        };
      }
    }
  } catch {
    // Fail-safe: kembalikan default saat DB offline
  }

  financialTargetsCache.set(tenantId, {
    targets: resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return resolved;
}

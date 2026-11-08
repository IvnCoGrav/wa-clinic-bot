import { prisma } from '../../db/client';
import { responseCacheService } from '../response-cache.service';

/**
 * Rumus LTV Kanonis Tunggal:
 * - Menghitung nilai transaksi ground truth dari basis data reservasi pelanggan.
 * - Aturan Keras:
 *   1. Status 'cancelled', 'rejected', dan 'hold' = Rp 0 (slot hold belum disepakati / belum confirmed).
 *   2. Reservasi dengan purchase_value > 0 dihitung langsung.
 *   3. Reservasi confirmed/completed dengan purchase_value NULL/0 di-resolve via treatment catalog (resolveTreatmentValue).
 */
export async function computeCustomerLtv(customerId: string, tenantId?: string): Promise<number> {
  const where: any = {
    customer_id: customerId,
    status: { notIn: ['cancelled', 'rejected', 'hold'] },
  };
  if (tenantId) where.tenant_id = tenantId;

  const reservations = await prisma.reservation.findMany({
    where,
    select: { status: true, purchase_value: true, treatment_detail: true, raw_text: true },
  });

  let ltv = 0;
  let needsResolve = false;

  if (Array.isArray(reservations)) {
    for (const r of reservations) {
      if (r.purchase_value !== null && r.purchase_value !== undefined && r.purchase_value !== 0) {
        ltv += r.purchase_value;
      } else {
        needsResolve = true;
      }
    }
  }

  if (needsResolve && Array.isArray(reservations)) {
    const { resolveTreatmentValue } = await import('../capi.service');
    for (const r of reservations) {
      if (r.purchase_value === null || r.purchase_value === undefined || r.purchase_value === 0) {
        const text = r.treatment_detail || r.raw_text;
        if (text) {
          const resolved = (await resolveTreatmentValue(text, tenantId)) ?? 0;
          ltv += resolved;
        }
      }
    }
  }

  return ltv;
}

/**
 * Recalculate and persist ltv_cache for a single customer.
 * Single-Writer resmi untuk kolom ltv_cache.
 */
export async function recalculateCustomerLtv(customerId: string, tenantId?: string): Promise<number> {
  try {
    const ltv = await computeCustomerLtv(customerId, tenantId);
    await prisma.customer.update({ where: { id: customerId }, data: { ltv_cache: ltv } });
    return ltv;
  } catch (err: any) {
    console.warn('[CUSTOMER] recalculateCustomerLtv failed:', err.message);
    return 0;
  }
}

/**
 * One-time backfill of ltv_cache for all customers.
 */
export async function backfillAllLtvCache(): Promise<number> {
  const customers = await prisma.customer.findMany({ select: { id: true } });
  let count = 0;
  for (const c of customers) {
    await recalculateCustomerLtv(c.id);
    count++;
  }
  return count;
}

/**
 * Separate stats endpoint — cached 60s, independent from list query.
 */
export async function getCustomerStats(tenantId: string): Promise<{
  totalCustomers: number;
  totalPurchasers: number;
  totalMql: number;
  totalProspects: number;
  totalRevenue: number;
}> {
  const cacheKey = `customers:stats:${tenantId}`;
  let stats = responseCacheService.get<any>(cacheKey);
  if (stats) return stats;

  try {
    const [totalCustomersCount, totalPurchasersCount, totalMqlCount, totalRevAgg] = await Promise.all([
      prisma.customer.count({ where: { tenant_id: tenantId, is_sandbox_test: false } }),
      prisma.customer.count({
        where: { tenant_id: tenantId, is_sandbox_test: false, reservations: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
      }),
      prisma.customer.count({
        where: { tenant_id: tenantId, is_sandbox_test: false, is_mql: true },
      }),
      prisma.reservation.aggregate({
        where: { tenant_id: tenantId, status: { notIn: ['cancelled', 'rejected'] }, customer: { is_sandbox_test: false } },
        _sum: { purchase_value: true },
      }),
    ]);
    stats = {
      totalCustomers: totalCustomersCount,
      totalPurchasers: totalPurchasersCount,
      totalMql: totalMqlCount,
      totalProspects: Math.max(0, totalCustomersCount - totalPurchasersCount),
      totalRevenue: totalRevAgg?._sum?.purchase_value || 0,
    };
    responseCacheService.set(cacheKey, stats, 60);
  } catch {
    stats = {
      totalCustomers: 0,
      totalPurchasers: 0,
      totalMql: 0,
      totalProspects: 0,
      totalRevenue: 0,
    };
  }
  return stats;
}

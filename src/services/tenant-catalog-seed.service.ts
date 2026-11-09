import { prisma } from '../db/client';
import { DEFAULT_CLINIC_SERVICES } from './treatment-catalog.service';
import { DEFAULT_TIERS } from './delivery.service';

export interface SeedTenantCatalogOptions {
  tenantId: string;
  brandPrefix?: string;
  commit?: boolean;
}

export interface SeedTenantCatalogResult {
  tenantId: string;
  services: number;
  tiers: number;
  committed: boolean;
  sample: Array<{ service_id: string; name: string }>;
}

/**
 * Bangun baris `clinic_services` dari katalog default (generic/unbranded).
 * Brand tenant diterapkan sebagai prefix eksplisit (mis. "Kala").
 * Meta bundle/addon di-encode ke description agar terbaca oleh loadServicesFromDb.
 */
export function buildCatalogSeedRows(tenantId: string, brandPrefix = '') {
  const prefix = brandPrefix.trim();

  return DEFAULT_CLINIC_SERVICES.map((s, idx) => {
    let description = s.description || '';
    if (s.bundleItemIds && s.bundleItemIds.length > 0 && !description.includes('[BUNDLE:')) {
      description = `[BUNDLE:${s.bundleItemIds.join(',')}] ${description}`;
    }
    if (s.isAddon && !description.includes('[ADDON]')) {
      description = `[ADDON] ${description}`;
    }

    return {
      tenant_id: tenantId,
      service_id: s.id,
      name: prefix ? `${prefix} ${s.name}` : s.name,
      category: s.category,
      min_age_months: s.ageTier.minAgeMonths,
      max_age_months: s.ageTier.maxAgeMonths,
      age_label: s.ageTier.label,
      duration_minutes: s.durationMinutes,
      original_price: s.originalPrice,
      promo_price: s.promoPrice,
      description,
      is_active: s.isActive,
      sort_order: idx + 1,
      total_sessions: s.totalSessions ?? null,
      session_schedule_type: s.sessionScheduleType ?? null,
      eligible_life_stages: s.eligibleLifeStages || [],
      contraindications: s.contraindications || [],
      requires_screening: s.requiresScreening ?? false,
      min_gestational_weeks: s.minGestationalWeeks ?? null,
      max_gestational_weeks: s.maxGestationalWeeks ?? null,
      clinical_family: s.clinicalFamily ?? null,
    };
  });
}

/**
 * Seed eksplisit katalog + delivery tiers per tenant.
 * Default dry-run (tidak menulis). `commit: true` menulis dalam satu transaksi.
 *
 * Catatan: service menggunakan upsert per (tenant_id, service_id) agar layanan
 * kustom yang sudah ada tidak terhapus. Delivery tiers diganti sebagai satu set.
 */
export async function seedTenantCatalog(
  options: SeedTenantCatalogOptions
): Promise<SeedTenantCatalogResult> {
  const tenantId = options.tenantId;
  const brandPrefix = options.brandPrefix || '';
  const commit = options.commit === true;

  const services = buildCatalogSeedRows(tenantId, brandPrefix);
  const tiers = DEFAULT_TIERS.map((t) => ({ ...t }));

  const result: SeedTenantCatalogResult = {
    tenantId,
    services: services.length,
    tiers: tiers.length,
    committed: false,
    sample: services.slice(0, 3).map((s) => ({ service_id: s.service_id, name: s.name })),
  };

  if (!commit) return result;

  await prisma.$transaction(async (tx) => {
    for (const row of services) {
      const { tenant_id, service_id, ...data } = row;
      await tx.clinicService.upsert({
        where: { tenant_id_service_id: { tenant_id, service_id } },
        create: row,
        update: data,
      });
    }

    await tx.deliveryTier.deleteMany({ where: { tenant_id: tenantId } });
    await tx.deliveryTier.createMany({
      data: tiers
        .slice()
        .sort((a, b) => a.maxDist - b.maxDist)
        .map((t, idx) => ({
          tenant_id: tenantId,
          max_dist: t.maxDist,
          fee: t.fee,
          promo_discount: t.promoDiscount,
          sort_order: idx + 1,
        })),
    });
  });

  return { ...result, committed: true };
}

import fs from 'fs';
import path from 'path';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import {
  ClinicServiceItem,
  TreatmentCategoryType,
  ClinicServiceType,
  inferEligibleLifeStages,
  inferClinicalFamily,
} from './types';
import { DEFAULT_CLINIC_SERVICES } from './default-services';

export const SERVICES_FILE = path.join(process.cwd(), 'services_custom.json');

// Struktur: Map<tenantId, Map<serviceId, ClinicServiceItem>>
export const tenantServiceCatalog: Map<string, Map<string, ClinicServiceItem>> = new Map();

/**
 * Sanitasi display fondasional (Fase 1.1): tag `[BUNDLE:...]`/`[ADDON]` adalah
 * ENCODING STORAGE (ditulis ulang di saveServicesToDb), BUKAN bahasa customer.
 */
export function sanitizeCatalogItem(item: ClinicServiceItem): ClinicServiceItem {
  const rawDesc = item.description || '';
  let bundleIds = item.bundleItemIds;
  const bundleMatch = rawDesc.match(/\[BUNDLE:([^\]]+)\]/);
  if (bundleMatch && (!bundleIds || bundleIds.length === 0)) {
    bundleIds = bundleMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  let isAd = item.isAddon === true;
  if (/\[ADDON\]/.test(rawDesc)) isAd = true;
  const cleanDesc = rawDesc.replace(/\[BUNDLE:[^\]]+\]\s*/g, '').replace(/\[ADDON\]\s*/g, '').trim();
  const stages = (item.eligibleLifeStages && item.eligibleLifeStages.length > 0)
    ? item.eligibleLifeStages
    : inferEligibleLifeStages(item);
  return {
    ...item,
    description: cleanDesc,
    bundleItemIds: bundleIds,
    isAddon: isAd,
    eligibleLifeStages: stages,
    contraindications: item.contraindications || [],
    requiresScreening: item.requiresScreening ?? false,
  };
}

/** Helper untuk mendapatkan atau membuat catalog map per-tenant */
export function getTenantCatalog(tenantId: string = DEFAULT_TENANT_ID): Map<string, ClinicServiceItem> {
  let cat = tenantServiceCatalog.get(tenantId);
  if (!cat) {
    cat = new Map<string, ClinicServiceItem>();
    tenantServiceCatalog.set(tenantId, cat);
  }
  return cat;
}

// Backwards-compat: alias untuk default tenant
export const serviceCatalog: Map<string, ClinicServiceItem> = getTenantCatalog(DEFAULT_TENANT_ID);

// Inisialisasi map katalog (default tenant)
export function loadServices() {
  const catalog = getTenantCatalog(DEFAULT_TENANT_ID);
  try {
    if (fs.existsSync(SERVICES_FILE)) {
      const data = fs.readFileSync(SERVICES_FILE, 'utf-8');
      const list: ClinicServiceItem[] = JSON.parse(data);
      catalog.clear();
      list.forEach((item) => catalog.set(item.id, sanitizeCatalogItem(item)));
    } else {
      catalog.clear();
      DEFAULT_CLINIC_SERVICES.forEach((item) => catalog.set(item.id, sanitizeCatalogItem(item)));
    }
  } catch (err) {
    console.error('Failed to load clinic services from file:', err);
    catalog.clear();
    DEFAULT_CLINIC_SERVICES.forEach((item) => catalog.set(item.id, sanitizeCatalogItem(item)));
  }
}

/**
 * Legacy compat
 */
export function saveServices() {
  return true;
}

/**
 * Load services dari database per tenant (SaaS-ready).
 */
export async function loadServicesFromDb(tenantId: string): Promise<void> {
  try {
    const { prisma } = await import('../../db/client');
    const dbServices = await prisma.clinicService.findMany({
      where: { tenant_id: tenantId },
      orderBy: { sort_order: 'asc' },
    });

    const targetCatalog = getTenantCatalog(tenantId);
    targetCatalog.clear();

    if (dbServices.length > 0) {
      dbServices.forEach((s) => {
        let bundleItemIds: string[] | undefined = undefined;
        let isAddon = s.category === 'ADD_ON';
        let desc = s.description;

        const bundleMatch = desc.match(/\[BUNDLE:([^\]]+)\]/);
        if (bundleMatch) {
          bundleItemIds = bundleMatch[1].split(',').map((id) => id.trim()).filter(Boolean);
          desc = desc.replace(/\[BUNDLE:[^\]]+\]\s*/g, '').trim();
        }

        if (desc.includes('[ADDON]')) {
          isAddon = true;
          desc = desc.replace(/\[ADDON\]\s*/g, '').trim();
        }

        const cat = s.category as TreatmentCategoryType;
        const sType: ClinicServiceType = 
          cat === 'BUNDLE' || (bundleItemIds && bundleItemIds.length >= 2) ? 'BUNDLE' :
          cat === 'ADD_ON' || isAddon ? 'ADD_ON' : 'STANDARD';

        const itemStages = (s as any).eligible_life_stages && (s as any).eligible_life_stages.length > 0
          ? (s as any).eligible_life_stages
          : inferEligibleLifeStages({ category: cat, name: s.name, description: desc, ageTier: { label: s.age_label } });

        targetCatalog.set(s.service_id, {
          id: s.service_id,
          name: s.name,
          category: cat,
          serviceType: sType,
          bundleItemIds,
          isAddon: sType === 'ADD_ON' || isAddon,
          ageTier: {
            minAgeMonths: s.min_age_months,
            maxAgeMonths: s.max_age_months,
            label: s.age_label,
          },
          durationMinutes: s.duration_minutes,
          originalPrice: s.original_price,
          promoPrice: s.promo_price,
          description: desc,
          isActive: s.is_active,
          totalSessions: s.total_sessions ?? undefined,
          sessionScheduleType: s.session_schedule_type ?? undefined,
          eligibleLifeStages: itemStages,
          contraindications: (s as any).contraindications || [],
          requiresScreening: (s as any).requires_screening ?? false,
          minGestationalWeeks: (s as any).min_gestational_weeks ?? null,
          maxGestationalWeeks: (s as any).max_gestational_weeks ?? null,
          clinicalFamily: (s as any).clinical_family ?? null,
        });
      });
      return;
    }

    if (tenantId !== DEFAULT_TENANT_ID) {
      console.log(`[TREATMENT CATALOG] Tenant '${tenantId}' belum memiliki katalog treatment di database. Tidak ada auto-seed.`);
      return;
    }

    let source: ClinicServiceItem[] = [];
    try {
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(process.cwd(), 'services_custom.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const fileData = JSON.parse(raw) as ClinicServiceItem[];
        if (Array.isArray(fileData) && fileData.length > 0) {
          source = fileData;
          console.warn(`[SEED] Catalog kosong untuk tenant ${tenantId}; seeding dari file services_custom.json (${source.length} layanan).`);
        }
      }
    } catch {}
    if (source.length === 0) {
      source = [...DEFAULT_CLINIC_SERVICES];
      console.warn(`[SEED] Catalog treatment kosong untuk tenant ${tenantId}; seeding dari DEFAULT_CLINIC_SERVICES (code default, ${source.length} layanan). Set harga/layanan via admin API / DB untuk produksi.`);
    }
    source.forEach((item) => targetCatalog.set(item.id, sanitizeCatalogItem(item)));
    await saveServicesToDb(tenantId);
  } catch (err) {
    console.warn('[TREATMENT CATALOG] DB unavailable, using file/default:', (err as Error).message);
  }
}

/**
 * Simpan services ke database per tenant (SaaS-ready).
 */
export async function saveServicesToDb(tenantId: string): Promise<boolean> {
  try {
    const { prisma } = await import('../../db/client');
    const catalog = getTenantCatalog(tenantId);
    const list = Array.from(catalog.values());

    const rows = list.map((s, idx) => {
      let metaDesc = s.description;
      if (s.bundleItemIds && s.bundleItemIds.length > 0 && !metaDesc.includes('[BUNDLE:')) {
        metaDesc = `[BUNDLE:${s.bundleItemIds.join(',')}] ${metaDesc}`;
      }
      if (s.isAddon && !metaDesc.includes('[ADDON]')) {
        metaDesc = `[ADDON] ${metaDesc}`;
      }

      return {
        tenant_id: tenantId,
        service_id: s.id,
        name: s.name,
        category: s.category,
        min_age_months: s.ageTier.minAgeMonths,
        max_age_months: s.ageTier.maxAgeMonths,
        age_label: s.ageTier.label,
        duration_minutes: s.durationMinutes,
        original_price: s.originalPrice,
        promo_price: s.promoPrice,
        description: metaDesc,
        is_active: s.isActive,
        sort_order: idx,
        eligible_life_stages: s.eligibleLifeStages || [],
        contraindications: s.contraindications || [],
        requires_screening: s.requiresScreening ?? false,
        min_gestational_weeks: s.minGestationalWeeks ?? null,
        max_gestational_weeks: s.maxGestationalWeeks ?? null,
        clinical_family: s.clinicalFamily ?? inferClinicalFamily(s),
      };
    });

    await prisma.$transaction([
      prisma.clinicService.deleteMany({ where: { tenant_id: tenantId } }),
      prisma.clinicService.createMany({ data: rows }),
    ]);

    saveServices();
    return true;
  } catch (err) {
    console.error('[TREATMENT CATALOG] Failed to save to DB:', (err as Error).message);
    return saveServices();
  }
}

// Initial load
loadServices();

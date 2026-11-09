import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import {
  DEFAULT_CLINIC_SERVICES,
  loadServicesFromDb,
  treatmentCatalogService,
} from '../../src/services/treatment-catalog.service';
import { DEFAULT_TIERS, getDeliveryTiersFromDb, DeliveryService } from '../../src/services/delivery.service';
import {
  buildCatalogSeedRows,
  seedTenantCatalog,
} from '../../src/services/tenant-catalog-seed.service';

function dbServiceRow(overrides: Record<string, any> = {}) {
  return {
    id: `row-${overrides.service_id || 'a'}`,
    tenant_id: 'tenant-a',
    service_id: 'svc-a',
    name: 'Layanan A',
    category: 'BABY',
    min_age_months: 0,
    max_age_months: 12,
    age_label: '0 - 12 Bulan',
    duration_minutes: 60,
    original_price: 100000,
    promo_price: 90000,
    description: 'Deskripsi layanan A',
    is_active: true,
    sort_order: 1,
    total_sessions: null,
    session_schedule_type: null,
    eligible_life_stages: [],
    contraindications: [],
    requires_screening: false,
    min_gestational_weeks: null,
    max_gestational_weeks: null,
    clinical_family: null,
    ...overrides,
  };
}

describe('S5.2 — Katalog & delivery data-driven', () => {
  const originalFlag = process.env.USE_DB_CATALOG;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_DB_CATALOG;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.USE_DB_CATALOG;
    else process.env.USE_DB_CATALOG = originalFlag;
  });

  it('DEFAULT_CLINIC_SERVICES generik (tanpa brand Kala) dan berisi 42 layanan', () => {
    expect(DEFAULT_CLINIC_SERVICES).toHaveLength(42);
    expect(DEFAULT_CLINIC_SERVICES.some((s) => /Kala/i.test(s.name))).toBe(false);
  });

  it('tenant non-default tanpa baris DB = unconfigured, bukan katalog default', async () => {
    vi.spyOn(prisma.clinicService, 'findMany').mockResolvedValue([] as any);
    const createSpy = vi.spyOn(prisma.clinicService, 'createMany');

    await loadServicesFromDb('tenant-kosong');

    expect(treatmentCatalogService.getAllServices(false, 'tenant-kosong')).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('default tenant tanpa baris DB memakai fallback in-memory tanpa menulis DB', async () => {
    vi.spyOn(prisma.clinicService, 'findMany').mockResolvedValue([] as any);
    const createSpy = vi.spyOn(prisma.clinicService, 'createMany');
    const deleteSpy = vi.spyOn(prisma.clinicService, 'deleteMany');

    await loadServicesFromDb(DEFAULT_TENANT_ID);

    expect(treatmentCatalogService.getAllServices(true, DEFAULT_TENANT_ID).length).toBeGreaterThan(0);
    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('dua tenant membaca katalog berbeda dari DB', async () => {
    vi.spyOn(prisma.clinicService, 'findMany').mockImplementation(async ({ where }: any) => {
      if (where.tenant_id === 'tenant-a') {
        return [dbServiceRow({ tenant_id: 'tenant-a', service_id: 'svc-a', name: 'Layanan A' })] as any;
      }
      if (where.tenant_id === 'tenant-b') {
        return [dbServiceRow({ tenant_id: 'tenant-b', service_id: 'svc-b', name: 'Layanan B' })] as any;
      }
      return [] as any;
    });

    await loadServicesFromDb('tenant-a');
    await loadServicesFromDb('tenant-b');

    expect(treatmentCatalogService.getAllServices(false, 'tenant-a').map((s) => s.id)).toEqual(['svc-a']);
    expect(treatmentCatalogService.getAllServices(false, 'tenant-b').map((s) => s.id)).toEqual(['svc-b']);
  });

  it('USE_DB_CATALOG=false: default fallback, non-default unconfigured', async () => {
    process.env.USE_DB_CATALOG = 'false';

    await loadServicesFromDb('tenant-flag');
    expect(treatmentCatalogService.getAllServices(false, 'tenant-flag')).toEqual([]);

    await loadServicesFromDb(DEFAULT_TENANT_ID);
    expect(treatmentCatalogService.getAllServices(true, DEFAULT_TENANT_ID).length).toBeGreaterThan(0);
  });

  it('delivery: tenant non-default tanpa tier = [] dan tidak auto-seed', async () => {
    vi.spyOn(prisma.deliveryTier, 'findMany').mockResolvedValue([] as any);
    const createSpy = vi.spyOn(prisma.deliveryTier, 'createMany');

    const tiers = await getDeliveryTiersFromDb('tenant-kosong');

    expect(tiers).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('delivery: default tenant tanpa tier memakai fallback 7 tier', async () => {
    vi.spyOn(prisma.deliveryTier, 'findMany').mockResolvedValue([] as any);

    const tiers = await getDeliveryTiersFromDb(DEFAULT_TENANT_ID);

    expect(tiers).toHaveLength(DEFAULT_TIERS.length);
  });

  it('delivery: USE_DB_CATALOG=false memakai fallback untuk default, kosong untuk tenant lain', async () => {
    process.env.USE_DB_CATALOG = 'false';

    expect(await getDeliveryTiersFromDb('tenant-lain')).toEqual([]);
    expect(await getDeliveryTiersFromDb(DEFAULT_TENANT_ID)).toHaveLength(DEFAULT_TIERS.length);
  });

  it('delivery: tenant tanpa tier mengembalikan status belum dikonfigurasi', async () => {
    vi.spyOn(prisma.deliveryTier, 'findMany').mockResolvedValue([] as any);
    const service = new DeliveryService({ calculateRoute: vi.fn().mockResolvedValue(null) } as any);

    const result = await service.calculateDelivery(
      { lat: -7.26, lng: 112.74 },
      { lat: -7.26, lng: 112.74 },
      'tenant-kosong'
    );

    expect(result.isOutOfCoverage).toBe(true);
    expect(result.maxCoverageKm).toBe(0);
    expect(result.messageTemplate).toContain('belum dikonfigurasi');
  });

  it('seed dry-run tidak menulis DB dan menghasilkan 42 layanan + 7 tier', async () => {
    const txSpy = vi.spyOn(prisma as any, '$transaction');

    const result = await seedTenantCatalog({ tenantId: 'tenant-baru' });

    expect(result.committed).toBe(false);
    expect(result.services).toBe(42);
    expect(result.tiers).toBe(7);
    expect(txSpy).not.toHaveBeenCalled();
    expect(result.sample[0].name).not.toMatch(/Kala/i);
  });

  it('seed commit memakai upsert per layanan dan mengganti tier dalam satu transaksi', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma as any, '$transaction').mockImplementation(async (fn: any) =>
      fn({ clinicService: { upsert }, deliveryTier: { deleteMany, createMany } })
    );

    const result = await seedTenantCatalog({
      tenantId: 'tenant-baru',
      brandPrefix: 'Kala',
      commit: true,
    });

    expect(result.committed).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(42);
    expect(deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 'tenant-baru' } });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.name).toMatch(/^Kala /);
  });

  it('buildCatalogSeedRows meng-encode BUNDLE/ADDON ke description', () => {
    const rows = buildCatalogSeedRows('tenant-a', 'Kala');

    expect(rows).toHaveLength(42);
    expect(rows.some((r) => r.description.includes('[BUNDLE:'))).toBe(true);
    expect(rows.some((r) => r.description.includes('[ADDON]'))).toBe(true);
  });
});

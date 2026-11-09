import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeTenantRuntime, isTenantRuntimeReady, __resetTenantRuntimeReadyForTest } from '../../src/lifecycle/tenant-bootstrap';
import { prisma } from '../../src/db/client';
import * as treatmentCatalogService from '../../src/services/treatment-catalog.service';
import * as deliveryService from '../../src/services/delivery.service';
import * as personaConfig from '../../src/config/persona';
import { AiModelConfigService } from '../../src/config/ai-models.config';
import { AiEligibilityConfigService } from '../../src/config/ai-eligibility-config';

describe('Task S2.4 — Tenant Bootstrap Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetTenantRuntimeReadyForTest();
  });

  it('menginisialisasi runtime untuk seluruh tenant aktif sebelum server siap menerima traffic', async () => {
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      { id: 'tenant-a' },
      { id: 'tenant-b' },
    ] as any);

    const loadServicesSpy = vi.spyOn(treatmentCatalogService, 'loadServicesFromDb').mockResolvedValue([] as any);
    const getDeliveryTiersSpy = vi.spyOn(deliveryService, 'getDeliveryTiersFromDb').mockResolvedValue([] as any);
    const loadPersonaSpy = vi.spyOn(personaConfig, 'loadPersonaFromDb').mockResolvedValue({} as any);
    const loadAiModelSpy = vi.spyOn(AiModelConfigService, 'loadConfigsFromDb').mockResolvedValue({} as any);
    const loadAiEligibilitySpy = vi.spyOn(AiEligibilityConfigService, 'loadConfigsFromDb').mockResolvedValue(true);

    expect(isTenantRuntimeReady()).toBe(false);

    const result = await initializeTenantRuntime();

    expect(result.success).toBe(true);
    expect(result.tenantIds).toEqual(['tenant-a', 'tenant-b']);
    expect(isTenantRuntimeReady()).toBe(true);

    expect(loadServicesSpy).toHaveBeenCalledWith('tenant-a');
    expect(loadServicesSpy).toHaveBeenCalledWith('tenant-b');
    expect(getDeliveryTiersSpy).toHaveBeenCalledWith('tenant-a');
    expect(getDeliveryTiersSpy).toHaveBeenCalledWith('tenant-b');
    expect(loadPersonaSpy).toHaveBeenCalledWith('tenant-a');
    expect(loadPersonaSpy).toHaveBeenCalledWith('tenant-b');
    expect(loadAiModelSpy).toHaveBeenCalledWith('tenant-a');
    expect(loadAiModelSpy).toHaveBeenCalledWith('tenant-b');
    expect(loadAiEligibilitySpy).toHaveBeenCalledWith('tenant-a');
    expect(loadAiEligibilitySpy).toHaveBeenCalledWith('tenant-b');
  });

  it('melakukan fallback ke DEFAULT_TENANT_ID bila DB offline tanpa crash', async () => {
    vi.spyOn(prisma.tenant, 'findMany').mockRejectedValueOnce(new Error('Database offline'));

    vi.spyOn(treatmentCatalogService, 'loadServicesFromDb').mockResolvedValue([] as any);
    vi.spyOn(deliveryService, 'getDeliveryTiersFromDb').mockResolvedValue([] as any);
    vi.spyOn(personaConfig, 'loadPersonaFromDb').mockResolvedValue({} as any);
    vi.spyOn(AiModelConfigService, 'loadConfigsFromDb').mockResolvedValue({} as any);
    vi.spyOn(AiEligibilityConfigService, 'loadConfigsFromDb').mockResolvedValue(false);

    const result = await initializeTenantRuntime();

    expect(result.success).toBe(true);
    expect(result.tenantIds).toEqual(['default-tenant']);
    expect(isTenantRuntimeReady()).toBe(true);
  });
});

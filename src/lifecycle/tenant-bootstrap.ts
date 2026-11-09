/**
 * Lifecycle Tenant Bootstrap
 * Bertanggung jawab melakukan inisialisasi per tenant (katalog, delivery tiers,
 * persona, AI configs, AI scope) SEBELUM server HTTP membuka port listen atau
 * worker background mulai memproses antrean.
 */

export interface TenantBootstrapResult {
  tenantIds: string[];
  success: boolean;
  error?: Error;
}

let isInitialized = false;

export function isTenantRuntimeReady(): boolean {
  return isInitialized;
}

export function __resetTenantRuntimeReadyForTest(): void {
  isInitialized = false;
}

/**
 * Inisialisasi runtime per tenant (katalog, delivery tiers, persona, AI config, AI scope).
 * Wajib dijalankan SEBELUM server.listen() atau worker loop dimulai agar cache tidak kosong
 * saat request pertama masuk.
 */
export async function initializeTenantRuntime(): Promise<TenantBootstrapResult> {
  const { DEFAULT_TENANT_ID } = await import('../config/tenant');
  const { loadServicesFromDb } = await import('../services/treatment-catalog.service');
  const { getDeliveryTiersFromDb } = await import('../services/delivery.service');
  const { loadPersonaFromDb } = await import('../config/persona');
  const { AiModelConfigService } = await import('../config/ai-models.config');
  const { AiEligibilityConfigService } = await import('../config/ai-eligibility-config');

  let tenantIds: string[] = [DEFAULT_TENANT_ID];
  try {
    const { prisma } = await import('../db/client');
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    if (tenants.length > 0) tenantIds = tenants.map((t: any) => t.id);
  } catch {
    console.warn('[INIT TENANT DATA] DB offline — fallback ke DEFAULT_TENANT_ID.');
  }

  try {
    for (const tid of tenantIds) {
      await loadServicesFromDb(tid);
      await getDeliveryTiersFromDb(tid);
      await loadPersonaFromDb(tid);
      await AiModelConfigService.loadConfigsFromDb(tid);
      const aiScopeLoaded = await AiEligibilityConfigService.loadConfigsFromDb(tid);
      if (!aiScopeLoaded) {
        console.warn(
          `[AI_ROLLOUT_SCOPE] DB unreachable at boot for tenant ${tid}, defaulting to fail-closed (NEW_ONLY, cutoff=now).`
        );
      }
    }
    console.log(
      `📦 Tenant data initialized for ${tenantIds.length} tenant(s) (catalog + delivery tiers + persona + AI config + AI scope)`
    );
    isInitialized = true;
    return { tenantIds, success: true };
  } catch (err: any) {
    console.error('[INIT TENANT DATA] Fatal failure loading tenant data:', err?.message || err);
    return { tenantIds, success: false, error: err };
  }
}

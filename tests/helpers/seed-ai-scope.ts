import { AiCustomerScope } from '@prisma/client';
import { AiEligibilityConfigService } from '../../src/config/ai-eligibility-config';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Seed AI Rollout Scope = ALL (simulasi boot sehat dengan config tenant ter-load).
 *
 * Test webhook yang mengasumsikan bot merespons customer baru TIDAK boleh menempel
 * pada default fail-closed config-service (yang mensilence customer saat config
 * outage / cache miss). Seeding ini membuat gate deterministic pass — tanpa seed,
 * hasil test bergantung pada race millisecond antara created_at customer dan
 * evaluasi cutoff (kadang eligible, kadang silence) → flaky.
 */
export async function seedAiScopeAll(): Promise<void> {
  await AiEligibilityConfigService.saveConfig(DEFAULT_TENANT_ID, {
    ai_customer_scope: AiCustomerScope.ALL,
    ai_scope_cutoff_at: new Date(0),
  });
}

export function clearAiScopeCache(): void {
  AiEligibilityConfigService.clearCache(DEFAULT_TENANT_ID);
}

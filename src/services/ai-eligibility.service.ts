import type { Customer, Tenant } from '@prisma/client';

/**
 * Precedence (urut, berhenti di match pertama):
 * 1. customer.aiOverride === 'FORCE_ON'  -> true   (override menang, ANY scope)
 * 2. customer.aiOverride === 'FORCE_OFF' -> false  (override menang, ANY scope)
 * 3. tenant.aiCustomerScope === 'ALL'    -> true
 * 4. tenant.aiCustomerScope === 'NEW_ONLY' -> customer.createdAt >= tenant.aiScopeCutoffAt
 * 5. Fail-closed: field wajib null/undefined di langkah 3-4 -> false
 *
 * "Legacy" = createdAt < cutoff. BUKAN is_legacy_source (itu milik fitur
 * Legacy Scrape — soal sumber data, bukan kapan pertama kontak).
 *
 * CATATAN: nama field mengikuti Prisma model (snake_case) project ini.
 */
export const AI_ELIGIBILITY_ESCALATION_REASON = 'LEGACY_AI_SCOPE_DISABLED' as const;

export function resolveAiEligibility(
  customer: Pick<Customer, 'ai_override' | 'created_at'>,
  tenant: Pick<Tenant, 'ai_customer_scope' | 'ai_scope_cutoff_at'>,
): boolean {
  if (customer.ai_override === 'FORCE_ON') return true;
  if (customer.ai_override === 'FORCE_OFF') return false;

  if (tenant.ai_customer_scope === 'ALL') return true;

  if (tenant.ai_customer_scope === 'NEW_ONLY') {
    if (!tenant.ai_scope_cutoff_at || !customer.created_at) return false; // fail-closed
    return customer.created_at >= tenant.ai_scope_cutoff_at;
  }

  return false; // fail-closed: scope tak dikenal
}
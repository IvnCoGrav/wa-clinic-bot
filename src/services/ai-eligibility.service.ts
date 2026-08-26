import type { Customer, Tenant, AiCustomerScope } from '@prisma/client';

/**
 * Precedence (urut, berhenti di match pertama):
 * 1. customer.ai_override === 'FORCE_ON'  -> true   (override menang, ANY scope)
 * 2. customer.ai_override === 'FORCE_OFF' -> false  (override menang, ANY scope)
 * 3. tenant.repeat_patient_bypass_bot !== false && isRepeat -> false (EXISTING_PATIENT_MANUAL)
 * 4. tenant.legacy_bypass_bot !== false && isLegacy -> false (LEGACY_CUSTOMER_MANUAL)
 * 5. tenant.ai_customer_scope === 'ALL'    -> true
 * 6. tenant.ai_customer_scope === 'NEW_ONLY' -> customer.created_at >= tenant.ai_scope_cutoff_at
 * 7. Fail-closed: field wajib null/undefined di langkah 5-6 -> false
 */
export const AI_ELIGIBILITY_ESCALATION_REASON = 'LEGACY_AI_SCOPE_DISABLED' as const;
export const LEGACY_CUSTOMER_ESCALATION_REASON = 'LEGACY_CUSTOMER_MANUAL' as const;
export const EXISTING_PATIENT_ESCALATION_REASON = 'EXISTING_PATIENT_MANUAL' as const;

export type AiEligibilityEscalationReason =
  | typeof AI_ELIGIBILITY_ESCALATION_REASON
  | typeof LEGACY_CUSTOMER_ESCALATION_REASON
  | typeof EXISTING_PATIENT_ESCALATION_REASON
  | 'FORCE_OFF';

export interface AiEligibilityResolution {
  eligible: boolean;
  reason?: AiEligibilityEscalationReason;
}

export function resolveAiEligibilityWithReason(
  customer: {
    ai_override?: string | null;
    created_at?: Date | null;
    is_legacy_source?: boolean | null;
    status?: string | null;
    has_confirmed_reservation?: boolean | null;
    purchase_count?: number | null;
  },
  tenant: {
    ai_customer_scope?: AiCustomerScope | 'NEW_ONLY' | 'ALL';
    ai_scope_cutoff_at?: Date | null;
    legacy_bypass_bot?: boolean;
    repeat_patient_bypass_bot?: boolean;
  },
): AiEligibilityResolution {
  if (customer.ai_override === 'FORCE_ON') return { eligible: true };
  if (customer.ai_override === 'FORCE_OFF') return { eligible: false, reason: 'FORCE_OFF' };

  const legacyBypass = tenant.legacy_bypass_bot !== false;
  const repeatBypass = tenant.repeat_patient_bypass_bot !== false;

  // 1. Pasien yang sudah pernah treatment / repeat order
  if (repeatBypass) {
    const isRepeat =
      customer.has_confirmed_reservation === true ||
      (typeof customer.purchase_count === 'number' && customer.purchase_count > 0) ||
      customer.status === 'repeat';
    if (isRepeat) {
      return { eligible: false, reason: EXISTING_PATIENT_ESCALATION_REASON };
    }
  }

  // 2. Kontak Legacy (data arsip lama / status legacy)
  if (legacyBypass) {
    const isLegacy = customer.is_legacy_source === true || customer.status === 'legacy';
    if (isLegacy) {
      return { eligible: false, reason: LEGACY_CUSTOMER_ESCALATION_REASON };
    }
  }

  // 3. AI Scope Evaluation
  if (tenant.ai_customer_scope === 'ALL') return { eligible: true };

  if (tenant.ai_customer_scope === 'NEW_ONLY') {
    if (!tenant.ai_scope_cutoff_at || !customer.created_at) {
      return { eligible: false, reason: AI_ELIGIBILITY_ESCALATION_REASON }; // fail-closed
    }
    const isNew = customer.created_at >= tenant.ai_scope_cutoff_at;
    if (!isNew) {
      return { eligible: false, reason: AI_ELIGIBILITY_ESCALATION_REASON };
    }
    return { eligible: true };
  }

  return { eligible: false, reason: AI_ELIGIBILITY_ESCALATION_REASON };
}

export function resolveAiEligibility(
  customer: {
    ai_override?: string | null;
    created_at?: Date | null;
    is_legacy_source?: boolean | null;
    status?: string | null;
    has_confirmed_reservation?: boolean | null;
    purchase_count?: number | null;
  },
  tenant: {
    ai_customer_scope?: AiCustomerScope | 'NEW_ONLY' | 'ALL';
    ai_scope_cutoff_at?: Date | null;
    legacy_bypass_bot?: boolean;
    repeat_patient_bypass_bot?: boolean;
  },
): boolean {
  return resolveAiEligibilityWithReason(customer, tenant).eligible;
}
import type { Customer, Tenant, AiCustomerScope } from '@prisma/client';

/**
 * Precedence (urut, berhenti di match pertama):
 * 1. customer.ai_override === 'FORCE_ON'  -> true   (override menang, ANY scope)
 * 2. customer.ai_override === 'FORCE_OFF' -> false  (override menang, ANY scope)
 * 3. customer.has_active_appointment === true -> false (ACTIVE_APPOINTMENT_MANUAL;
 *    guard operasional wajib — pasien dengan jadwal aktif H-0/H+1 SELALU ke CS
 *    manusia, tanpa toggle bypass)
 * 4. tenant.repeat_patient_bypass_bot !== false && isRepeat -> false (EXISTING_PATIENT_MANUAL),
 *    dengan isRepeat = has_treatment_history === true
 *    (riwayat `confirmed`/`completed` via patient-lifecycle.service)
 *    ATAU ltv_cache > 0.
 *    DIHAPUS (properti hantu, tidak ada di schema Prisma): `purchase_count`,
 *    `customer.status === 'repeat'` — tidak pernah ditulis production.
 * 5. tenant.legacy_bypass_bot !== false && isLegacy -> false (LEGACY_CUSTOMER_MANUAL),
 *    dengan isLegacy = is_legacy_source === true ATAU status === 'legacy'
 *    (keduanya sinyal riil: kolom DB + konvensi migration.service).
 * 6. tenant.ai_customer_scope === 'ALL'    -> true
 * 7. tenant.ai_customer_scope === 'NEW_ONLY' -> customer.created_at >= tenant.ai_scope_cutoff_at
 * 8. Fail-closed: field wajib null/undefined di langkah 6-7 -> false
 */
export const AI_ELIGIBILITY_ESCALATION_REASON = 'LEGACY_AI_SCOPE_DISABLED' as const;
export const LEGACY_CUSTOMER_ESCALATION_REASON = 'LEGACY_CUSTOMER_MANUAL' as const;
export const EXISTING_PATIENT_ESCALATION_REASON = 'EXISTING_PATIENT_MANUAL' as const;
export const ACTIVE_APPOINTMENT_ESCALATION_REASON = 'ACTIVE_APPOINTMENT_MANUAL' as const;

export type AiEligibilityEscalationReason =
  | typeof AI_ELIGIBILITY_ESCALATION_REASON
  | typeof LEGACY_CUSTOMER_ESCALATION_REASON
  | typeof EXISTING_PATIENT_ESCALATION_REASON
  | typeof ACTIVE_APPOINTMENT_ESCALATION_REASON
  | 'FORCE_OFF';

export interface AiEligibilityResolution {
  eligible: boolean;
  reason?: AiEligibilityEscalationReason;
}

/**
 * Kontrak input customer — HANYA field yang eksis di schema Prisma
 * (Customer) atau yang dihitung patient-lifecycle.service:
 * - has_treatment_history: riwayat `confirmed`/`completed` (DB) — flag `true`
 *   selalu dihormati; `false`/null diverifikasi pemanggil via DB + ltv_cache.
 * - has_active_appointment: jadwal `pending`/`confirmed`/`hold` dalam jendela
 *   operasional (DB) — flag `true` selalu dihormati (guard wajib).
 * - ltv_cache: kolom Customer riil (fallback pasien lama saat hitungan DB
 *   tidak tersedia).
 * - has_confirmed_reservation: DEPRECATED, alias baca-saja dari
 *   has_treatment_history (dipertahankan agar pemanggil lama tidak rusak).
 */
export interface AiEligibilityCustomer {
  ai_override?: string | null;
  created_at?: Date | null;
  is_legacy_source?: boolean | null;
  status?: string | null;
  has_treatment_history?: boolean | null;
  has_active_appointment?: boolean | null;
  ltv_cache?: number | null;
  /** @deprecated gunakan has_treatment_history. */
  has_confirmed_reservation?: boolean | null;
}

export interface AiEligibilityTenant {
  ai_customer_scope?: AiCustomerScope | 'NEW_ONLY' | 'ALL';
  ai_scope_cutoff_at?: Date | null;
  legacy_bypass_bot?: boolean;
  repeat_patient_bypass_bot?: boolean;
}

function ltvOf(customer: AiEligibilityCustomer): number {
  const v = Number(customer.ltv_cache);
  return Number.isFinite(v) ? v : 0;
}

export function resolveAiEligibilityWithReason(
  customer: AiEligibilityCustomer,
  tenant: AiEligibilityTenant,
): AiEligibilityResolution {
  if (customer.ai_override === 'FORCE_ON') return { eligible: true };
  if (customer.ai_override === 'FORCE_OFF') return { eligible: false, reason: 'FORCE_OFF' };

  // Guard operasional wajib: jadwal aktif H-0/H+1 → CS manusia, tanpa toggle.
  if (customer.has_active_appointment === true) {
    return { eligible: false, reason: ACTIVE_APPOINTMENT_ESCALATION_REASON };
  }

  const legacyBypass = tenant.legacy_bypass_bot !== false;
  const repeatBypass = tenant.repeat_patient_bypass_bot !== false;

  // 1. Pasien yang sudah pernah treatment / repeat order (sinyal riil saja).
  if (repeatBypass) {
    const isRepeat =
      customer.has_treatment_history === true ||
      customer.has_confirmed_reservation === true ||
      ltvOf(customer) > 0;
    if (isRepeat) {
      return { eligible: false, reason: EXISTING_PATIENT_ESCALATION_REASON };
    }
  }

  // 2. Kontak Legacy (kolom DB riil + konvensi status migrasi).
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
  customer: AiEligibilityCustomer,
  tenant: AiEligibilityTenant,
): boolean {
  return resolveAiEligibilityWithReason(customer, tenant).eligible;
}

import { ConversationState } from '@prisma/client';
import {
  AI_ELIGIBILITY_ESCALATION_REASON,
  LEGACY_CUSTOMER_ESCALATION_REASON,
  EXISTING_PATIENT_ESCALATION_REASON,
  ACTIVE_APPOINTMENT_ESCALATION_REASON,
  resolveAiEligibilityWithReason,
} from './ai-eligibility.service';
import { patientLifecycleService } from './patient-lifecycle.service';
import { AiEligibilityConfigService } from '../config/ai-eligibility-config';
import { conversationService } from './conversation.service';
import { messageService } from './message.service';

/**
 * AI Rollout Scope Gate — gate pintu masuk pipeline (WAHA & WABA).
 *
 * Kapan customer TIDAK layak dapat AI (Bypass ke CS Manusia):
 *   0. Jadwal aktif H-0/H+1 (`ACTIVE_APPOINTMENT_MANUAL`, guard wajib tanpa
 *      toggle): reservasi `pending`/`confirmed`/`hold` dalam jendela operasional.
 *   1. Pasien yang sudah pernah treatment (`EXISTING_PATIENT_MANUAL`):
 *      - Jika `repeat_patient_bypass_bot === true` dan memiliki reservasi
 *        `confirmed`/`completed` (via patient-lifecycle.service) ATAU
 *        `ltv_cache > 0`.
 *   2. Kontak Legacy (`LEGACY_CUSTOMER_MANUAL`):
 *      - Jika `legacy_bypass_bot === true` dan `is_legacy_source === true` / status legacy.
 *   3. AI Rollout Scope Cutoff (`LEGACY_AI_SCOPE_DISABLED`):
 *      - Jika `ai_customer_scope === 'NEW_ONLY'` dan customer.created_at < ai_scope_cutoff_at.
 *
 * Status klinis/operasional dibaca dari patient-lifecycle.service (Single
 * Source of Truth). Flag eksplisit `true` pada objek customer selalu
 * dihormati tanpa query tambahan; DB offline → fallback `ltv_cache` objek
 * (in-memory, tanpa properti fiktif `status = 'repeat'`).
 */

export type AiScopeGateResult =
  | { action: 'pass' }
  | { action: 'silence'; status: string };

const IDLE_TIMEOUT_MS_DEFAULT = 86400000;

function isAtResetBoundary(conversation: any): boolean {
  const state = conversation.current_state;
  if (state === ConversationState.INITIAL || state === ConversationState.COMPLETED) {
    return true;
  }
  const idleTimeout = parseInt(process.env.IDLE_TIMEOUT_MS || String(IDLE_TIMEOUT_MS_DEFAULT), 10);
  const last = conversation.last_message_at ? new Date(conversation.last_message_at).getTime() : 0;
  if (last > 0 && Date.now() - last > idleTimeout) {
    return true;
  }
  return false;
}

export async function enforceAiScopeGate(params: {
  customer: any;
  conversation: any;
  tenantId: string;
  content: string;
  waMessageId: string;
  payloadRaw: any;
}): Promise<AiScopeGateResult> {
  const { customer, conversation, tenantId } = params;

  if (conversation.is_human_handling) {
    return { action: 'pass' };
  }

  const config = AiEligibilityConfigService.getConfig(tenantId);

  // Status klinis & operasional dari Canonical Patient Lifecycle Service.
  // Flag eksplisit pada objek customer menang tanpa DB; selain itu profil
  // DB (best-effort) + fallback `ltv_cache` objek. DB offline → profil
  // default aman (bukan pasien lama, tanpa jadwal aktif).
  let profile: {
    isExistingPatient: boolean;
    hasActiveAppointment: boolean;
  } | null = null;
  if (customer.id) {
    try {
      profile = await patientLifecycleService.getPatientClinicalProfile(
        customer.id,
        tenantId,
        { ltv_cache: customer.ltv_cache ?? undefined },
      );
    } catch {
      profile = null;
    }
  }

  // Flag eksplisit `true` / profil DB / `ltv_cache > 0` — salah satu cukup
  // (OR). DB offline → hanya flag objek + ltv yang berbicara (fail-open di
  // level lookup; fail-closed tetap dijaga langkah scope di resolver).
  const hasTreatmentHistory =
    customer.has_treatment_history === true ||
    (profile !== null && profile.isExistingPatient) ||
    Number(customer.ltv_cache ?? 0) > 0;
  const hasActiveAppointment =
    customer.has_active_appointment === true ||
    (profile !== null && profile.hasActiveAppointment);

  const enrichedCustomer = {
    ...customer,
    has_treatment_history: hasTreatmentHistory,
    has_active_appointment: hasActiveAppointment,
    // Alias deprecated untuk kompatibilitas pembaca lama.
    has_confirmed_reservation: hasTreatmentHistory,
  };

  const resolution = resolveAiEligibilityWithReason(enrichedCustomer, config);
  if (resolution.eligible) {
    return { action: 'pass' };
  }

  const reason = resolution.reason || AI_ELIGIBILITY_ESCALATION_REASON;

  // Jika percakapan sedang mid-flow aktif (belum idle), tunda pembungkaman
  if (!isAtResetBoundary(conversation)) {
    console.log(
      `[AI SCOPE] Customer ${customer.phone} (${reason}) masih mid-flow (${conversation.current_state}). Menunda silence sampai reset berikutnya.`
    );
    return { action: 'pass' };
  }

  const humanFriendlyReason =
    reason === ACTIVE_APPOINTMENT_ESCALATION_REASON
      ? 'Pasien memiliki jadwal treatment aktif hari ini (Manual Handling CS - Koordinasi Operasional)'
      : reason === EXISTING_PATIENT_ESCALATION_REASON
      ? 'Pasien telah memiliki riwayat treatment / Repeat Order (Manual Handling CS)'
      : reason === LEGACY_CUSTOMER_ESCALATION_REASON
      ? 'Kontak Legacy / Arsip Chat Lama (Manual Handling CS)'
      : 'AI Rollout Scope: Customer terdaftar sebelum tanggal cutoff (Manual Handling CS)';

  await conversationService.escalateToHumanHandling(
    conversation,
    customer.phone,
    humanFriendlyReason,
    tenantId,
    reason
  );

  await messageService.logMessage({
    tenantId,
    conversationId: conversation.id,
    direction: 'INBOUND',
    content: params.content,
    waMessageId: params.waMessageId,
    payloadRaw: params.payloadRaw,
  });

  console.log(
    `[AI SCOPE] Customer ${customer.phone} di-senyapkan & dirutekan ke human handling (${reason}).`
  );

  return { action: 'silence', status: 'AI_SCOPE_INELIGIBLE_SILENCED' };
}
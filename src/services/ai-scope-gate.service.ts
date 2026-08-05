import { ConversationState } from '@prisma/client';
import { AI_ELIGIBILITY_ESCALATION_REASON, resolveAiEligibility } from './ai-eligibility.service';
import { AiEligibilityConfigService } from '../config/ai-eligibility-config';
import { conversationService } from './conversation.service';
import { messageService } from './message.service';

/**
 * AI Rollout Scope Gate — gate pintu masuk pipeline (WAHA & WABA).
 *
 * Kapan customer TIDAK layak dapat AI ("legacy"):
 *   - tenant.ai_customer_scope === 'NEW_ONLY' DAN customer.created_at < ai_scope_cutoff_at,
 *   - tanpa override (ai_override FORCE_ON/FORCE_OFF menang di resolusi).
 *
 * Perilaku gate (hanya dievaluasi utk pesan yang tiba SETELAH deploy/rollout):
 *   1. Sudah HUMAN_HANDLING → pass (alur human handling existing yang menangani).
 *   2. Eligible (resolveAiEligibility true) → pass.
 *   3. Ineligible + BERADA di "reset boundary" → SENYAPKAN:
 *      human_handling=true, escalation_reason='LEGACY_AI_SCOPE_DISABLED',
 *      log pesan, TANPA balasan. Auto-release 6 jam di-skip (conversation.service).
 *   4. Ineligible + masih MID-FLOW (sesi percakapan berjalan) → DEFER: biarkan
 *      sesi menyelesaikan; gate berlaku penuh mulai state idle/reset berikutnya.
 *
 * Definisi "reset boundary" (konkret, selaras dgn idle-reset existing di
 * state-machine/machine.ts:163-197):
 *   - current_state = INITIAL atau COMPLETED (belum mulai / sesi selesai), ATAU
 *   - idle > IDLE_TIMEOUT_MS (default 24 jam) — karena pesan berikutnya pasti
 *     di-reset ke INITIAL oleh machine, menunda tidak bermanfaat.
 * Mid-flow yang masih aktif: AWAITING_LOCATION, LOCATION_CONFIRMED,
 * AWAITING_INTEREST, RESERVATION_SENT (yang tidak idle).
 *
 * Konsekuensi release manual oleh admin (hapus label hold): conversation kembali
 * ke previous_state (mid-flow) → gate akan DEFER lagi. Ini disengaja — admin
 * eksplisit melepas agar bot aktif; JANGAN re-senyapkan agar tidak menjebak admin.
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
  if (resolveAiEligibility(customer, config)) {
    return { action: 'pass' };
  }

  if (!isAtResetBoundary(conversation)) {
    console.log(
      `[AI SCOPE] Customer ${customer.phone} legacy (non-AI) masih mid-flow (${conversation.current_state}). Menunda silence sampai reset berikutnya.`
    );
    return { action: 'pass' };
  }

  await conversationService.escalateToHumanHandling(
    conversation,
    customer.phone,
    'LEGACY_AI_SCOPE_DISABLED',
    tenantId,
    AI_ELIGIBILITY_ESCALATION_REASON
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
    `[AI SCOPE] Customer ${customer.phone} legacy di-senyapkan & dirutekan ke human handling (${AI_ELIGIBILITY_ESCALATION_REASON}).`
  );

  return { action: 'silence', status: 'AI_SCOPE_INELIGIBLE_SILENCED' };
}
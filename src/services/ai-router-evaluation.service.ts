import { prisma } from '../db/client';
import { conversationService } from './conversation.service';
import type { AIRouterResponse } from '../integrations/llm/ai-router';

/**
 * Observability + safety untuk AI Router Engine.
 *
 * 1. logRouterEvaluation — menyimpan hasil shadow/full evaluation ke tabel
 *    ai_router_evaluations (queryable utk hitung akurasi). Gagal menulis log
 *    TIDAK BOLEH mengganggu balasan ke customer → error selalu di-swallow.
 * 2. handleRouterResult — counter UNKNOWN berulang per-conversation.
 *    UNKNOWN >= UNKNOWN_ESCALATION_THRESHOLD (2x) → force eskalasi human.
 *    Konsisten dgn pola retry counter existing (lokasi 3x gagal → eskalasi).
 */

export const UNKNOWN_ESCALATION_THRESHOLD = 2;

export interface LegacyDecisionSnapshot {
  intent: string;
  escalated: boolean;
}

export interface LogEvaluationParams {
  customerPhone: string;
  messageText: string;
  currentState: string;
  // null kalau circuit breaker OPEN & fallback dipakai tanpa sempat manggil LLM
  llmResult: AIRouterResponse | null;
  usedFallback: boolean;
  legacy: LegacyDecisionSnapshot;
  responseTimeMs?: number;
}

export async function logRouterEvaluation(params: LogEvaluationParams): Promise<void> {
  const { customerPhone, messageText, currentState, llmResult, usedFallback, legacy, responseTimeMs } = params;

  const intentMatch = llmResult ? llmResult.intent === legacy.intent : false;
  const escalationMatch = llmResult ? llmResult.needs_human_escalation === legacy.escalated : false;

  let mismatchNotes: string | null = null;
  if (!intentMatch || !escalationMatch) {
    mismatchNotes = `LLM: intent=${llmResult?.intent ?? 'N/A'}, escalate=${llmResult?.needs_human_escalation ?? 'N/A'} | Legacy: intent=${legacy.intent}, escalate=${legacy.escalated}`;
  }

  try {
    await prisma.aiRouterEvaluation.create({
      data: {
        customer_phone: customerPhone,
        message_text: messageText,
        current_state: currentState,
        llm_raw_output: llmResult ? (llmResult as any) : undefined,
        llm_intent: llmResult?.intent ?? null,
        llm_confidence: llmResult?.confidence_score ?? null,
        llm_used_fallback: usedFallback,
        legacy_intent: legacy.intent,
        legacy_escalated: legacy.escalated,
        intent_match: intentMatch,
        escalation_match: escalationMatch,
        mismatch_notes: mismatchNotes,
        response_time_ms: responseTimeMs ?? null,
      },
    });
  } catch (err) {
    console.error('[ai-router-evaluation] gagal simpan log shadow mode', err);
  }
}

/**
 * Translasi TIPIS keputusan legacy pipeline (state machine existing) ke label
 * yang sebanding dgn intent LLM. Bukan logic baru — cuma label ulang keputusan
 * yang sudah terjadi. Label "UNMAPPED" sengaja beda dari "UNKNOWN": menandakan
 * mapping observability kita belum lengkap, bukan masalah router.
 */
export function mapLegacyDecisionToIntent(context: {
  stateBefore: string;
  stateAfter: string;
  wasMedicalDetected: boolean;
  wasScheduleQuestion: boolean;
  wasFaqAnswered: boolean;
}): LegacyDecisionSnapshot {
  if (context.wasMedicalDetected) {
    return { intent: 'MEDICAL_CONCERN', escalated: true };
  }
  if (context.wasScheduleQuestion) {
    return { intent: 'ASK_SPECIFIC_SCHEDULE', escalated: true };
  }
  if (context.wasFaqAnswered) {
    return { intent: 'ASK_FAQ', escalated: false };
  }
  if (context.stateAfter === 'AWAITING_LOCATION' && context.stateBefore !== 'AWAITING_LOCATION') {
    return { intent: 'GREETING', escalated: false };
  }
  if (context.stateBefore === 'AWAITING_LOCATION' && context.stateAfter !== 'AWAITING_LOCATION') {
    return { intent: 'PROVIDE_LOCATION', escalated: false };
  }
  // fallback label kalau tidak ada mapping jelas — tetap dicatat utk review manual
  return { intent: 'UNMAPPED', escalated: false };
}

/**
 * Counter UNKNOWN berulang per-conversation:
 * - intent UNKNOWN → increment; saat mencapai threshold → override jadi eskalasi
 *   human (reason UNKNOWN_REPEATED), TIDAK peduli apa kata router sebelumnya.
 * - intent selain UNKNOWN → reset counter ke 0.
 */
export async function handleRouterResult(
  conversation: { id: string; tenant_id?: string; consecutive_unknown_count?: number },
  routerResult: AIRouterResponse,
  tenantId: string
): Promise<AIRouterResponse> {
  if (routerResult.intent === 'UNKNOWN') {
    const current = conversation.consecutive_unknown_count || 0;
    const newCount = current + 1;
    conversation.consecutive_unknown_count = newCount;

    await conversationService
      .updateConversationState(conversation.id, { consecutiveUnknownCount: newCount }, tenantId)
      .catch((err) => console.error('[ai-router-evaluation] gagal update counter unknown:', err.message));

    if (newCount >= UNKNOWN_ESCALATION_THRESHOLD) {
      return {
        ...routerResult,
        needs_human_escalation: true,
        escalation_reason: 'UNKNOWN_REPEATED',
        reasoning_note: `Auto-escalated: ${newCount}x UNKNOWN berturut-turut dalam thread ini`,
      };
    }
    return routerResult;
  }

  if ((conversation.consecutive_unknown_count || 0) > 0) {
    conversation.consecutive_unknown_count = 0;
    await conversationService
      .updateConversationState(conversation.id, { consecutiveUnknownCount: 0 }, tenantId)
      .catch((err) => console.error('[ai-router-evaluation] gagal reset counter unknown:', err.message));
  }

  return routerResult;
}

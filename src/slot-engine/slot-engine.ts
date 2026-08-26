import { StateHandlerContext, StateHandlerResult } from '../state-machine/types';
import { ConversationState } from '@prisma/client';
import { SlateStore } from './slate-store';
import { EntityExtractor } from './entity-extractor';
import { DecisionMatrix } from './decision-matrix';
import { GroundingComposer } from './grounding-composer';
import { ReplyGenerator } from './reply-generator';
import { conversationService } from '../services/conversation.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Core Orchestrator: Context-Grounded Slot-Filling Engine.
 * Menjalankan pipeline: Slate Hydration -> Entity Extraction -> Decision Matrix -> Grounding -> Generator -> Persistence.
 */
export async function processSlotEngine(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { customer, conversation, incomingMessage, history } = ctx;
  const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;
  const incomingText = incomingMessage?.text?.body || '';

  console.log(`[SLOT ENGINE] Processing message from customer ${customer.phone} ("${incomingText}")`);

  // 1. Hydrate Customer Slate dari database snapshot
  const initialSlate = SlateStore.hydrateSlate(ctx);

  // 1b. Fast-Track ⚡: Single-Pass 1-Call FAQ & General Knowledge Inquiry
  const { isFastFaq1CallEnabled } = await import('../config/feature-flags');
  const { FastFaqDetector } = await import('./fast-faq-detector');
  if (isFastFaq1CallEnabled(tenantId) && FastFaqDetector.isPotentialFastFaq(incomingText, initialSlate)) {
    const { FastFaqGenerator } = await import('./fast-faq-generator');
    const fastResult = await FastFaqGenerator.process(ctx, initialSlate);
    if (fastResult) {
      await SlateStore.persistSlate(fastResult.updatedSlate);
      return fastResult.handlerResult;
    }
    console.log(`[SLOT ENGINE] Fast-Track FAQ fell through to 2-Call Deep Engine for customer ${customer.phone}`);
  }

  // 2. Ekstrak seluruh entitas & intensi dalam Single-Pass LLM
  const extraction = await EntityExtractor.extract(incomingText, {
    history,
    customerPhone: customer.phone,
    conversationId: conversation.id,
    tenantId,
    incomingMessage,
  });

  // 3. Evaluasi Decision Matrix (0 Token, Pure TypeScript)
  const decision = await DecisionMatrix.evaluate(initialSlate, extraction, { tenantId, incomingText });

  // 4. Handle Kasus 1: Eskalasi Darurat Medis
  if (decision.action === 'ESCALATE_HUMAN_EMERGENCY') {
    await SlateStore.persistSlate(decision.updatedSlate);
    await conversationService.escalateToHumanHandling(
      conversation,
      customer.phone,
      `Darurat medis terdeteksi via Slot-Filling Engine: "${incomingText}"`,
      tenantId,
      'medical_concern'
    );
    try {
      const { AlertService, AlertType, AlertSeverity } = await import('../services/alert.service');
      const alertService = new AlertService();
      await alertService.notifyAlert({
        type: AlertType.MEDICAL_EMERGENCY_HIGH,
        severity: AlertSeverity.CRITICAL,
        message: `[MEDICAL CRITICAL ALERT] Customer: ${customer.phone}. Text: "${incomingText}"`,
        metadata: { customerPhone: customer.phone, incomingText },
      });
    } catch {}

    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 5. Handle Kasus 2: Percakapan Sedang Diambil Alih CS
  if (decision.action === 'SILENT_HUMAN_ACTIVE') {
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 6. Handle Kasus 3 & 4: Template Balasan Deterministik (Form Reservasi / Out of Coverage)
  if (decision.deterministicTemplateReply) {
    await SlateStore.persistSlate(decision.updatedSlate);
    return {
      nextState: decision.updatedSlate.projectedState,
      replyText: decision.deterministicTemplateReply,
      shouldSendReply: true,
      sendPricelistImage: decision.shouldSendPricelistImage,
      pricelistCaption: decision.pricelistCaption,
      aiReasoning: decision.reason,
    };
  }

  // 7. Handle Kasus 5 & 6: Single-Pass AI Response Generation
  const grounding = await GroundingComposer.compose(decision.updatedSlate, extraction, {
    customerInput: incomingText,
    tenantId,
  });
  const replyText = await ReplyGenerator.generate(decision.updatedSlate, extraction, grounding, {
    history,
    customerPhone: customer.phone,
    customerInput: incomingText,
    tenantId,
  });

  // Simpan update state ke DB
  await SlateStore.persistSlate(decision.updatedSlate);

  return {
    nextState: decision.updatedSlate.projectedState,
    replyText,
    shouldSendReply: true,
    sendPricelistImage: decision.shouldSendPricelistImage,
    pricelistCaption: decision.pricelistCaption,
    aiReasoning: decision.reason,
  };
}

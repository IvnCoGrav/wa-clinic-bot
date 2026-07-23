import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { llmIntentService } from '../../integrations/llm/intent';
import { knowledgeBaseService } from '../../services/knowledge.service';
import { llmResponseGenerator } from '../../integrations/llm/generator';
import { conversationService } from '../../services/conversation.service';
import { TEMPLATES } from '../../config/persona';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/**
 * Handler untuk state AWAITING_INTEREST:
 * Mengklasifikasikan respons pengguna (Interested, FAQ Question, Asking Schedule, Not Interested, Other).
 */
export async function handleInterestState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { incomingMessage, customer, conversation } = ctx;
  const tenantId = ctx.tenantId || customer?.tenant_id || DEFAULT_TENANT_ID;
  const userText = incomingMessage.text?.body || '';

  const lower = userText.toLowerCase().trim();

  // Kalibrasi Redirect: Pemicu butuh kata kunci aksi (ganti, pindah, dsb) + di/ke, atau direct query
  const hasChangeKeyword = /(ganti|pindah|salah|ubah|bukan|yang\s+bener|alamat)/i.test(userText);
  const isConversationalLocation = hasChangeKeyword && (
    /di\s+/i.test(lower) || 
    /ke\s+/i.test(lower)
  );
  const isDirectLocationQuery = /^(saya\s+)?di\s+[a-z]+/i.test(userText.trim()) || 
                                /^ongkir\s+ke\s+[a-z]+/i.test(userText.trim()) || 
                                /^rumah\s+saya\s+di\s+[a-z]+/i.test(userText.trim()) || 
                                /^kalau\s+di\s+[a-z]+/i.test(userText.trim());

  if (incomingMessage.type === 'location' || isConversationalLocation || isDirectLocationQuery) {
    console.log(`[LOCATION REDIRECT] Redirecting location query/change "${userText}" to handleLocationState.`);
    const { handleLocationState } = await import('./location');
    return handleLocationState(ctx);
  }

  // 1. Deteksi Intent (5 Intent Classifier)
  const intentResult = await llmIntentService.detectIntent(userText);
  console.log(`[INTENT DETECTED] Customer Message: "${userText}" -> Intent: ${intentResult.intent}`);

  switch (intentResult.intent) {
    case 'faq_question': {
      // 2. Query Knowledge Base menggunakan Postgres Full-Text Search ('simple')
      const relevantChunks = await knowledgeBaseService.searchRelevantChunks(userText, 3, tenantId);

      // 3. Generate balasan FAQ natural berbasis RAG + Persona
      const faqAnswer = await llmResponseGenerator.generateFaqResponse(userText, relevantChunks);

      // 4. JANGAN RESET / UBAH STATE: Tambahkan kalimat follow-up sesuai state saat ini!
      const replyText = TEMPLATES.faqFollowUp(faqAnswer);

      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText,
        shouldSendReply: true,
      };
    }

    case 'interested':
      if (!customer.kelurahan || !customer.lat || !customer.lng) {
        return {
          nextState: ConversationState.AWAITING_LOCATION,
          replyText: `Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊`,
          shouldSendReply: true,
        };
      }
      return {
        nextState: ConversationState.RESERVATION_SENT,
        replyText: TEMPLATES.reservationFormRequest(),
        shouldSendReply: true,
      };

    case 'asking_schedule':
      // Eskalasi ke Human Handling + simpan previous_state = AWAITING_INTEREST
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        `Customer bertanya jadwal spesifik: "${userText}"`,
        tenantId
      );

      return {
        nextState: ConversationState.HUMAN_HANDLING,
        replyText: TEMPLATES.scheduleCheckHandoff(),
        shouldSendReply: true,
        isHumanHandling: true,
      };

    case 'not_interested':
      return {
        nextState: ConversationState.COMPLETED,
        replyText: TEMPLATES.notInterestedReply(),
        shouldSendReply: true,
      };

    case 'other':
    default:
      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: TEMPLATES.interestUnrelatedFollowUp(),
        shouldSendReply: true,
      };
  }
}

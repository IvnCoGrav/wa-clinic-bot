import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { llmIntentService } from '../../integrations/llm/intent';
import { knowledgeBaseService } from '../../services/knowledge.service';
import { llmResponseGenerator } from '../../integrations/llm/generator';
import { conversationService } from '../../services/conversation.service';
import { TEMPLATES } from '../../config/persona';

/**
 * Handler untuk state AWAITING_INTEREST:
 * Mengklasifikasikan respons pengguna (Interested, FAQ Question, Asking Schedule, Not Interested, Other).
 */
export async function handleInterestState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { incomingMessage, conversation } = ctx;
  const userText = incomingMessage.text?.body || '';

  // 1. Deteksi Intent (5 Intent Classifier)
  const intentResult = await llmIntentService.detectIntent(userText);
  console.log(`[INTENT DETECTED] Customer Message: "${userText}" -> Intent: ${intentResult.intent}`);

  switch (intentResult.intent) {
    case 'faq_question': {
      // 2. Query Knowledge Base menggunakan Postgres Full-Text Search ('simple')
      const relevantChunks = await knowledgeBaseService.searchRelevantChunks(userText, 3);

      // 3. Generate balasan FAQ natural berbasis RAG + Persona
      const faqAnswer = await llmResponseGenerator.generateFaqResponse(userText, relevantChunks);

      // 4. JANGAN RESET / UBAH STATE: Tambahkan kalimat follow-up sesuai state saat ini!
      const replyText = `${faqAnswer}\n\n---\nApakah Bunda tertarik untuk lanjut ke pengisian list reservasi sekarang bund? (Bisa dijawab: Mau / Tertarik)`;

      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText,
        shouldSendReply: true,
      };
    }

    case 'interested':
      return {
        nextState: ConversationState.RESERVATION_SENT,
        replyText: TEMPLATES.reservationFormRequest(),
        shouldSendReply: true,
      };

    case 'asking_schedule':
      // Eskalasi ke Human Handling + simpan previous_state = AWAITING_INTEREST
      await conversationService.escalateToHumanHandling(
        conversation,
        `Customer bertanya jadwal spesifik: "${userText}"`
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
        replyText: 'Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨',
        shouldSendReply: true,
      };

    case 'other':
    default:
      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: `Apakah Bunda ingin melanjutkan ke pengisian list reservasi treatment? 😊\n\n- Jika **mau/setuju**, silakan balas "Mau"\n- Jika ada **pertanyaan**, silakan tanyakan langsung ke bidan ya bund.`,
        shouldSendReply: true,
      };
  }
}

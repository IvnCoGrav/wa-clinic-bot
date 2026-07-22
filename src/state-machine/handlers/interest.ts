import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { llmIntentService } from '../../integrations/llm/intent';
import { knowledgeBaseService } from '../../services/knowledge.service';
import { llmResponseGenerator } from '../../integrations/llm/generator';
import { conversationService } from '../../services/conversation.service';

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

  const reservationFormUrl = process.env.RESERVATION_FORM_URL || 'https://klinik-treatment.com/booking';

  switch (intentResult.intent) {
    case 'faq_question': {
      // 2. Query Knowledge Base menggunakan Postgres Full-Text Search ('simple')
      const relevantChunks = await knowledgeBaseService.searchRelevantChunks(userText, 3);

      // 3. Generate balasan FAQ natural berbasis RAG + Persona
      const faqAnswer = await llmResponseGenerator.generateFaqResponse(userText, relevantChunks);

      // 4. JANGAN RESET / UBAH STATE: Tambahkan kalimat follow-up sesuai state saat ini!
      const replyText = `${faqAnswer}\n\n---\nApakah Kakak tertarik untuk lanjut ke pengisian form reservasi sekarang? (Bisa dijawab: Mau / Kirim Link)`;

      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText,
        shouldSendReply: true,
      };
    }

    case 'interested':
      return {
        nextState: ConversationState.RESERVATION_SENT,
        replyText: `Terima kasih Kak! 🎉 Silakan isi form reservasi perawatan Kakak melalui link berikut:\n\n👉 ${reservationFormUrl}\n\nSetelah form terisi, tim kami akan segera mengonfirmasi pesanan Kakak. Sampai jumpa! ✨`,
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
        replyText: 'Baik Kak, saya cek jadwal ketersediaan terdekat dulu ya. Mohon tunggu sebentar, tim admin kami akan segera membalas percakapan ini secara langsung. 😊',
        shouldSendReply: true,
        isHumanHandling: true,
      };

    case 'not_interested':
      return {
        nextState: ConversationState.COMPLETED,
        replyText: 'Baik Kak, tidak apa-apa. Terima kasih banyak sudah menghubungi Klinik Kecantikan kami! Jika sewaktu-waktu membutuhkan konsultasi atau perawatan, Kakak bisa menghubungi kami kembali. Have a great day! ✨',
        shouldSendReply: true,
      };

    case 'other':
    default:
      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: `Apakah Kakak ingin melanjutkan ke pengisian form reservasi perawatan? 😊\n\n- Jika **mau/setuju**, balaskan "Mau"\n- Jika ada **pertanyaan/faq**, silakan tanyakan langsung ya.`,
        shouldSendReply: true,
      };
  }
}

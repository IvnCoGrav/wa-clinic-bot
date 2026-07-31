import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { llmIntentService, IntentType } from '../../integrations/llm/intent';
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

  // --- MIXED-SIGNAL DETECTION ---
  // Deteksi pola "afirmasi + tapi/tetapi/tp + negasi" → minta klarifikasi
  const hasAffirmWord = /\b(iya|yup|ok|oke|bener|betul|lanjut|benar|yes|sip|gpp|ho.?oh)\b/i.test(lower);
  const hasNegateWord = /\b(bukan|ga|gak|tidak|no|salah|enggak|beda|berubah)\b/i.test(lower);
  const hasConjunction = /\b(tapi|tetapi|tp|cuma|akan\s+tapi|tapi\s+kok|tapi\s+kan)\b/i.test(lower);
  
  if (hasAffirmWord && hasNegateWord && hasConjunction) {
    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText: `Maaf Bunda, sepertinya ada yang kurang tepat. Bunda ingin mengubah lokasi atau informasi lainnya? Bisa diperjelas lagi ya bund. 😊`,
      shouldSendReply: true,
    };
  }

  // Kalibrasi Redirect: Pemicu butuh kata kunci aksi (ganti, pindah, dsb) + di/ke, atau direct query
  const hasChangeKeyword = /(ganti|pindah|salah|ubah|bukan|yang\s+bener|alamat)/i.test(userText);
  const isConversationalLocation = hasChangeKeyword && (
    /di\s+/i.test(lower) || 
    /ke\s+/i.test(lower)
  );
  const isDirectLocationQuery = 
    /^(saya\s+)?(di|ke)\s+[a-z0-9]/i.test(userText.trim()) || 
    /^(ongkir|tarif|biaya|kirim|pengiriman)\s+(ke|di)\s+/i.test(userText.trim()) || 
    /^rumah\s+saya\s+(di|ke)\s+/i.test(userText.trim()) || 
    /^kalau\s+(di|ke)\s+/i.test(userText.trim());

  if (incomingMessage.type === 'location' || isConversationalLocation || isDirectLocationQuery) {
    console.log(`[LOCATION REDIRECT] Redirecting location query/change "${userText}" to handleLocationState.`);
    const { handleLocationState } = await import('./location');
    return handleLocationState(ctx);
  }

  // 0. Cek jika di state RESERVATION_SENT dan customer mengirimkan form reservasi
  if (conversation.current_state === ConversationState.RESERVATION_SENT) {
    const isFormSubmission = lower.includes('berikut list untuk reservasi') || 
                             lower.includes('pilihan treatment');
                             
    if (isFormSubmission) {
      const { parseReservationText } = await import('../../utils/reservation-text-parser');
      const parseResult = parseReservationText(userText);

      if (parseResult.success && parseResult.reservation) {
        const parsed = parseResult.reservation;
        // Simpan reservasi ke database
        try {
          const { prisma } = await import('../../db/client');
          const reservation = await prisma.reservation.create({
            data: {
              tenant_id: tenantId,
              customer_id: customer.id,
              treatment_category: parsed.treatmentCategory,
              treatment_detail: parsed.treatmentDetail,
              booking_date: parsed.bookingDate,
              raw_text: userText,
              status: 'pending',
            },
          });

          const { followUpService } = await import('../../services/follow-up.service');
          await followUpService.onReservationCreated(customer.id, reservation.id, tenantId);
        } catch (dbErr) {
          // Abaikan error DB untuk in-memory fallback
        }

        // Eskalasi ke human handling untuk konfirmasi jadwal manual oleh admin
        await conversationService.escalateToHumanHandling(
          conversation,
          customer.phone,
          `Formulir reservasi telah diisi oleh customer: "${parsed.treatmentDetail}"`,
          tenantId
        );

        return {
          nextState: ConversationState.HUMAN_HANDLING,
          replyText: `Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊`,
          shouldSendReply: true,
          isHumanHandling: true,
        };
      } else {
        // Jika format kurang lengkap, minta lengkapi field yang kurang
        const missing = parseResult.missingFields || [];
        const missingStr = missing.join(', ');
        return {
          nextState: ConversationState.RESERVATION_SENT,
          replyText: `Maaf Bunda, data reservasi yang dikirimkan kurang lengkap. Mohon isi bagian berikut ya bund: ${missingStr}. Terima kasih! 😊`,
          shouldSendReply: true,
        };
      }
    }
  }

  // 1. Deteksi Intent — NLU Layer-first, dengan fallback ke legacy llmIntentService
  //
  // ATURAN PRIORITAS: State machine tetap memegang kendali. NLU hanya mempercepat dan
  // memperkaya input klasifikasi. Jika NLU confident (>= 0.6, non-fallback), kita mapping
  // NLU intents ke legacy IntentType taxonomy dan skip extra LLM call.
  // Jika NLU tidak tersedia atau confidence rendah, jatuh ke llmIntentService seperti semula.

  const nlu = ctx.nluResult;
  const nluConfident = nlu && !nlu.isFallback && (nlu.confidence || 0) >= 0.6;

  let intentResult: { intent: IntentType; confidence: number };

  if (nluConfident) {
    // Map NLU taxonomy → legacy IntentType (preserve all existing switch branches)
    let mappedIntent: IntentType = 'other';

    if (nlu!.intents.includes('complaint')) {
      mappedIntent = 'complaint';
    } else if (nlu!.intents.includes('ask_schedule')) {
      mappedIntent = 'asking_schedule';
    } else if (nlu!.intents.includes('faq_question') || nlu!.intents.includes('ask_price')) {
      mappedIntent = 'faq_question';
    } else if (nlu!.intents.includes('express_interest') || nlu!.intents.includes('affirmation')) {
      mappedIntent = 'interested';
    } else if (nlu!.intents.includes('negation')) {
      mappedIntent = 'not_interested';
    } else if (nlu!.intents.includes('off_topic') || nlu!.intents.includes('greeting')) {
      mappedIntent = 'other';
    }

    intentResult = { intent: mappedIntent, confidence: nlu!.confidence };
    console.log(`[INTENT DETECTED] (NLU Layer) Customer: "${userText}" → NLU intents: [${nlu!.intents.join(',')}] → Mapped: ${mappedIntent} (conf: ${nlu!.confidence.toFixed(2)})`);
  } else {
    // Fallback to legacy LLM intent service (5-intent classifier)
    intentResult = await llmIntentService.detectIntent(userText);
    console.log(`[INTENT DETECTED] (Legacy LLM) Customer Message: "${userText}" → Intent: ${intentResult.intent}`);
  }

  switch (intentResult.intent) {
    case 'medical_query':
    case 'complaint':
      // Eskalasi langsung ke Human secara senyap (tanpa balas chat bot)
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        `Customer menyampaikan keluhan medis/komplain: "${userText}"`,
        tenantId
      );
      return {
        nextState: ConversationState.HUMAN_HANDLING,
        shouldSendReply: false,
        isHumanHandling: true,
      };

    case 'faq_question': {
      // 2. Query Knowledge Base menggunakan Postgres Full-Text Search ('simple')
      const relevantChunks = await knowledgeBaseService.searchRelevantChunks(userText, 3, tenantId);

      // Jika tidak ada FAQ yang cocok sama sekali, lempar ke manusia tanpa balas chat
      if (relevantChunks.length === 0) {
        console.log(`[FAQ ESCALATION] No relevant chunks found for: "${userText}". Escalating silently.`);
        await conversationService.escalateToHumanHandling(
          conversation,
          customer.phone,
          `Pertanyaan FAQ tidak terjawab di database: "${userText}"`,
          tenantId
        );
        return {
          nextState: ConversationState.HUMAN_HANDLING,
          shouldSendReply: false,
          isHumanHandling: true,
        };
      }

      // 3. Generate balasan FAQ natural berbasis RAG + Persona (dengan history & reasoning)
      const faqAnswer = await llmResponseGenerator.generateFaqResponse(userText, relevantChunks, conversation.id, tenantId);

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

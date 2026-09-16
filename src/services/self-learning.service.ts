import { prisma } from '../db/client';
import { knowledgeBaseService } from './knowledge.service';
import { BOT_PERSONA_PROMPT } from '../config/persona';
import { getBrandIdentity } from '../config/brand';
import { getLlmEndpointConfig, callChatWithRetry, extractJsonContent } from '../integrations/llm/llm-gateway';

interface AdminReplyBuffer {
  text: string;
  timer: NodeJS.Timeout;
}

export class SelfLearningService {
  private buffers: Map<string, AdminReplyBuffer> = new Map();

  /**
   * Process manual outbound messages sent by the admin (human agent).
   * Aggregates subsequent bubbles with a 10s debounce to parse complex/multi-line answers.
   */
  public async processAdminReply(
    customerId: string,
    conversationId: string,
    replyText: string,
    tenantId: string
  ): Promise<void> {
    if (process.env.ENABLE_SELF_LEARNING !== 'true') {
      return;
    }

    const existing = this.buffers.get(conversationId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.text += '\n' + replyText.trim();
      existing.timer = setTimeout(() => {
        this.finalizeLearning(customerId, conversationId, existing.text, tenantId);
        this.buffers.delete(conversationId);
      }, 10000);
    } else {
      const timer = setTimeout(() => {
        this.finalizeLearning(customerId, conversationId, replyText.trim(), tenantId);
        this.buffers.delete(conversationId);
      }, 10000);
      this.buffers.set(conversationId, {
        text: replyText.trim(),
        timer,
      });
    }
  }

  private async finalizeLearning(
    customerId: string,
    conversationId: string,
    adminAnswer: string,
    tenantId: string
  ): Promise<void> {
    try {
      // Fetch the last inbound message from the customer in this conversation
      const lastInbound = await prisma.message.findFirst({
        where: {
          conversation_id: conversationId,
          direction: 'INBOUND',
          tenant_id: tenantId,
        },
        orderBy: { created_at: 'desc' },
      });

      if (!lastInbound || !lastInbound.content) {
        console.log(`[SELF-LEARNING] No last inbound customer message found for conversation ${conversationId}. Skipping learning.`);
        return;
      }

      const customerQuestion = lastInbound.content;
      const { LegacyHarvestingService } = await import('./legacy-harvesting.service');
      if (
        LegacyHarvestingService.isTransactionOrScheduleMessage(customerQuestion) ||
        LegacyHarvestingService.isTransactionOrScheduleMessage(adminAnswer)
      ) {
        console.log('[SELF-LEARNING IGNORED] Q&A pair is transactional/scheduling. Skipping FAQ staging.');
        return;
      }

      console.log(`[SELF-LEARNING] Debounce finished. Processing Q&A pair:\nQ: "${customerQuestion}"\nA: "${adminAnswer}"`);

      // Ask LLM to refine the raw Q&A into a generalized FAQ entry
      const refinedFaq = await this.refineFaqWithLLM(customerQuestion, adminAnswer);
      if (refinedFaq) {
        console.log(`[SELF-LEARNING SUCCESS] Generalized FAQ extracted:\nQ: "${refinedFaq.question}"\nA: "${refinedFaq.answer}"`);

        // Check medical concern
        const { MedicalDetectionService } = await import('./medical-detection.service');
        const medicalCheck = MedicalDetectionService.detectMedicalConcern(refinedFaq.question);

        // Anti-duplication check
        const dupCheck = await knowledgeBaseService.checkDuplicateFaq(refinedFaq.question, tenantId, 0.70);
        const stagingStatus: any = dupCheck.isDuplicate ? 'EXISTING_MATCH' : 'PENDING';
        if (medicalCheck.isMedical) {
          await prisma.medicalFaqStaging.create({
            data: {
              tenant_id: tenantId,
              conversation_id: conversationId,
              customer_phone: customerId,
              raw_question: customerQuestion,
              bidan_raw_reply: adminAnswer,
              general_question: refinedFaq.question,
              general_answer: refinedFaq.answer,
              symptoms_tagged: medicalCheck.detectedSymptoms,
              status: stagingStatus,
              matched_chunk_id: dupCheck.matchedChunk?.id || null,
              matched_similarity: dupCheck.similarity || null,
            },
          });
        } else {
          await prisma.generalFaqStaging.create({
            data: {
              tenant_id: tenantId,
              conversation_id: conversationId,
              raw_question: customerQuestion,
              raw_answer: adminAnswer,
              general_question: refinedFaq.question,
              general_answer: refinedFaq.answer,
              category: 'livechat_harvest',
              status: stagingStatus,
              matched_chunk_id: dupCheck.matchedChunk?.id || null,
              matched_similarity: dupCheck.similarity || null,
            },
          });
        }
        console.log(`[SELF-LEARNING STAGED] Q&A pair routed to ${medicalCheck.isMedical ? 'MedicalFaqStaging' : 'GeneralFaqStaging'} for review.`);

        // PLAN 9 FASE 9.3 — Usulan exemplar GAYA (default NON-AKTIF, menunggu review admin).
        // Syarat ketat agar antrean review tidak dipenuhi sampah:
        //  - jawaban admin 20–800 char, tanpa nominal rupiah (harga WAJIB dari tool, bukan contoh),
        //  - tanpa nomor telepon / rekening (anti PII bocor ke prompt),
        //  - tanpa markdown double-star (format gate).
        // TIDAK PERNAH auto-aktif: isActive=false selalu.
        try {
          await this.proposeStyleExemplar(customerQuestion, adminAnswer, refinedFaq, tenantId);
        } catch (exErr: any) {
          console.warn('[SELF-LEARNING] proposeStyleExemplar gagal (non-fatal):', exErr?.message || exErr);
        }
      } else {
        console.log('[SELF-LEARNING IGNORED] Message exchange is transactional or personal. Skipping database ingestion.');
      }
    } catch (err: any) {
      console.error('[SELF-LEARNING ERROR] Error in finalizeLearning:', err.message || err);
    }
  }

  private async proposeStyleExemplar(
    customerQuestion: string,
    adminAnswer: string,
    refinedFaq: { question: string; answer: string },
    tenantId: string
  ): Promise<void> {
    const answer = (adminAnswer || '').trim();
    const question = (customerQuestion || '').trim();

    // Filter kualitas: panjang wajar.
    if (answer.length < 20 || answer.length > 800 || question.length < 3) {
      console.log('[SELF-LEARNING STYLE] Dilewati: panjang di luar 20–800 char.');
      return;
    }
    // Filter anti-kontaminasi harga: exemplar gaya DILARANG memuat nominal rupiah.
    if (/(rp\s*\d|rp\.?\s*\d|\d+\s*(rb|ribu|jt|juta))/i.test(answer)) {
      console.log('[SELF-LEARNING STYLE] Dilewati: jawaban memuat nominal (harga dari tool, bukan contoh).');
      return;
    }
    // Filter anti-PII: nomor telepon / rekening tidak boleh masuk prompt.
    const digitsOnly = answer.replace(/\D/g, '');
    if (digitsOnly.length >= 9 || /\b\d{4}[\s-]?\d{4}[\s-]?\d{4,}\b/.test(answer)) {
      console.log('[SELF-LEARNING STYLE] Dilewati: terdeteksi deretan digit panjang (risiko PII).');
      return;
    }
    // Filter format gate.
    if (answer.includes('**')) {
      console.log('[SELF-LEARNING STYLE] Dilewati: mengandung markdown "**".');
      return;
    }

    const { FewShotExemplarBank } = await import('../v3/agent/few-shot-exemplars');
    await FewShotExemplarBank.createExemplar(
      {
        scenario: `Gaya admin (harvest livechat, perlu review): ${refinedFaq.question.slice(0, 120)}`,
        customerMessage: question.slice(0, 500),
        idealResponse: answer.slice(0, 800),
        tags: ['style-harvest', 'needs-review'],
        isActive: false,
      },
      tenantId
    );
    console.log('[SELF-LEARNING STYLE] Usulan exemplar gaya dibuat (is_active=false, menunggu review admin).');
  }

  private async refineFaqWithLLM(
    question: string,
    answer: string
  ): Promise<{ question: string; answer: string } | null> {
    const config = getLlmEndpointConfig({ modelConfigKey: 'SUMMARIZATION' });

    if (!config.apiKey || config.apiKey.startsWith('mock')) {
      // Offline fallback: filter out obvious noise, otherwise learn directly
      const lowerQ = question.toLowerCase();
      const lowerA = answer.toLowerCase();
      const noise = ['halo', 'bunda', 'otw', 'jalan', 'makasih', 'terima kasih', 'payment', 'transfer', 'rekening'];
      if (noise.some(kw => lowerA.includes(kw) || lowerQ.includes(kw))) {
        return null;
      }
      return { question, answer };
    }

    try {
      const systemPrompt = `You are a Knowledge Ingestion Assistant for a Moms & Baby Spa clinic chatbot.
Your task is to refine a raw conversation snippet between a Customer and a Bidan (Midwife/Admin) into a clean, generalized FAQ entry.

RULES:
1. Analyze if the Q&A pair contains general clinical, price, or service information that is useful for other customers (e.g., treatment details, safety guidelines, clinic rules).
2. If it is a personal or transactional exchange (e.g. address details, shareloc confirmation, greetings like "Halo bunda", specific appointment timings, payment receipts, or personal chatter), reply strictly with the JSON: {"isGeneralFaq": false}.
3. If it is a general FAQ, rewrite both the question and answer to be clean, professional, general, and matching ${getBrandIdentity().botDisplayName}'s warm tone (Indonesian). Format the response strictly as a JSON object:
{"isGeneralFaq": true, "question": "Clean general question?", "answer": "Clean general answer."}

Input:
Q: "${question}"
A: "${answer}"`;

      const response = await callChatWithRetry({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        fallbackModel: config.fallbackModel,
        payload: {
          messages: [{ role: 'system', content: systemPrompt }],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        },
        timeoutMs: config.timeoutMs || 15000,
      });

      const rawContent = response.data?.choices?.[0]?.message?.content || '';
      const jsonStr = extractJsonContent(rawContent);
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (parsed?.isGeneralFaq && parsed?.question && parsed?.answer) {
          return {
            question: parsed.question,
            answer: parsed.answer,
          };
        }
      }
      return null;
    } catch (err: any) {
      const status = err?.response?.status || err?.status || 'ERR';
      const briefError = err?.response?.data?.error?.message || err?.message || String(err);
      console.warn(`[SELF-LEARNING LLM ERROR] HTTP ${status}: ${briefError} (model: ${config.model}). Skipping FAQ staging.`);
      return null;
    }
  }
}

export const selfLearningService = new SelfLearningService();

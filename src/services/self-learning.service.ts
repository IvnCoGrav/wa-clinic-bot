import { prisma } from '../db/client';
import { knowledgeBaseService } from './knowledge.service';
import axios from 'axios';
import { BOT_PERSONA_PROMPT } from '../config/persona';

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
      console.log(`[SELF-LEARNING] Debounce finished. Processing Q&A pair:\nQ: "${customerQuestion}"\nA: "${adminAnswer}"`);

      // Ask LLM to refine the raw Q&A into a generalized FAQ entry
      const refinedFaq = await this.refineFaqWithLLM(customerQuestion, adminAnswer);
      if (refinedFaq) {
        console.log(`[SELF-LEARNING SUCCESS] Generalized FAQ learned:\nQ: "${refinedFaq.question}"\nA: "${refinedFaq.answer}"`);
        await knowledgeBaseService.importFaqs([refinedFaq], tenantId);
      } else {
        console.log('[SELF-LEARNING IGNORED] Message exchange is transactional or personal. Skipping database ingestion.');
      }
    } catch (err: any) {
      console.error('[SELF-LEARNING ERROR] Error in finalizeLearning:', err.message || err);
    }
  }

  private async refineFaqWithLLM(
    question: string,
    answer: string
  ): Promise<{ question: string; answer: string } | null> {
    const apiKey = process.env.LLM_API_KEY || '';
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = process.env.OPENAI_MODEL || 'MiniMax-M2.7-highspeed';

    if (!apiKey || apiKey.startsWith('mock')) {
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
3. If it is a general FAQ, rewrite both the question and answer to be clean, professional, general, and matching Bidan Yusi's warm tone (Indonesian). Format the response strictly as a JSON object:
{"isGeneralFaq": true, "question": "Clean general question?", "answer": "Clean general answer."}

Input:
Q: "${question}"
A: "${answer}"`;

      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0].message.content.trim();
      const parsed = JSON.parse(content);
      if (parsed.isGeneralFaq && parsed.question && parsed.answer) {
        return {
          question: parsed.question,
          answer: parsed.answer
        };
      }
      return null;
    } catch (err) {
      console.warn('[SELF-LEARNING LLM ERROR] Failed to refine FAQ with LLM, using fallback filter:', err);
      return { question, answer };
    }
  }
}

export const selfLearningService = new SelfLearningService();

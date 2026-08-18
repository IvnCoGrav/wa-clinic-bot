import { getBrandIdentity } from '../../config/brand';
import { checkMedicalKeywords } from '../../config/medical-keywords';
import { llmOutageStorage } from './context';
import { callChatCompletionsWithFallback } from './model-fallback';
import { getLlmEndpointConfig } from './llm-gateway';
import { measure } from '../../utils/timer';
import dotenv from 'dotenv';
dotenv.config();

export type IntentType = 'interested' | 'not_interested' | 'asking_schedule' | 'faq_question' | 'medical_query' | 'complaint' | 'other';

export interface IntentDetectionResult {
  intent: IntentType;
  confidence: number;
}

/** Konteks audit opsional agar LLM call tercatat dengan atribusi (conversation_id & nomor customer). */
export interface IntentAuditContext {
  conversationId?: string | null;
  customerPhone?: string;
}

/**
 * Service untuk deteksi intent respons pengguna berbasis LLM terstruktur JSON (5 Intent).
 */
export class LLMIntentService {
  private get model(): string {
    return process.env.AI_MODEL_LEGACY_INTENT || process.env.AI_MODEL_INTENT || 'qwen3.7-flash-2026-07-15';
  }

  constructor() {}

  /**
   * Klasifikasi intent pesan pengguna ke dalam 5 intent:
   * 1. faq_question     : Menanyakan FAQ / info perawatan / harga / manfaat / durasi / cara kerja / perawatan apa saja
   * 2. asking_schedule  : Menanyakan ketersediaan hari/jam spesifik ("apakah hari Senin bisa?", "bisa jam 2?")
   * 3. interested       : Tertarik reservasi / setuju / mau lanjut booking
   * 4. not_interested   : Menolak / batal / tidak berminat
   * 5. other            : Lainnya / tidak spesifik
   */
  public async detectIntent(userMessageText: string, auditCtx?: IntentAuditContext): Promise<IntentDetectionResult> {
    const store = llmOutageStorage.getStore();
    if (store?.simulateOutage) {
      throw new Error('Primary LLM provider connection timeout (500 Internal Server Error)');
    }

    const endpointCheck = getLlmEndpointConfig({ model: this.model });
    if (!endpointCheck.apiKey || endpointCheck.apiKey.startsWith('mock')) {
      return this.ruleBasedFallbackIntent(userMessageText);
    }

    try {
      const startedAt = Date.now();
      const endpoint = getLlmEndpointConfig({ model: this.model });
      let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
      try {
        callResult = await measure('LLM_INTENT_API_CALL', () =>
          callChatCompletionsWithFallback({
            baseUrl: endpoint.baseUrl,
            apiKey: endpoint.apiKey,
            model: this.model,
            fallbackModel: endpoint.fallbackModel,
            timeoutMs: endpoint.timeoutMs,
            payload: {
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'system',
                  content: `You are an internal JSON intent classifier for ${getBrandIdentity().businessName} WhatsApp Chatbot.
Your job is ONLY to classify user messages into one of the following intents and return strictly valid JSON.
DO NOT respond with conversational text. DO NOT greet or say "Baik Bunda". Output strictly JSON.

Allowed JSON output format:
{"intent": "interested" | "not_interested" | "asking_schedule" | "faq_question" | "medical_query" | "complaint" | "other"}

Intent definitions:
- "faq_question": General info/treatment questions, service details, price, duration, packages, or clarifying/pointing to a package/treatment (e.g. "pijat bayi itu buat apa?", "berapa harganya?", "maksud saya yang paket newborn", "maksudku pijat laktasi").
- "asking_schedule": Inquiring about specific days/hours/slots (e.g. "apakah hari Senin bisa?", "bisa booking besok jam 3 sore?").
- "medical_query": Health concerns, medical complaints, medication requests (e.g. "anak saya demam dikasih apa ya", "bekas jahitan melahirkan perih").
- "complaint": Customer complaints or dissatisfaction (e.g. "tindik telinganya miring", "kok bidannya belum sampai").
- "interested": Customer agreeing, wanting to book, or expressing interest (e.g. "mau dong", "kirim format booking", "setuju", "boleh").
- "not_interested": Refusal, cancellation, or postponing (e.g. "ga jadi", "batal", "nanti saja").
- "other": Anything else.`,
                },
            {
              role: 'user',
              content: userMessageText,
            },
          ],
        },
        })
      );
      } catch (err: any) {
        try {
          const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
          auditLlmCall({
            customer_phone: auditCtx?.customerPhone || 'intent-audit',
            conversation_id: auditCtx?.conversationId ?? null,
            task_type: 'INTENT_DETECTION',
            model_name: this.model,
            baseUrl: endpoint.baseUrl,
            startedAt,
            error: err,
          });
        } catch {
          // Fire-and-forget
        }
        throw err;
      }

      const responseData = callResult.data;

      try {
        const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: auditCtx?.customerPhone || 'intent-audit',
          conversation_id: auditCtx?.conversationId ?? null,
          task_type: 'INTENT_DETECTION',
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: responseData?.usage,
        });
      } catch (logErr) {
        // Fire-and-forget
      }

      const content = responseData?.choices?.[0]?.message?.content ?? '';

      if (!content || content.trim() === '') {
        console.warn('[LLM INTENT ERROR] Empty content from LLM response, using fallback rule-based classifier.');
        return this.ruleBasedFallbackIntent(userMessageText);
      }
      
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(json)?\n?/, '');
        cleanContent = cleanContent.replace(/\n?```$/, '');
      }
      cleanContent = cleanContent.trim();
      
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanContent = jsonMatch[0];
      }

      const parsed = JSON.parse(cleanContent);

      return {
        intent: parsed.intent || 'other',
        confidence: 0.95,
      };
    } catch (error) {
      console.warn('[LLM INTENT ERROR] Using fallback rule-based classifier:', (error as Error).message);
      return this.ruleBasedFallbackIntent(userMessageText);
    }
  }

  private ruleBasedFallbackIntent(text: string): IntentDetectionResult {
    const lower = text.toLowerCase();

    // 1. Deteksi Keluhan / Komplain
    const complaintKeywords = ['miring', 'ketinggian', 'telat', 'nyasar', 'kecewa', 'kurang pas', 'salah', 'tidak pas', 'komplain'];
    if (complaintKeywords.some((kw) => lower.includes(kw))) {
      return { intent: 'complaint', confidence: 0.9 };
    }

    // 2. Deteksi Keluhan Medis / Kesehatan — single source di config/medical-keywords.ts
    const medical = checkMedicalKeywords(lower);
    if (medical.isMedical && (lower.includes('obat') || lower.includes('sakit') || lower.includes('kasih') || lower.includes('bisa') || lower.includes('?'))) {
      return { intent: 'medical_query', confidence: 0.9 };
    }

    // 3. Deteksi Pertanyaan Jadwal Spesifik
    const scheduleKeywords = ['jadwal', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'besok', 'lusa', 'bisa jam'];
    if (scheduleKeywords.some((kw) => lower.includes(kw)) && (lower.includes('?') || lower.includes('bisa'))) {
      return { intent: 'asking_schedule', confidence: 0.9 };
    }

    // 4. Deteksi FAQ / Pertanyaan Info
    const faqKeywords = ['apa', 'berapa', 'fasilitas', 'manfaat', 'harga', 'biaya', 'fungsi', 'treatment', 'facial', 'acne', 'jerawat', 'glowing', 'bagus', 'mana'];
    if (faqKeywords.some((kw) => lower.includes(kw)) && (lower.includes('?') || lower.includes('apa') || lower.includes('berapa') || lower.includes('ada'))) {
      return { intent: 'faq_question', confidence: 0.9 };
    }

    // 4b. Deteksi Klarifikasi / Anaphora Correction ("maksud saya yang paket newborn", "maksudku pijat...")
    if (/\b(maksud\s*(?:saya|ku|e|kami|sy)|bukan(?:\s+yang\s+itu)?[,\s]+(?:maksud(?:ku|saya)?\s+)?)\b/i.test(lower)) {
      return { intent: 'faq_question', confidence: 0.9 };
    }

    // 5. Deteksi TIDAK TERTARIK — prioritas TERTINGGI (dicek sebelum 'interested') karena
    //    kata ambigu ('ya','ok','mau') sering jadi substring kata lain ("kayaknya", "saya").
    //    Pola negasi eksplisit diprioritaskan agar "ga jadi aja", "kemahalan", "batal" tidak
    //    salah masuk ke interested.
    if (
      /(^|\s)(ga|gak|nggak|tidak|enggak|ndak)\s+(jadi|mau|usah|perlu)\b/i.test(lower) ||
      /\b(kemahalan|mahal|batal|gausah|ga usah|gak usah|skip|enggak jadi|tidak jadi)\b/i.test(lower) ||
      /\bnanti\s+(aja|dulu)\b/i.test(lower)
    ) {
      return { intent: 'not_interested', confidence: 0.95 };
    }

    // 6. Deteksi Tidak Tertarik — sinyal negasi umum (word-boundary, hindari substring).
    const notInterestedWord = /\b(ga|gak|nggak|tidak|enggak|batal|mahal|kemahalan|nanti|ndak|ngg)\b/i;
    if (notInterestedWord.test(lower)) {
      return { intent: 'not_interested', confidence: 0.9 };
    }

    // 7. Deteksi Tertarik — word-boundary (hindari "ya" dalam "kayaknya/saya").
    const interestedWord = /\b(iya+|iyaa+|ya|bener|betul|setuju|sip|gpp|oke|ok|mau|tertarik|boleh|yes|booking|daftar|kirim\s+list)\b/i;
    if (interestedWord.test(lower)) {
      return { intent: 'interested', confidence: 0.95 };
    }

    return { intent: 'other', confidence: 0.5 };
  }
}

export const llmIntentService = new LLMIntentService();

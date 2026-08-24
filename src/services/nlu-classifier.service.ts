import { AiModelConfigService } from '../config/ai-models.config';
import { getBrandIdentity } from '../config/brand';
import { checkMedicalKeywords } from '../config/medical-keywords';
import { LLM_HISTORY_LIMIT } from '../config/llm-context';
import { SERVICE_AREAS_ALTERNATION } from '../config/service-areas';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { parsePositiveInt } from '../utils/env-numeric';
import { extractBalancedJson, extractJsonContent } from '../utils/json-extract';
import { CircuitBreaker } from '../utils/circuit-breaker';

export interface NluEntities {
  location_text?: string;
  treatment_name?: string;
  preferred_date?: string;
  preferred_time?: string;
  [key: string]: any;
}

export interface NluClassificationResult {
  intents: string[];
  entities: NluEntities;
  confidence: number;
  rawText: string;
  isFallback: boolean;
}

/** Konteks audit opsional agar LLM call NLU tercatat dengan atribusi (conversation_id & nomor customer). */
export interface NluAuditContext {
  conversationId?: string | null;
  customerPhone?: string;
}

export const VALID_INTENTS = [
  'greeting',
  'provide_location',
  'ask_price',
  'ask_schedule',
  'express_interest',
  'faq_question',
  'affirmation',
  'negation',
  'complaint',
  'medical_query',
  'off_topic',
] as const;

export type ValidIntentType = typeof VALID_INTENTS[number];

export class NluClassifierService {
  /**
   * Circuit breaker untuk NLU LLM: saat SumoPod down, breker tripp -> fallback regex ~instan
   * (mencegah tiap pesan menunggu timeout penuh 15s). Pattern sama seperti generator/phrasing.
   */
  private static llmBreaker: CircuitBreaker<
    [string, Array<{ role: 'user' | 'assistant'; content: string }>, NluAuditContext?],
    NluClassificationResult
  > | null = null;

  private static getBreaker(): CircuitBreaker<
    [string, Array<{ role: 'user' | 'assistant'; content: string }>, NluAuditContext?],
    NluClassificationResult
  > {
    if (!this.llmBreaker) {
      this.llmBreaker = new CircuitBreaker(
        async (text, history, auditCtx) => this.classifyWithLLM(text, history, auditCtx),
        async (text) => this.fallbackClassify(text),
        { name: 'LLM NLU Classifier', failureThreshold: 0.7, slidingWindowSize: 20, cooldownPeriodMs: 60000 }
      );
    }
    return this.llmBreaker;
  }

  /**
   * Bersihkan JSON LLM: strip code fence (```json ... ```), lalu ambil blok {...} pertama.
   * Dipakai sebelum JSON.parse agar model yang membungkus JSON dengan teks/fence tidak gagal.
   * Implementasi bersama di src/utils/json-extract.ts — juga menangani JSON terpotong.
   */
  private static sanitizeJson(raw: string): string {
    const extracted = extractJsonContent(raw, ['intents']);
    if (extracted) return extracted;
    let clean = (raw || '').trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
    }
    const braceStart = clean.indexOf('{');
    const braceEnd = clean.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      clean = clean.slice(braceStart, braceEnd + 1).trim();
    }
    return clean;
  }

  /**
   * Deterministic Fallback Classifier (Regex & Keyword Matcher)
   * Triggered when LLM call fails, times out, or when LLM API Key is unavailable.
   */
  public static fallbackClassify(incomingText: string): NluClassificationResult {
    if (!incomingText || typeof incomingText !== 'string') {
      return {
        intents: ['off_topic'],
        entities: {},
        confidence: 1.0,
        rawText: incomingText || '',
        isFallback: true,
      };
    }

    const text = incomingText.trim().toLowerCase();
    const intents: string[] = [];
    const entities: NluEntities = {};

    // 1. Greeting
    if (/^(halo|hi|pagi|siang|sore|malam|p|assalamu['`]?alaikum|haloo+|hai)\b/i.test(text)) {
      intents.push('greeting');
    }

    // 2. Affirmation
    if (/^(ya|iya|betul|bisa|ok|okay|siap|baik|setuju|bisa bunda|iyaa+|yup|yes|sip|boleh)\b/i.test(text)) {
      intents.push('affirmation');
    }

    // 3. Negation (Context-Aware Guard)
    // ONLY true negation (refusal/cancellation/declining/correction).
    // NOT baby behavior ("ga bisa diem") or preference ("bukan yang pulih ceria").
    const isSituationalDescription = /\b(ga|gak|nggak|tidak|enggak)\s+(bisa\s+diem|bisa\s+diam|mau\s+tidur|panas|demam|ada\s+keluhan|rewel|bisa\s+anteng)\b/i.test(text);
    const isPreferenceCorrection = /\b(bukan\s+yang|tidak\s+usah\s+yang|gak\s+usah\s+yang|maksud(?:nya|ku|saya)?\s+bukan)\b/i.test(text);
    const startsWithNegation = /^(tidak|enggak|nggak|bukan|batal|ga|gak|ndak)\b/i.test(text);
    const hasExplicitCancelOrCorrection = /\b(batal|cancel|ga\s+jadi|gak\s+jadi|nggak\s+jadi|tidak\s+jadi|enggak\s+jadi|tidak\s+mau|enggak\s+mau|ga\s+mau|gak\s+mau|kemahalan|skip|salah|salah\s+alamat)\b/i.test(text);

    if ((startsWithNegation || hasExplicitCancelOrCorrection) && !isSituationalDescription && !isPreferenceCorrection) {
      intents.push('negation');
    }

    // 3b. Medical Query vs Treatment Inquiry
    // Keluhan medis / gejala ringan yang menanyakan ketersediaan treatment (misal: "batuk pilek ada treatment?")
    // adalah FAQ / treatment inquiry (Pulih Ceria / Moksa), BUKAN emergency medical_query.
    const medical = checkMedicalKeywords(text);
    const hasNanahOrInfection = /\b(nanah|bernanah|infeksi|luka\s+terbuka|kejang|step)\b/i.test(text);
    const isAskingMedicineOrEmergency = text.includes('obat') || text.includes('resep') || text.includes('dikasih apa') || text.includes('sembuh pakai apa') || hasNanahOrInfection || medical.severity === 'HIGH';
    const isSeekingTreatment = /\b(treatment|perawatan|pijat|massage|spa|terapi|paket|ada\s+treatment|bisa\s+di\s*pijat|boleh\s+di\s*pijat|cocok|layanan)\b/i.test(text);
    const hasMedicalSignal = text.includes('sakit') || text.includes('kasih') || text.includes('bisa') || text.includes('?') || text.includes('normal') || text.includes('wajar') || text.includes('bahaya') || hasNanahOrInfection;

    if (medical.isMedical || isAskingMedicineOrEmergency || hasNanahOrInfection) {
      if (isSeekingTreatment && !isAskingMedicineOrEmergency) {
        if (!intents.includes('faq_question')) {
          intents.push('faq_question');
        }
      } else if (isAskingMedicineOrEmergency || hasMedicalSignal) {
        intents.push('medical_query');
      }
    }

    // 4. Provide Location
    if (new RegExp(`(\\bdi\\b|\\bdaerah\\b|\\bdekat\\b|\\bkecamatan\\b|\\bkelurahan\\b|\\balamat\\b|\\bjl\\b|\\bjalan\\b|\\b(${SERVICE_AREAS_ALTERNATION})\\b)`, 'i').test(text)) {
      intents.push('provide_location');
      // Extract rough location text entity (clean filler words like "saya di")
      entities.location_text = incomingText.replace(/^(saya\s+)?(di|ke|alamat\s+saya\s+di|rumah\s+saya\s+di)\s+/i, '').trim();
    }

    // 5. Ask Price
    // HARDENING anti-salah-rute:
    // (a) "berapa lama", "berapa kali", "berapa jam", "berapa orang" BUKAN tanya harga melainkan durasi/frekuensi FAQ.
    // (b) "usia berapa", "minimal berapa" BUKAN tanya harga melainkan kelayakan usia FAQ.
    // (c) Pertanyaan inklusivitas ongkir ("brrti blm termasuk ongkir ya") BUKAN tanya harga melainkan FAQ kebijakan.
    const hasPriceWord = /\b(harga(nya)?|tarif(nya)?|ongkir(nya)?|biaya(nya)?|ongkos(nya)?|pricelists?|promos?|rp\s*\d)\b/i.test(text);
    const hasBerapa = /\b(berapa|brp)\b/i.test(text);
    const hasAgeContext = /\b(usia|umur|umurnya|minimal|minimum|minimalnya|min\b|berat|tinggi)\b/i.test(text);
    const hasDurationOrFrequency = /\b(lama|durasi|menit|jam|kali|sesi|frekuensi|jarak|km|orang|anak)\b/i.test(text);
    const isOngkirInclusionPolicy = /\b(termasuk|include|sudah\s+sama|udah\s+sama|sama\s+ongkir|ongkir\s+terpisah|ongkir\s+lagi)\b/i.test(text);

    const isAskPriceText =
      !isOngkirInclusionPolicy &&
      ((hasPriceWord && !/(\bberapa\s+(lama|kali|jam|menit|jarak|orang)\b)/i.test(text)) ||
       (hasBerapa && !hasAgeContext && !hasDurationOrFrequency) ||
       /\b\d+\s*(rb|ribu)\b/i.test(text) ||
       (/\b\d+\s*k\b/i.test(text) && hasPriceWord));

    if (isAskPriceText) {
      intents.push('ask_price');
    }

    // 6. Ask Schedule
    // Memerlukan indikator penjadwalan/hari spesifik agar "sehari 2 kali" atau "durasi 1 jam" tidak salah rute.
    const isScheduleIntent =
      /\b(kapan|jadwal|slot|operasional|buka\s+jam|tutup\s+jam|jam\s+buka|hari\s+apa|ada\s+jadwal|bisa\s+(hari|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|pagi|siang|sore|malam))\b/i.test(text) ||
      (/\b(besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/i.test(text) && /\b(bisa|ada|booking|slot|jam|\?)\b/i.test(text)) ||
      (/\b(jam|pukul)\s*\d+/i.test(text) && /\b(bisa|ada|booking|slot|\?)\b/i.test(text));

    if (isScheduleIntent) {
      intents.push('ask_schedule');
    }

    // 7. FAQ Question (Inquiry / Questions / Clinic Location / Duration / Policy)
    const isQuestion = /(\bapakah\b|\bsiapa\b|\bapa\b|\bkenapa\b|\bbagaimana\b|\bgimana\b|\bmanfaat\b|\baman\b|\busia\b|\bboleh\b|\bbayar\b|\bbidan\b|\bperawat\b|\bdarimana\b|\bdimana\b|\bdi\s+mana\b|\bdari\s+mana\b|\bmana\b|\?)/i.test(text) ||
      hasDurationOrFrequency ||
      isOngkirInclusionPolicy ||
      /\b(kakak|kakaknya|mbak|mbaknya|bidan|bubid|klinik)\s+(dari\s*mana|darimana|dimana|di\s+mana)\b/i.test(text);
    if (isQuestion && !intents.includes('faq_question')) {
      intents.push('faq_question');
    }

    // 7b. Clarification / Anaphora Correction ("maksud saya yang paket newborn", "maksudku pijat laktasi")
    const clarificationMatch = text.match(/\b(?:maksud\s*(?:saya|ku|e|kami|sy)|bukan(?:\s+yang\s+itu)?[,\s]+(?:maksud(?:ku|saya)?\s+)?)\s*(?:yang\s+)?(?:paket\s+)?([a-z0-9\s\-+]+)/i);
    if (clarificationMatch) {
      if (!intents.includes('faq_question')) {
        intents.push('faq_question');
      }
      const rawTarget = clarificationMatch[1].trim();
      if (rawTarget.length >= 3) {
        entities.treatment_name = rawTarget;
      }
    }

    // 8. Express Interest / Reservation (Must not be pure inquiry like "mau tanya" or "pesan wa")
    const isMauTanya = /\bmau\s+(tanya|nanya|konsultasi|tau|tahu|cek)\b/i.test(text);
    const isPesanWa = /\bpesan\s+(ini|wa|terakhir|sebelumnya)\b/i.test(text);
    if (!isMauTanya && !isPesanWa) {
      if (/\b(booking|daftar|reservasi|pesan\s+slot|mau\s+ambil|mau\s+coba|mau\s+treatment|mau\s+pijat|mau\s+pesan|ambil\s+paket)\b/i.test(text) || 
          (!isQuestion && /\b(treatment|paket)\b/i.test(text) && /\bmau\b/i.test(text))) {
        intents.push('express_interest');
      }
    }

    // 9. Complaint (Must express real dissatisfaction / frustration)
    if (/\b(kapok|jelek|buruk|kecewa|mengecewakan|parah|komplain|pelayanan\s+buruk|lama\s+banget\s+balas|lambat\s+banget|admin(nya)?\s+mana|kok\s+([a-z0-9]+\s+)?belum\s+(sampai|datang)|nyasar|miring|tidak\s+profesional|gak\s+profesional)\b/i.test(text)) {
      intents.push('complaint');
    }

    if (intents.length === 0) {
      intents.push('off_topic');
    }

    return {
      intents,
      entities,
      confidence: 0.75,
      rawText: incomingText,
      isFallback: true,
    };
  }

  /**
   * Main LLM Structured NLU Classifier
   * Converts natural customer utterances into structured { intents, entities, confidence } JSON.
   * `auditCtx` (opsional) membawa conversation_id & customer_phone agar LLM call
   * tercatat di llm_audit_logs bisa diatribusikan ke bubble chat yang sesuai.
   */
  public static async classifyMessage(
    incomingText: string,
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    auditCtx?: NluAuditContext
  ): Promise<NluClassificationResult> {
    const endpointCheck = getLlmEndpointConfig({ modelConfigKey: 'INTENT_CLASSIFICATION' });
    const apiKey = endpointCheck.apiKey || '';

    // Offline / Mock check
    if (!apiKey || apiKey.startsWith('mock') || process.env.NODE_ENV === 'test') {
      const fallbackResult = this.fallbackClassify(incomingText);
      console.log(`[NLU CLASSIFICATION] (OFFLINE FALLBACK)`, {
        text: incomingText,
        intents: fallbackResult.intents,
        confidence: fallbackResult.confidence,
        isFallback: true,
      });
      return fallbackResult;
    }

    // Circuit breaker: saat LLM down/tripp, regex fallback dijalankan ~instan (hindari menunggu timeout).
    return this.getBreaker().execute(incomingText, historyMessages, auditCtx);
  }

  /**
   * Jalankan klasifikasi LLM (primary + fallback model via helper) lalu parse JSON.
   * Melempar error saat gagal agar CircuitBreaker menjatuhkan ke regex fallback.
   */
  private static async classifyWithLLM(
    incomingText: string,
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    auditCtx?: NluAuditContext
  ): Promise<NluClassificationResult> {
    const config = AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION');
    const confidenceThreshold = config.confidenceThreshold || 0.60;
    const endpoint = getLlmEndpointConfig({ modelConfigKey: 'INTENT_CLASSIFICATION' });
    const baseUrl = endpoint.baseUrl;
    const apiKey = endpoint.apiKey;

      const systemPrompt = `You are a Structured NLU (Natural Language Understanding) Classifier for ${getBrandIdentity().businessName} WhatsApp Chatbot.
Your task is to analyze customer messages and return ONLY a JSON object representing the customer's intent(s) and extracted entity data.

ALLOWED INTENTS (A single message MAY contain multiple intents!):
- "greeting": Friendly greetings (e.g., "Halo", "Selamat pagi", "P", "Assalamualaikum").
- "provide_location": Customer shares their location, address, area, or landmark (e.g., "Saya di Rungkut", "Dekat Indomaret Sidoklumpuk"). CRITICAL: If they ask a price and mention a location together (e.g., "ke rungkut kidul berapa ya"), you MUST include BOTH "provide_location" and "ask_price", and extract "location_text".
- "ask_price": Inquiring about service prices, packages, promo rates, or delivery fees (e.g., "Pijat bayi berapa ya?", "Ongkir ke waru berapa?"). NOTE: Questions about session duration/frequency ("Berapa lama pijatnya?", "Berapa kali seminggu?") or age eligibility ("Usia berapa boleh?") are "faq_question", NOT "ask_price".
- "ask_schedule": Inquiring about clinic operating hours, available slots, booking appointment dates/times (e.g. "Bisa besok jam 10?", "Buka hari apa saja?"). NOTE: Questions about session duration ("Berapa jam durasinya?") are "faq_question", NOT "ask_schedule".
- "express_interest": Customer wants to book, make a reservation, or try a treatment (e.g. "Mau booking", "Mau coba paket newborn", "Daftar sekarang"). NOTE: "Mau tanya" is an inquiry ("faq_question"), NOT "express_interest".
- "faq_question": General clinical/service question, duration, frequency, payment methods, delivery fee inclusion policies, therapist credentials, OR asking about therapy/treatments for common mild baby symptoms like cough/flu/colic/bloating (e.g., "Boleh untuk usia 2 bulan?", "Manfaat flu bath apa?", "Anak saya batuk pilek ada treatment?", "Brrti blm termasuk ongkir ya?").
- "affirmation": Affirmation or agreement ("Iya", "Betul", "Bisa", "Oke", "Boleh").
- "negation": ONLY for refusal, rejection, cancellation, or declining an offer ("Tidak mau", "Ga jadi", "Batal", "Kemahalan", "Enggak dulu"). DO NOT mark as negation if customer is describing baby behavior ("anak saya ga bisa diem") or clarifying a preference ("bukan yang pulih ceria, mau yang biasa").
- "complaint": Customer expressing genuine frustration, slow response, or service complaint (e.g. "pelayanan buruk", "kapok", "kecewa", "admin lama balasnya").
- "medical_query": Customer reporting severe emergencies, asking for medicine prescriptions/dosage, or asking medical diagnostic questions (e.g., "anak saya demam 40 derajat dikasih obat apa", "tali pusar keluar nanah berbau", "jahitan melahirkan berdarah").
- "off_topic": Unrelated or gibberish chatter.

EXTRACTED ENTITIES (If mentioned):
- "location_text": Raw address/landmark text mentioned by customer.
- "treatment_name": Name of treatment mentioned (e.g., "Pijat Bayi", "Nebulizer", "Mom SPA").
- "preferred_date": Date or day mentioned (e.g., "Besok", "Sabtu").
- "preferred_time": Time mentioned (e.g., "Jam 10 pagi").

OUTPUT JSON SCHEMA ONLY:
{
  "intents": ["intent1", "intent2"],
  "entities": {
    "location_text": "string or omit",
    "treatment_name": "string or omit"
  },
  "confidence": 0.0 to 1.0
}

You MUST end your response with this complete JSON block (values may be null/omitted as appropriate), even if you performed internal reasoning first.`;

      // Build context messages from history (up to LLM_HISTORY_LIMIT messages)
      const contextMsgs = historyMessages.slice(-LLM_HISTORY_LIMIT).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

      const messagesPayload = [
        { role: 'system', content: systemPrompt },
        ...contextMsgs,
        { role: 'user', content: `[Utterance to classify]: "${incomingText}"` },
      ];

      // A/B toggle window campaign (eval): pilih model primary tanpa ubah DB config.
      // 'minimax' → MiniMax-M2.7-highspeed, 'deepseek-sumopod' → deepseek-v4-flash via SumoPod.
      // Di luar mode eval (env kosong) → pakai config DB/registry apa adanya.
      const evalPrimary = process.env.NLU_PRIMARY_MODEL;
      const evalRun = process.env.NLU_EVAL_RUN || null;
      const primaryModel =
        evalPrimary === 'minimax'
          ? 'MiniMax-M2.7-highspeed'
          : evalPrimary === 'deepseek-sumopod'
            ? 'deepseek-v4-flash'
            : config.modelName;
      if (evalRun && evalPrimary) {
        console.log(`[NLU EVAL] run="${evalRun}" primary="${primaryModel}" (override dari config "${config.modelName}")`);
      }

      const startedAt = Date.now();
      let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
      try {
        callResult = await callChatCompletionsWithFallback({
          baseUrl,
          apiKey,
          model: primaryModel,
          fallbackModel: endpoint.fallbackModel,
          timeoutMs: parsePositiveInt(process.env.LLM_TIMEOUT_NLU_MS, 120000),
          isContentValid: (content) => {
            try {
              JSON.parse(this.sanitizeJson(content));
              return true;
            } catch {
              return false;
            }
          },
          payload: {
            temperature: config.temperature,
            max_tokens: Math.max(config.maxTokens || 1500, 1500),
            response_format: { type: 'json_object' },
            messages: messagesPayload,
          },
        });
      } catch (err: any) {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: auditCtx?.customerPhone || 'nlu-audit',
          conversation_id: auditCtx?.conversationId ?? null,
          task_type: 'NLU_CLASSIFICATION',
          model_name: primaryModel,
          baseUrl,
          startedAt,
          error: err,
          eval_run: evalRun,
        });
        throw err;
      }

      const responseData = callResult.data;

      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: auditCtx?.customerPhone || 'nlu-audit',
          conversation_id: auditCtx?.conversationId ?? null,
          task_type: 'NLU_CLASSIFICATION',
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: responseData?.usage,
          eval_run: evalRun,
        });
      } catch {
        // Fire-and-forget
      }

      let rawContent = responseData?.choices?.[0]?.message?.content?.trim();
      const reasoning = responseData?.choices?.[0]?.message?.reasoning_content || '';

      if (reasoning) {
        console.log(`\n[LLM REASONING (NLU)]:\n${reasoning}\n`);
      }

      // Handle DeepSeek reasoning models where content is empty and JSON is in reasoning_content
      if (!rawContent && reasoning) {
        const jsonMatch = extractJsonContent(reasoning, ['intents']);
        if (jsonMatch) {
          rawContent = jsonMatch;
          console.log(`[NLU CLASSIFICATION] Extracted JSON from reasoning_content`);
        }
      }

      if (!rawContent) {
        throw new Error(`Empty response content from LLM. Reasoning was: ${reasoning ? 'Present' : 'Empty'}`);
      }

      // Sanitize: strip code fence & ambil blok {...} pertama (agar model yang membungkus JSON tidak gagal parse)
      const parsed = JSON.parse(this.sanitizeJson(rawContent));
      const intents: string[] = Array.isArray(parsed.intents)
        ? parsed.intents.filter((i: string) => VALID_INTENTS.includes(i as any))
        : [];
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
      const entities: NluEntities = typeof parsed.entities === 'object' && parsed.entities ? parsed.entities : {};

      // Check confidence threshold
      if (confidence < confidenceThreshold || intents.length === 0) {
        console.warn(
          `[NLU CLASSIFICATION] Low confidence (${confidence} < ${confidenceThreshold}) for text: "${incomingText}". Fallback triggered.`
        );
        const fallbackRes = this.fallbackClassify(incomingText);
        return {
          ...fallbackRes,
          confidence,
        };
      }

      const result: NluClassificationResult = {
        intents,
        entities,
        confidence,
        rawText: incomingText,
        isFallback: false,
      };

      console.log('[NLU CLASSIFICATION]', {
        text: incomingText,
        intents: result.intents,
        entities: result.entities,
        confidence: result.confidence,
        isFallback: false,
      });

      return result;
  }
}

export const nluClassifierService = new NluClassifierService();

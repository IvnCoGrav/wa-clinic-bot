import { AiModelConfigService } from '../config/ai-models.config';
import { getBrandIdentity } from '../config/brand';
import { LLM_HISTORY_LIMIT } from '../config/llm-context';
import { SERVICE_AREAS_ALTERNATION } from '../config/service-areas';
import { callChatCompletionsWithFallback, getFallbackModel } from '../integrations/llm/model-fallback';
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
  private static llmBreaker: CircuitBreaker<[string, Array<{ role: 'user' | 'assistant'; content: string }>], NluClassificationResult> | null = null;

  private static getBreaker(): CircuitBreaker<[string, Array<{ role: 'user' | 'assistant'; content: string }>], NluClassificationResult> {
    if (!this.llmBreaker) {
      this.llmBreaker = new CircuitBreaker(
        async (text, history) => this.classifyWithLLM(text, history),
        async (text) => this.fallbackClassify(text),
        { name: 'LLM NLU Classifier', failureThreshold: 0.7, slidingWindowSize: 20, cooldownPeriodMs: 60000 }
      );
    }
    return this.llmBreaker;
  }

  /**
   * Bersihkan JSON LLM: strip code fence (```json ... ```), lalu ambil blok {...} pertama.
   * Dipakai sebelum JSON.parse agar model yang membungkus JSON dengan teks/fence tidak gagal.
   */
  private static sanitizeJson(raw: string): string {
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
    if (/^(halo|hi|pagi|siang|sore|malam|p|assalamu['`]?alaikum|haloo+)/i.test(text)) {
      intents.push('greeting');
    }

    // 2. Affirmation
    if (/^(ya|iya|betul|bisa|ok|okay|siap|baik|setuju|bisa bunda|iyaa+)/i.test(text)) {
      intents.push('affirmation');
    }

    // 3. Negation
    if (/^(tidak|enggak|nggak|bukan|batal|ga|gak|ndak)/i.test(text)) {
      intents.push('negation');
    }

    // 3b. Medical Query — keluhan medis / gejala / minta obat (fallback deterministik).
    // Gate konservatif (mirip intent.ts): keyword gejala ADA && ada sinyal pertanyaan/tindakan.
    const medicalKeywords = [
      'demam', 'panas', 'kejang', 'paracetamol', 'obat', 'sakit', 'nyeri', 'perih',
      'sesak', 'grok', 'lendir', 'dahak', 'bengkak', 'batuk', 'diare', 'mencret',
      'muntah', 'ruam', 'tali pusat', 'tali pusar', 'pusar', 'jahitan', 'ngilu',
      'payudara', 'mastitis',
    ];
    const hasMedicalKeyword = medicalKeywords.some((kw) => text.includes(kw));
    const hasMedicalSignal = text.includes('obat') || text.includes('sakit') || text.includes('kasih') || text.includes('bisa') || text.includes('?') || text.includes('normal') || text.includes('wajar') || text.includes('bahaya');
    if (hasMedicalKeyword && hasMedicalSignal) {
      intents.push('medical_query');
    }

    // 4. Provide Location
    if (new RegExp(`(\\bdi\\b|\\bdaerah\\b|\\bdekat\\b|\\bkecamatan\\b|\\bkelurahan\\b|\\balamat\\b|\\bjl\\b|\\bjalan\\b|\\b(${SERVICE_AREAS_ALTERNATION})\\b)`, 'i').test(text)) {
      intents.push('provide_location');
      // Extract rough location text entity (clean filler words like "saya di")
      entities.location_text = incomingText.replace(/^(saya\s+)?(di|ke|alamat\s+saya\s+di|rumah\s+saya\s+di)\s+/i, '').trim();
    }

    // 5. Ask Price
    if (/(\bberapa\b|\bharga(nya)?\b|\btarif(nya)?\b|\bongkir(nya)?\b|\bbiaya(nya)?\b|\bongkos(nya)?\b|\bpricelists?\b|\bpromos?\b|\b\d+\s*(rb|k|ribu)\b)/i.test(text)) {
      intents.push('ask_price');
    }

    // 6. Ask Schedule
    if (/(\bjam\b|\bbuka\b|\bjadwal\b|\bslot\b|\bhari\b|\btanggal\b|\boperasional\b)/i.test(text)) {
      intents.push('ask_schedule');
    }

    // 7. FAQ Question (Inquiry / Questions)
    const isQuestion = /(\bapakah\b|\bsiapa\b|\bapa\b|\bkenapa\b|\bbagaimana\b|\bmanfaat\b|\baman\b|\busia\b|\bboleh\b|\bbayar\b|\bbidan\b|\bperawat\b|\?)/i.test(text);
    if (isQuestion) {
      intents.push('faq_question');
    }

    // 8. Express Interest / Reservation (Must not be a pure question like "apakah...")
    if (/(\bbooking\b|\bdaftar\b|\bpesan\b|\bmau\b|\bmohon\b|\breservasi\b)/i.test(text) || (!isQuestion && /\btreatment\b/i.test(text))) {
      intents.push('express_interest');
    }

    // 9. Complaint
    if (/(\blama\b|\bjelek\b|\bkapok\b|\bkomplain\b|\bsalah\b|\bcepat\b|\bbad\b)/i.test(text)) {
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
   */
  public static async classifyMessage(
    incomingText: string,
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<NluClassificationResult> {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';

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
    return this.getBreaker().execute(incomingText, historyMessages);
  }

  /**
   * Jalankan klasifikasi LLM (primary + fallback model via helper) lalu parse JSON.
   * Melempar error saat gagal agar CircuitBreaker menjatuhkan ke regex fallback.
   */
  private static async classifyWithLLM(
    incomingText: string,
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<NluClassificationResult> {
    const config = AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION');
    const confidenceThreshold = config.confidenceThreshold || 0.60;
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';

      const systemPrompt = `You are a Structured NLU (Natural Language Understanding) Classifier for ${getBrandIdentity().businessName} WhatsApp Chatbot.
Your task is to analyze customer messages and return ONLY a JSON object representing the customer's intent(s) and extracted entity data.

ALLOWED INTENTS (A single message MAY contain multiple intents!):
- "greeting": Friendly greetings (e.g., "Halo", "Selamat pagi", "P", "Assalamualaikum").
- "provide_location": Customer shares their location, address, area, or landmark (e.g., "Saya di Rungkut", "Dekat Indomaret Sidoklumpuk").
- "ask_price": Inquiring about service prices, packages, promo rates, or delivery fees (e.g., "Pijat bayi berapa ya?", "Ongkir ke waru berapa?").
- "ask_schedule": Inquiring about clinic operating hours, available slots, or appointment dates.
- "express_interest": Customer wants to book, make a reservation, or try a treatment.
- "faq_question": General clinical/service question (e.g., "Boleh untuk usia 2 bulan?", "Manfaat flu bath apa?").
- "affirmation": Affirmation or agreement ("Iya", "Betul", "Bisa", "Oke", "Boleh").
- "negation": Refusal or cancellation ("Tidak", "Bukan itu", "Batal").
- "complaint": Customer expressing frustration, slow response, or service complaint.
- "medical_query": Customer reporting a health/medical concern, describing a symptom, or asking for medicine/dosage/medical advice (e.g., "anak saya demam dikasih apa ya", "tali pusar kok bau", "jahitan melahirkan perih", "minta rekomendasi obat batuk"). Escalate, do NOT answer with medical advice.
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
}`;

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

      const { data: responseData } = await callChatCompletionsWithFallback({
        baseUrl,
        apiKey,
        model: config.modelName,
        fallbackModel: getFallbackModel(),
        timeoutMs: Number(process.env.LLM_TIMEOUT_NLU_MS || 15000),
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
          max_tokens: config.maxTokens,
          response_format: { type: 'json_object' },
          messages: messagesPayload,
        },
      });

      let rawContent = responseData?.choices?.[0]?.message?.content?.trim();

      // Handle DeepSeek reasoning models where content is empty and JSON is in reasoning_content
      if (!rawContent) {
        const reasoning = responseData?.choices?.[0]?.message?.reasoning_content || '';
        const jsonMatch = reasoning.match(/\{[\s\S]*?"intents"[\s\S]*?\}/);
        if (jsonMatch) {
          rawContent = jsonMatch[0];
          console.log(`[NLU CLASSIFICATION] Extracted JSON from reasoning_content`);
        }
      }

      if (!rawContent) {
        throw new Error('Empty response content from LLM');
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

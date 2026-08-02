import axios from 'axios';
import { AiModelConfigService } from '../config/ai-models.config';
import { getBrandIdentity } from '../config/brand';
import { LLM_HISTORY_LIMIT } from '../config/llm-context';
import { SERVICE_AREAS_ALTERNATION } from '../config/service-areas';

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
  'off_topic',
] as const;

export type ValidIntentType = typeof VALID_INTENTS[number];

export class NluClassifierService {
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

    // 4. Provide Location
    if (new RegExp(`(\\bdi\\b|\\bdaerah\\b|\\bdekat\\b|\\bkecamatan\\b|\\bkelurahan\\b|\\balamat\\b|\\bjl\\b|\\bjalan\\b|\\b(${SERVICE_AREAS_ALTERNATION})\\b)`, 'i').test(text)) {
      intents.push('provide_location');
      // Extract rough location text entity (clean filler words like "saya di")
      entities.location_text = incomingText.replace(/^(saya\s+)?(di|ke|alamat\s+saya\s+di|rumah\s+saya\s+di)\s+/i, '').trim();
    }

    // 5. Ask Price
    if (/(\bberapa\b|\bharga\b|\btarif\b|\bongkir\b|\bbiaya\b|\bpricelists?\b|\bpromos?\b)/i.test(text)) {
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
    const config = AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION');
    const confidenceThreshold = config.confidenceThreshold || 0.60;

    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

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

    try {
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

      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: config.modelName,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          response_format: { type: 'json_object' },
          messages: messagesPayload,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10s timeout guard
        }
      );

      let rawContent = response.data?.choices?.[0]?.message?.content?.trim();
      
      // Handle DeepSeek reasoning models where content is empty and JSON is in reasoning_content
      if (!rawContent) {
        const reasoning = response.data?.choices?.[0]?.message?.reasoning_content || '';
        const jsonMatch = reasoning.match(/\{[\s\S]*?"intents"[\s\S]*?\}/);
        if (jsonMatch) {
          rawContent = jsonMatch[0];
          console.log(`[NLU CLASSIFICATION] Extracted JSON from reasoning_content`);
        }
      }

      if (!rawContent) {
        throw new Error('Empty response content from LLM');
      }

      const parsed = JSON.parse(rawContent);
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
    } catch (err: any) {
      console.warn(
        `[NLU CLASSIFICATION ERROR] LLM classification failed (${err.message}). Executing deterministic regex fallback.`
      );
      const fallbackRes = this.fallbackClassify(incomingText);
      console.log('[NLU CLASSIFICATION] (ERROR FALLBACK)', {
        text: incomingText,
        intents: fallbackRes.intents,
        confidence: fallbackRes.confidence,
        isFallback: true,
      });
      return fallbackRes;
    }
  }
}

export const nluClassifierService = new NluClassifierService();

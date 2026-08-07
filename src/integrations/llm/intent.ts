import { BOT_PERSONA_PROMPT } from '../../config/persona';
import { getBrandIdentity } from '../../config/brand';
import { llmOutageStorage } from './context';
import { callChatCompletionsWithFallback, getFallbackModel } from './model-fallback';
import dotenv from 'dotenv';
dotenv.config();

export type IntentType = 'interested' | 'not_interested' | 'asking_schedule' | 'faq_question' | 'medical_query' | 'complaint' | 'other';

export interface IntentDetectionResult {
  intent: IntentType;
  confidence: number;
}

/**
 * Service untuk deteksi intent respons pengguna berbasis LLM terstruktur JSON (5 Intent).
 */
export class LLMIntentService {
  private get apiKey(): string {
    return process.env.LLM_API_KEY || '';
  }
  private get baseUrl(): string {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  }
  private get model(): string {
    return process.env.OPENAI_MODEL || 'MiniMax-M2.7-highspeed';
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
  public async detectIntent(userMessageText: string): Promise<IntentDetectionResult> {
    const store = llmOutageStorage.getStore();
    if (store?.simulateOutage) {
      throw new Error('SumoPod connection timeout (500 Internal Server Error)');
    }

    if (!this.apiKey || this.apiKey.startsWith('mock')) {
      return this.ruleBasedFallbackIntent(userMessageText);
    }

    try {
      console.time('LLM_INTENT_API_CALL');
      const { data: responseData } = await callChatCompletionsWithFallback({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        model: this.model,
        fallbackModel: getFallbackModel(),
        timeoutMs: Number(process.env.LLM_TIMEOUT_CHAT_MS || 15000),
        payload: {
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
               content: `${BOT_PERSONA_PROMPT}
 
Anda adalah Intent Classifier untuk percakapan WhatsApp ${getBrandIdentity().businessName}.
Klasifikasikan pesan pengguna ke salah satu dari 5 intent berikut dalam format JSON strictly {"intent": "interested" | "not_interested" | "asking_schedule" | "faq_question" | "other"}:
 
- "faq_question": Jika pengguna menanyakan informasi umum/FAQ moms & baby spa, seperti manfaat treatment, jenis perawatan, harga, durasi, atau pertanyaan seputar pijat dan treatment (contoh: "pijat bayi itu buat apa?", "ada pijat ibu hamil ga?", "berapa harga treatmentnya?", "pijat bayi boleh dari umur berapa?").
- "asking_schedule": Jika pengguna menanyakan ketersediaan hari/jam/jadwal spesifik (contoh: "apakah hari Senin bisa?", "bisa booking besok jam 3 sore?").
- "medical_query": Jika pengguna menanyakan keluhan medis, masalah kesehatan bayi/ibu, dosis obat, atau saran medis (contoh: "anak saya demam dikasih apa ya", "ada obat batuk bayi?", "bekas jahitan melahirkan perih").
- "complaint": Jika pengguna mengeluhkan layanan, komplain, kecewa, atau kesalahan (contoh: "tindik telinganya miring", "kok bidannya belum sampai", "nyasar ya mbak").
- "interested": Jika pengguna menyatakan mau, berminat, setuju, atau ingin kirim list reservasi (contoh: "mau dong", "kirim format booking", "setuju", "boleh").
- "not_interested": Jika pengguna menolak, batal, atau keberatan (contoh: "ga jadi", "batal", "nanti saja").
- "other": Kategori lainnya.`,
            },
            {
              role: 'user',
              content: userMessageText,
            },
          ],
        },
      });
      console.timeEnd('LLM_INTENT_API_CALL');

      const content = responseData.choices[0].message.content;
      
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(json)?\n?/, '');
        cleanContent = cleanContent.replace(/\n?```$/, '');
      }
      cleanContent = cleanContent.trim();
      
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

    // 2. Deteksi Keluhan Medis / Kesehatan
    const medicalKeywords = ['demam', 'panas', 'kejang', 'paracetamol', 'obat', 'sakit', 'nyeri', 'perih', 'sesak', 'grok', 'lendir', 'dahak'];
    if (medicalKeywords.some((kw) => lower.includes(kw)) && (lower.includes('obat') || lower.includes('sakit') || lower.includes('kasih') || lower.includes('bisa') || lower.includes('?'))) {
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

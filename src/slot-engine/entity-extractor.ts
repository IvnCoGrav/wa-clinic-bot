import { z } from 'zod';
import { ExtractedEntities } from './types';
import { parseAgeTextToMonths } from '../utils/age-calculator';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../config/ai-models.config';
import { extractJsonContent } from '../utils/json-extract';
import { DEFAULT_TENANT_ID } from '../config/tenant';

const RawLlmExtractionSchema = z.object({
  intents: z.array(z.string()).default([]),
  location_text: z.string().nullable().default(null),
  street_detail: z.string().nullable().default(null),
  child_age_months: z.number().nullable().default(null),
  symptoms: z.array(z.string()).default([]),
  treatment_referenced: z.string().nullable().default(null),
  preferred_date_text: z.string().nullable().default(null),
  preferred_time_text: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
  is_medical_emergency: z.boolean().default(false),
  confidence_score: z.number().default(0.9),
});

const GENERIC_TREATMENT_RE = /^(?:layanan\s+)?(?:home[-\s]?treatment|home[-\s]?care|homecare|care|treatment|perawatan|pijat|spa|layanan|paket|promo|info\s+treatment|layanan\s+kami)$/i;
const GENERIC_LOCATION_RE = /^(?:rumah|ke\s+rumah|di\s+rumah|rumah\s+saya|lokasi|alamat|klinik|tempat|sini|daerah|posisi|surabaya|sidoarjo|surabaya\s*[\/-]\s*sidoarjo)$/i;
const NON_SYMPTOM_TOKENS = new Set([
  'sehat', 'selalu', 'info', 'konsultasi', 'tanya', 'tertarik', 'booking', 'reservasi', 'bisa',
  'jadwal', 'promo', 'biaya', 'harga', 'ongkir', 'homecare', 'hometreatment', 'treatment',
]);
const INVALID_CUSTOMER_NAMES = new Set([
  'saya', 'aku', 'bunda', 'bund', 'bidan', 'bu bidan', 'admin', 'kak', 'min', 'kamu', 'kami', 'bapak', 'ibu',
]);

export class EntityExtractor {
  /**
   * Filter dan normalisasi hasil ekstraksi agar istilah umum/salam tidak menjadi false positive.
   */
  public static sanitizeExtractedEntities(raw: ExtractedEntities): ExtractedEntities {
    const cleaned = { ...raw };

    // 1. Sanitasi treatment_referenced (Tolak istilah umum model bisnis)
    if (cleaned.treatmentReferenced) {
      const trimmed = cleaned.treatmentReferenced.trim();
      if (GENERIC_TREATMENT_RE.test(trimmed)) {
        cleaned.treatmentReferenced = null;
      }
    }

    // 2. Sanitasi locationText (Tolak kata tempat umum "rumah", "klinik")
    if (cleaned.locationText) {
      const trimmedLoc = cleaned.locationText.trim().toLowerCase();
      if (GENERIC_LOCATION_RE.test(trimmedLoc)) {
        cleaned.locationText = null;
        cleaned.intents = cleaned.intents.filter((i) => i !== 'provide_location');
      }
    }

    // 3. Sanitasi symptoms (Tolak kata basa-basi/salam "sehat", "info")
    if (cleaned.symptoms && cleaned.symptoms.length > 0) {
      cleaned.symptoms = cleaned.symptoms.filter((sym) => {
        const s = sym.trim().toLowerCase();
        if (NON_SYMPTOM_TOKENS.has(s)) return false;
        if (/^(?:sehat\s+selalu|konsultasi|tanya\s+tanya|info\s+lengkap|tertarik\s+layanan)$/i.test(s)) return false;
        return true;
      });
    }

    // 4. Sanitasi customerName (Tolak kata ganti diri "Saya", "Aku")
    if (cleaned.customerName) {
      const nameLower = cleaned.customerName.trim().toLowerCase();
      if (INVALID_CUSTOMER_NAMES.has(nameLower) || nameLower.length < 2) {
        cleaned.customerName = null;
      }
    }

    // Jamin minimal ada intent chitchat jika intents kosong
    if (!cleaned.intents || cleaned.intents.length === 0) {
      cleaned.intents = ['chitchat'];
    }

    return cleaned;
  }

  /**
   * Tahap 1: Fast Deterministic Pre-Extractor (Pure TypeScript, 0ms latency)
   */
  public static preExtractDeterministic(
    text: string,
    incomingMessage?: any
  ): Partial<ExtractedEntities> {
    const lower = text.toLowerCase().trim();
    const result: Partial<ExtractedEntities> = {
      symptoms: [],
    };

    // 1. WhatsApp Native GPS Pin
    if (incomingMessage?.location || incomingMessage?.type === 'location') {
      const loc = incomingMessage.location || incomingMessage;
      if (loc.latitude && loc.longitude) {
        result.locationText = `${loc.latitude},${loc.longitude}`;
        result.intents = ['provide_location'];
      }
    }

    // 1b. Deteksi teks lokasi langsung (misal: "Saya lokasinya di alana tambak oso waru bisa...")
    const locMatch = lower.match(
      /\b(?:lokasi(?:nya)?|alamat(?:nya)?|rumah(?:nya)?|daerah|posisi)\s+(?:saya\s+)?(?:di\s+|:\s*|\s+)?([a-z0-9\s,.-]+?)(?:\s+(?:bisa|mau|untuk|buat|apakah|ada|mohon)\b|$)/i
    );
    if (locMatch && locMatch[1] && locMatch[1].trim().length >= 3) {
      const candidate = locMatch[1].trim();
      if (!GENERIC_LOCATION_RE.test(candidate.toLowerCase())) {
        result.locationText = candidate;
        result.intents = result.intents || [];
        if (!result.intents.includes('provide_location')) {
          result.intents.push('provide_location');
        }
      }
    }

    // 2. Usia Deterministik via Age Calculator
    const ageMonths = parseAgeTextToMonths(text);
    if (ageMonths !== null) {
      result.childAgeMonths = ageMonths;
    }

    // 3. Deteksi Darurat Medis Fatal
    const emergencyPattern = /\b(kejang|pendarahan\s+hebat|tidak\s+sadar|badan\s+biru|sesak\s+parah|darurat|koma)\b/i;
    if (emergencyPattern.test(lower)) {
      result.isMedicalEmergency = true;
      result.intents = ['medical_emergency'];
    }

    // 4. Deteksi Afirmasi / Negasi Singkat
    if (/^(boleh|iya|ya|siap|oke|ok|mau|gas|bisa|lanjut)\b/i.test(lower) && lower.split(/\s+/).length <= 3) {
      result.intents = result.intents || [];
      if (!result.intents.includes('affirmation')) {
        result.intents.push('affirmation');
      }
    }

    // 5. Deteksi Pertanyaan Asal Klinik
    if (/\b(dari\s+daerah\s+mana|asalnya\s+mana|klinik\s+mana|daerah\s+mana|lokasi\s+klinik)\b/i.test(lower)) {
      result.intents = result.intents || [];
      if (!result.intents.includes('ask_clinic_origin')) {
        result.intents.push('ask_clinic_origin');
      }
    }

    // 6. Deteksi Kombinasi Treatment atau Treatment Spesifik
    if (/\bpijat\s+(?:bayi\s+)?ceria\b/i.test(lower) && /\bcukur\b/i.test(lower)) {
      result.treatmentReferenced = 'Pijat Bayi Ceria + Cukur Rambut Bayi';
      result.intents = result.intents || [];
      if (!result.intents.includes('select_treatment')) {
        result.intents.push('select_treatment');
      }
    } else if (/\bpijat\s+(?:bayi\s+)?pulih\s+ceria\b/i.test(lower) && /\bsinar\b/i.test(lower)) {
      result.treatmentReferenced = 'Pijat Bayi Pulih Ceria + Sinar Moksa';
      result.intents = result.intents || [];
      if (!result.intents.includes('select_treatment')) {
        result.intents.push('select_treatment');
      }
    } else if (
      /\b(?:massage|pijat)\s+(?:biasa|aja|saja|reguler|standar|rutin)\b/i.test(lower) ||
      /^(?:massage|pijat)\s+(?:biasa|aja|saja|reguler|standar|rutin)$/i.test(lower.trim())
    ) {
      result.treatmentReferenced = 'Pijat Bayi Ceria';
      result.intents = result.intents || [];
      if (!result.intents.includes('select_treatment')) {
        result.intents.push('select_treatment');
      }
    }

    // 7. Deteksi Permintaan Layanan di Luar Katalog Resmi (Unlisted Service)
    if (/\b(mandikan\s*bayi|mandiin\s*bayi|jasa\s*mandi|paket\s*mandi|baby\s*sitting|penitipan\s*(anak|bayi)|tindik(\s*telinga)?|imunisasi|vaksin|sunat|rawat\s*tali\s*pusat|rawat\s*luka|fisioterapi|paket\s*newborn|perawatan\s*newborn)\b/i.test(lower)) {
      result.intents = result.intents || [];
      if (!result.intents.includes('ask_unlisted_service')) {
        result.intents.push('ask_unlisted_service');
      }
    }

    return result;
  }

  /**
   * Tahap 2: Unified Semantic LLM Extractor (Single-Pass)
   */
  public static async extract(
    text: string,
    context?: {
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      customerPhone?: string;
      conversationId?: string;
      tenantId?: string;
      incomingMessage?: any;
    }
  ): Promise<ExtractedEntities> {
    const tenantId = context?.tenantId || DEFAULT_TENANT_ID;
    const deterministic = this.preExtractDeterministic(text, context?.incomingMessage);

    // Fallback baseline jika LLM offline
    const baselineRaw: ExtractedEntities = {
      intents: (deterministic.intents as any) || ['chitchat'],
      locationText: deterministic.locationText || null,
      streetDetail: deterministic.streetDetail || null,
      childAgeMonths: deterministic.childAgeMonths || null,
      symptoms: deterministic.symptoms || [],
      treatmentReferenced: deterministic.treatmentReferenced || null,
      preferredDateText: deterministic.preferredDateText || null,
      preferredTimeText: deterministic.preferredTimeText || null,
      customerName: deterministic.customerName || null,
      isMedicalEmergency: deterministic.isMedicalEmergency || false,
      confidenceScore: 0.8,
    };
    const baseline = this.sanitizeExtractedEntities(baselineRaw);

    if (!text || text.trim().length === 0) {
      return baseline;
    }

    const modelConfig = AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION', tenantId);
    const endpoint = getLlmEndpointConfig();
    const startedAt = Date.now();

    if (!endpoint.apiKey) {
      return baseline;
    }

    try {
      const systemPrompt = `Anda adalah NLU Semantic Parser klinis untuk WhatsApp Mom & Baby Home Care Clinic (Bidan Yusi).
Tugas Anda adalah mengekstrak SEMUA entitas, keluhan, dan intensi dari pesan customer dalam format JSON terstruktur.

DAFTAR INTENTS YANG DIDUKUNG:
- "provide_location": Menyebutkan nama kelurahan/desa/kecamatan/kota.
- "supplement_address": Menyebutkan detail gang/jalan/nomor rumah/RT-RW.
- "provide_age": Menyebutkan usia anak/bayi.
- "consult_symptom": Mengeluhkan kondisi anak (grok-grok, batuk, pilek, kembung, kolik, susah makan/GTM, susah tidur/rewel, pegal/capek).
- "ask_price": Menanyakan harga, tarif, promo, atau minta pricelist.
- "ask_clinic_origin": Menanyakan klinik/bidan berasal dari daerah/lokasi mana.
- "ask_schedule": Menanyakan ketersediaan hari/jam/slot (misal "Jumat apakah bisa?", "bisa besok jam 3?", "ada slot kosong hari minggu?").
- "select_treatment": Memilih treatment tertentu (misal "Pijat Pulih", "Sinar Moksa", atau rujukan anaphora seperti "yang tadi", "paket kedua").
- "request_booking": Mengajukan reservasi/minta dijadwalkan hari/jam tertentu.
- "affirmation": Persetujuan/jawaban positif singkat (boleh, iya, siap, mau).
- "negation": Penolakan/jawaban negatif (tidak, bukan, jangan).
- "medical_emergency": Kondisi kritis fatal (kejang, biru, tidak sadar, perdarahan hebat).
- "ask_unlisted_service": Menanyakan layanan/tindakan di luar katalog resmi klinik (seperti memandikan bayi harian, penitipan anak/baby sitting, tindik telinga, imunisasi, sunat, perawatan newborn mandiri).
- "chitchat": Sapaan atau basa-basi umum.

ATURAN EKSTRAKSI (SANGAT KETAT):
1. PENTING: "location_text" dan intent "provide_location" HANYA boleh diekstrak jika customer SECARA EKSPLISIT menyebutkan nama lokasi/daerah pada PESAN CUSTOMER TERBARU. Jika customer memberikan alamat lengkap (contoh "Platuk tauladan 19a , sidotopo wetan , kenjeran"), masukkan nama kelurahan/desa/kecamatan ("Sidotopo Wetan, Kenjeran") ke "location_text", dan detail nomor/jalan/gang ("Platuk tauladan 19a") ke "street_detail". DILARANG KERAS menyalin atau mengekstrak ulang lokasi dari RIWAYAT CHAT TERAKHIR jika pesan terbaru hanya bertanya hal lain. DILARANG mengekstrak kata generik "rumah", "ke rumah", "klinik" sebagai location_text.
2. DILARANG KERAS mengekstrak istilah umum model bisnis ("home-treatment", "homecare", "home care", "layanan home", "perawatan", "treatment", "pijat", "spa", "promo") sebagai "treatment_referenced". Field "treatment_referenced" HANYA boleh diisi jika customer menyebut nama perawatan spesifik katalog (contoh: "Pijat Bayi Ceria", "Pijat Pulih", "Pijat Laktasi", "Sinar Moksa", "Pijat Gemoy").
3. Jangan mengekstrak kata sapaan/basa-basi ("sehat selalu", "mau info", "konsultasi") sebagai "symptoms".
4. Jangan mengekstrak kata ganti diri ("Saya", "Aku", "Bunda") sebagai "customer_name".
5. Jika customer menyebut nama perumahan/gang (misal: "Darmo permai selatan gang 17") setelah kelurahan diketahui, masukkan ke "street_detail".
6. Konversikan usia ke total bulan pada "child_age_months" (contoh: "1 bulan" -> 1, "2 bulan" -> 2, "1 tahun" -> 12, "3 tahun" -> 36).
7. Tangkap semua keluhan fisik/anak ke dalam array "symptoms".
8. Pecahkan rujukan anaphora ("yang tadi", "yang kedua") ke "treatment_referenced" jika ada riwayat percakapan.
9. Jika pesan terbaru menanyakan ketersediaan jadwal ("Jumat apakah bisa?"), masukkan intent "ask_schedule" dan waktu ke "preferred_date_text".
10. Jika customer mengatakan peralihan target audiens (contoh "untuk baby aja kak", "buat adeknya aja", "ambil yg bayi aja"), dan di riwayat chat sebelumnya ada keluhan spesifik bayi (seperti flu, batuk, pilek, grok-grok) atau paket bayi yang dibahas (misal "Pijat Pulih Ceria"), masukkan paket atau keluhan tersebut ke "treatment_referenced" atau "symptoms" agar konteks tetap terjaga.
11. Jika customer menyebutkan kombinasi lebih dari 1 treatment (contoh: "Pijat bayi ceria + cukur", "Pulih ceria dan sinar", "Laktasi plus oksitosin"), gabungkan nama treatment lengkapnya ke "treatment_referenced" (contoh: "Pijat Bayi Ceria + Cukur Rambut Bayi") dan sertakan intent "select_treatment".
12. AREA LAYANAN (SURABAYA & SIDOARJO) & NORMALISASI TYPO WILAYAH:
Klinik berlokasi di Sidoarjo dan melayani area Surabaya & Sidoarjo. Jika terdapat typo penulisan nama wilayah/kecamatan/kelurahan di Surabaya/Sidoarjo (contoh: "kencjeran" -> "Kenjeran", "jambangn" -> "Jambangan", "rungkot" -> "Rungkut", "wru" -> "Waru", "sdoarjo" -> "Sidoarjo", "gdangan" -> "Gedangan", "budurn" -> "Buduran"), normalisasikan ke nama wilayah Surabaya/Sidoarjo yang dimaksud pada "location_text", JANGAN mengubahnya menjadi nama kota/daerah lain di luar Jawa Timur (seperti mengubah "kencjeran" menjadi "Kencana").
13. ALIAS TREATMENT STANDAR / BIASA:
Jika customer menyebutkan "massage biasa", "pijat biasa", "massage aja", "pijat aja", "pijat reguler", "massage reguler", "pijat rutin", atau "pijat standar", ini adalah nama sebutan santai untuk perawatan kebugaran umum si kecil. Masukkan ke "treatment_referenced": "Pijat Bayi Ceria" (atau "Pijat Kids Ceria" jika usia anak > 2 tahun) dan sertakan intent "select_treatment".
14. LAYANAN DI LUAR KATALOG RESMI (UNLISTED SERVICE):
Jika customer menanyakan layanan/tindakan yang bukan merupakan layanan pijat/spa/terapi resmi klinik (contoh: "Ada PL homecare mandikan bayi?", "bisa baby sitting?", "tindik telinga bisa?"), sertakan intent "ask_unlisted_service" dan JANGAN memasukkannya ke "treatment_referenced" resmi.

OUTPUT WAJIB JSON VALID DENGAN FORMAT:
{
  "intents": ["provide_location", "consult_symptom", ...],
  "location_text": "Nama kelurahan/desa/kecamatan atau null",
  "street_detail": "Detail jalan/gang/nomor rumah atau null",
  "child_age_months": number atau null,
  "symptoms": ["grok-grok", "batuk"],
  "treatment_referenced": "Nama treatment atau null",
  "preferred_date_text": "Waktu/hari booking atau null",
  "preferred_time_text": "Jam booking atau null",
  "customer_name": "Nama customer jika memperkenalkan diri atau null",
  "is_medical_emergency": boolean,
  "confidence_score": 0.95
}`;

      const historyContext = context?.history && context.history.length > 0
        ? `\nRIWAYAT CHAT TERAKHIR:\n${context.history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n')}`
        : '';

      const userContent = `${historyContext}\n\nPESAN CUSTOMER TERBARU:\n"${text}"\n\nEkstrak seluruh entitas di atas dalam JSON:`;

      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: modelConfig.modelName || 'gpt-4o-mini',
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: endpoint.timeoutMs || 30000,
        payload: {
          temperature: 0.1,
          max_tokens: 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
      });

      const responseData = callResult.data;
      const rawContent = responseData?.choices?.[0]?.message?.content || '{}';
      const extractedStr = extractJsonContent(rawContent) || '{}';
      let parsedObj: any = {};
      try {
        parsedObj = JSON.parse(extractedStr);
      } catch {}
      const validated = RawLlmExtractionSchema.safeParse(parsedObj);

      if (validated.success) {
        const d = validated.data;
        const finalIntents = Array.from(
          new Set([...(deterministic.intents || []), ...d.intents])
        ) as ExtractedEntities['intents'];

        const rawResult: ExtractedEntities = {
          intents: finalIntents.length > 0 ? finalIntents : ['chitchat'],
          locationText: d.location_text || deterministic.locationText || null,
          streetDetail: d.street_detail || deterministic.streetDetail || null,
          childAgeMonths: d.child_age_months ?? deterministic.childAgeMonths ?? null,
          symptoms: Array.from(new Set([...(deterministic.symptoms || []), ...d.symptoms])),
          treatmentReferenced: d.treatment_referenced || deterministic.treatmentReferenced || null,
          preferredDateText: d.preferred_date_text || deterministic.preferredDateText || null,
          preferredTimeText: d.preferred_time_text || deterministic.preferredTimeText || null,
          customerName: d.customer_name || deterministic.customerName || null,
          isMedicalEmergency: d.is_medical_emergency || deterministic.isMedicalEmergency || false,
          confidenceScore: d.confidence_score || 0.9,
        };

        const result = this.sanitizeExtractedEntities(rawResult);

        try {
          const { auditLlmCall } = await import('../utils/llm-audit-buffer');
          auditLlmCall({
            customer_phone: context?.customerPhone || 'unknown',
            tenant_id: context?.tenantId,
            task_type: 'SLOT_EXTRACTOR',
            model_name: callResult.model,
            baseUrl: callResult.baseUrl,
            startedAt,
            usage: callResult.data?.usage,
          });
        } catch {}

        try {
          const { recordLlmExecution } = await import('../utils/llm-execution-logger');
          recordLlmExecution({
            flowType: 'SLOT_EXTRACTOR',
            customerPhone: context?.customerPhone || 'unknown',
            customerInput: text,
            promptPayload: { systemPrompt, userContent },
            reasoning: `Extracted intents: [${result.intents.join(', ')}] | Age: ${result.childAgeMonths} bln | Loc: ${result.locationText || '-'} | Symptoms: [${result.symptoms.join(', ')}]`,
            rawReasoning: rawContent,
            groundTruthUsed: { deterministic, finalResult: result },
            finalReply: JSON.stringify(result),
            modelUsed: callResult.model || modelConfig.modelName,
            durationMs: Date.now() - startedAt,
            status: 'SUCCESS',
          });
        } catch {}

        return result;
      }
    } catch (err: any) {
      console.error('[ENTITY EXTRACTOR ERROR] All LLM models in fallback chain failed:', err.message);
      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: 'SLOT_EXTRACTOR',
          model_name: modelConfig.modelName || 'MiniMax-M2.7-highspeed',
          baseUrl: endpoint.baseUrl,
          startedAt,
          error: { message: err?.message },
        });
      } catch {}
      // Jangan tebak-tebak dengan regex rapuh saat LLM outage. Lempar error untuk Silent Human Escalation!
      throw err;
    }

    return baseline;
  }
}

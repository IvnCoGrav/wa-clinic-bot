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

export class EntityExtractor {
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
    const baseline: ExtractedEntities = {
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
- "chitchat": Sapaan atau basa-basi umum.

ATURAN EKSTRAKSI:
1. PENTING: "location_text" dan intent "provide_location" HANYA boleh diekstrak jika customer SECARA EKSPLISIT menyebutkan nama lokasi/daerah pada PESAN CUSTOMER TERBARU. DILARANG KERAS menyalin atau mengekstrak ulang lokasi dari RIWAYAT CHAT TERAKHIR jika pesan terbaru hanya bertanya hal lain (seperti rekomendasi usia, tanya treatment, atau tanya jadwal).
2. Jika customer menyebut nama perumahan/gang (misal: "Darmo permai selatan gang 17") setelah kelurahan diketahui, masukkan ke "street_detail".
3. Konversikan usia ke total bulan pada "child_age_months" (contoh: "1 bulan" -> 1, "2 bulan" -> 2, "1 tahun" -> 12, "3 tahun" -> 36).
4. Tangkap semua keluhan fisik/anak ke dalam array "symptoms".
5. Pecahkan rujukan anaphora ("yang tadi", "yang kedua") ke "treatment_referenced" jika ada riwayat percakapan.
6. Jika pesan terbaru menanyakan ketersediaan jadwal ("Jumat apakah bisa?"), masukkan intent "ask_schedule" dan waktu ke "preferred_date_text".

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
        timeoutMs: endpoint.timeoutMs || 25000,
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

        const result: ExtractedEntities = {
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
      console.warn('[ENTITY EXTRACTOR ERROR] LLM extraction failed, using deterministic baseline:', err.message);
      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: 'SLOT_EXTRACTOR',
          model_name: modelConfig.modelName || 'gpt-4o-mini',
          baseUrl: endpoint.baseUrl,
          startedAt,
          error: { message: err?.message },
        });
      } catch {}
    }

    return baseline;
  }
}

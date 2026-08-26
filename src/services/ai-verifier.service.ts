import { z } from 'zod';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { extractJsonContent } from '../utils/json-extract';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';
import { AiModelConfigService } from '../config/ai-models.config';
import { parsePositiveInt } from '../utils/env-numeric';

export interface VerifierGroundTruth {
  customerAgeMonths?: number | null;
  audienceIntent?: 'BABY' | 'KIDS' | 'MOMS' | 'GENERAL';
  customerLocation?: string | null;
  isLocationConfirmed?: boolean;
  lastDiscussedTreatment?: string | null;
  allowedServices?: Array<{ name: string; category: string; minAgeMonths: number; maxAgeMonths: number | null; promoPrice: number }>;
}

export interface VerifierInput {
  tenantId?: string;
  customerPhone: string;
  conversationId?: string;
  customerMessage: string;
  draftReply: string;
  bubbleCorrelationId?: string;
  groundTruth: VerifierGroundTruth;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export const VerifierOutputSchema = z.object({
  is_valid: z.boolean(),
  violation_reasons: z.array(z.string()),
  corrected_reply: z.string().nullable(),
  confidence_score: z.number().min(0).max(1).default(1.0),
  reasoning: z.string().default(''),
});

export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;

export class AiResponseVerifierService {
  /**
   * Cek apakah verifier aktif untuk tenant ini.
   */
  public static async isVerifierEnabled(tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { ai_verifier_enabled: true },
      });
      return tenant?.ai_verifier_enabled ?? true;
    } catch {
      return true;
    }
  }

  /**
   * Verifikasi draf balasan AI sebelum dikirim ke customer.
   * Jika draf valid -> kembalikan draftReply asli.
   * Jika ada kesalahan fatal (misal salah kategori usia / halusinasi wilayah) -> kembalikan corrected_reply.
   */
  public static async verifyAndCorrect(input: VerifierInput): Promise<{ finalReply: string; wasCorrected: boolean; reasons: string[] }> {
    const tenantId = input.tenantId || DEFAULT_TENANT_ID;
    const isEnabled = await this.isVerifierEnabled(tenantId);

    if (!isEnabled || !input.draftReply || input.draftReply.trim().length === 0) {
      return { finalReply: input.draftReply, wasCorrected: false, reasons: [] };
    }

    // Bypass verification jika balasan adalah template deterministik murni (form baku, ongkir murni yang sudah dihitung sistem routing)
    const isBypassable =
      input.draftReply.includes('list untuk reservasi :') ||
      input.draftReply.includes('Format Pendaftaran') ||
      /\b(jaraknya\s+kurang\s+lebih|jaraknya\s+sekitar|ongkir(nya)?\s+Rp|gratis\s+ongkir)\b/i.test(input.draftReply) ||
      /^(\[LOCATION|https:\/\/maps)/i.test(input.draftReply);

    if (isBypassable) {
      let cleaned = input.draftReply
        .replace(/([a-zA-Z])(Rp\s*[\d.]+)/g, '$1 $2')
        .replace(/Rp\s*(\d)/g, 'Rp $1')
        .replace(/\bUntukjarak\b/gi, 'Untuk jarak')
        .replace(/\bDarijarak\b/gi, 'Dari jarak')
        .replace(/\bJadi\s+bisa\s+ya[,\s]+Bunda\s*[☺️😊]?\s*Jadi\s+/gi, 'Jadi ')
        .trim();
      if (!cleaned.includes('😊') && !cleaned.includes('☺️') && !cleaned.includes('🤗')) {
        cleaned = `${cleaned} 😊`;
      }
      return { finalReply: cleaned, wasCorrected: false, reasons: [] };
    }

    try {
      const verifierConfig = AiModelConfigService.getModelConfig('AI_VERIFIER', tenantId);
      const endpoint = getLlmEndpointConfig();

      if (!endpoint.apiKey || endpoint.apiKey.startsWith('mock')) {
        return { finalReply: input.draftReply, wasCorrected: false, reasons: [] };
      }

      const systemPrompt = `Anda adalah Quality Control (QC) & Safety Verifier medis untuk Mom & Baby Home Care Clinic (Bidan Yusi).
Tugas Anda adalah memeriksa apakah "DRAF BALASAN AI" yang akan dikirim ke customer di WhatsApp sudah 100% BENAR, AMAN, dan SESUAI GROUND TRUTH.

GROUND TRUTH DATA:
- Usia Anak: ${input.groundTruth.customerAgeMonths != null ? `${input.groundTruth.customerAgeMonths} bulan (${(input.groundTruth.customerAgeMonths / 12).toFixed(1)} tahun)` : 'Belum diketahui'}
- Target Audiens: ${input.groundTruth.audienceIntent || 'GENERAL'}
- Lokasi Customer: ${input.groundTruth.customerLocation || 'Belum terkonfirmasi'}
- Layanan yang Cocok: ${JSON.stringify(input.groundTruth.allowedServices || [])}
- Treatment Terakhir Dibahas: ${input.groundTruth.lastDiscussedTreatment || 'None'}

ATURAN KLINIK & 6 PILAR PEMERIKSAAN QC:
1. CLINICAL & SYMPTOM INDICATION MATCH:
   - Jika customer mengeluhkan respiratori/saluran napas (grok-grok, napas buntu, lendir/dahak, batuk, pilek): Terapi yang TEPAT adalah Pijat Bayi Pulih Ceria + Sinar Moksa (Inframerah Hangat) atau Nebulizer.
   - DILARANG KERAS menolak Sinar Moksa untuk keluhan grok-grok! Sinar Moksa SANGAT COCOK untuk grok-grok dan mengencerkan dahak saluran napas.
   - DILARANG KERAS mengartikan kata "buntu" sebagai "sembelit/susah BAB" jika customer sedang membahas napas atau suara grok-grok bayi.
   - Jika customer mengeluh kembung/kolik/susah BAB/gumoh: Terapi yang TEPAT adalah Pijat Pulih Ceria (fokus perut/ILU).
2. AGE & CATEGORY COMPLIANCE:
   - DILARANG KERAS merekomendasikan treatment kategori MOMS (Prenatal Yoga, Pijat Induksi, Pijat Oksitosin, Laktasi) untuk pasien anak/bayi!
   - Untuk anak usia > 24 bulan (misal 3 tahun = 36 bulan), layanan yang benar adalah "Pijat Kids Ceria" (kategori KIDS), BUKAN Prenatal Yoga atau Pijat Bayi Baru Lahir.
   - Untuk ibu hamil/nifas, jangan tawarkan pijat bayi jika konteksnya untuk ibu.
3. STANDARDIZED PHRASING & BAHASA:
   - Sapaan resmi dan wajar adalah "Bunda" atau "bund" (BUKAN "Bung").
   - Pertanyaan seperti "Mau pilih treatment apa Bunda?", "Mau treatment apa untuk si kecil?" adalah pertanyaan ramah yang wajar dan SAH (BUKAN e-commerce jargon).
   - Yang DILARANG hanyalah istilah transaksi belanja online seperti "mau checkout kapan", "mau order barang apa".
4. PERSONA & SMILE EMOJI GUARANTEE:
   - Tetap hangat, sopan, memanggil "Bunda" khas Bidan Yusi.
   - Wajib menyertakan setidaknya satu emoji senyum "😊".
5. SISTEM ONGKIR & ANTI-HALLUCINATION LOCATION:
   - Klinik melayani Homecare (bidan datang ke rumah). Angka jarak km dan biaya ongkir (misal 16.99 km, ongkir normal Rp 25.000 / promo Rp 20.000) adalah hasil kalkulasi resmi sistem routing maps, BUKAN halusinasi!
   - DILARANG KERAS menyisipkan nama kelurahan atau kota luar (misal: "Bintaro") yang tidak pernah disebutkan customer.
6. PRICING & TREATMENT ACCURACY:
   - Jangan sebutkan nama paket atau harga treatment fiktif di luar daftar layanan resmi klinik.

OUTPUT WAJIB JSON VALID DENGAN SKEMA:
{
  "is_valid": boolean,
  "violation_reasons": ["alasan pelanggaran jika is_valid false"],
  "corrected_reply": "Teks balasan yang sudah 100% dikoreksi dan siap dikirim jika is_valid false, atau null jika is_valid true",
  "confidence_score": number,
  "reasoning": "Penjelasan singkat keputusan QC"
}`;

      const userContent = `PESAN CUSTOMER:
"${input.customerMessage}"

DRAF BALASAN AI YANG AKAN DIKIRIM:
"${input.draftReply}"

Evaluasi draf balasan di atas sekarang. Kembalikan HANYA JSON.`;

      const startedAt = Date.now();
      let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
      try {
        callResult = await callChatCompletionsWithFallback({
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
          model: verifierConfig.modelName || 'MiniMax-M2.7-highspeed',
          fallbackModel: endpoint.fallbackModel,
          timeoutMs: parsePositiveInt(process.env.LLM_TIMEOUT_VERIFIER_MS, 60000),
          payload: {
            temperature: 0.1,
            max_tokens: 1024,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
          },
        });
      } catch (err: any) {
        try {
          const { auditLlmCall } = await import('../utils/llm-audit-buffer');
          auditLlmCall({
            tenant_id: tenantId,
            customer_phone: input.customerPhone || 'unknown',
            conversation_id: input.conversationId ?? null,
            task_type: 'AI_VERIFIER',
            model_name: verifierConfig.modelName || 'MiniMax-M2.7-highspeed',
            baseUrl: endpoint.baseUrl,
            startedAt,
            error: err,
          });
        } catch {}
        try {
          const { recordLlmExecution } = await import('../utils/llm-execution-logger');
          recordLlmExecution({
            flowType: 'AI_VERIFIER',
            customerPhone: input.customerPhone,
            customerInput: input.customerMessage,
            bubbleCorrelationId: input.bubbleCorrelationId,
            promptPayload: { systemPrompt, userContent },
            reasoning: `[ERROR] ${err.message}`,
            rawReasoning: err.stack || err.message,
            groundTruthUsed: {
              draftReply: input.draftReply,
              customerAgeMonths: input.groundTruth.customerAgeMonths,
              customerLocation: input.groundTruth.customerLocation,
            },
            finalReply: input.draftReply,
            modelUsed: verifierConfig.modelName,
            durationMs: Date.now() - startedAt,
            status: 'FALLBACK',
          });
        } catch {}
        throw err;
      }

      const responseData = callResult.data;
      const usedModel = callResult.model || verifierConfig.modelName || 'MiniMax-M2.7-highspeed';

      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          tenant_id: tenantId,
          customer_phone: input.customerPhone || 'unknown',
          conversation_id: input.conversationId ?? null,
          task_type: 'AI_VERIFIER',
          model_name: usedModel,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: responseData?.usage,
        });
      } catch {}

      const rawContent = responseData?.choices?.[0]?.message?.content || '{}';
      const parsedJson = extractJsonContent(rawContent);
      const validated = VerifierOutputSchema.safeParse(parsedJson);

      let finalReply = input.draftReply;
      let wasCorrected = false;
      let reasons: string[] = [];
      let reasoningNote = '';

      if (validated.success) {
        const result = validated.data;
        reasoningNote = result.reasoning || (result.is_valid ? 'QC PASSED: Draf balasan 100% aman dan sesuai ontologi klinis.' : 'QC VIOLATIONS DETECTED');
        if (!result.is_valid && result.corrected_reply && result.corrected_reply.trim().length > 0) {
          console.warn(
            `[AI VERIFIER CORRECTION] Draft reply corrected for ${input.customerPhone}. Violations: ${result.violation_reasons.join(', ')}`
          );
          finalReply = result.corrected_reply;
          wasCorrected = true;
          reasons = result.violation_reasons;
        } else {
          console.log(`[AI VERIFIER PASS] Draft reply verified valid for ${input.customerPhone}.`);
        }
      } else {
        reasoningNote = 'QC JSON output invalid / unparseable, passed original draft';
      }

      // Format cleanup: perbaiki spasi sebelum simbol rupiah (contoh: bisaRp25.000 -> bisa Rp 25.000)
      finalReply = finalReply
        .replace(/([a-zA-Z])(Rp\s*[\d.]+)/g, '$1 $2')
        .replace(/Rp\s*(\d)/g, 'Rp $1')
        .replace(/\bUntukjarak\b/gi, 'Untuk jarak')
        .replace(/\bDarijarak\b/gi, 'Dari jarak')
        .replace(/\bJadi\s+bisa\s+ya[,\s]+Bunda\s*[☺️😊]?\s*Jadi\s+/gi, 'Jadi ')
        .trim();

      // Ensure smile emoji is present in final verified reply
      if (!finalReply.includes('😊') && !finalReply.includes('☺️') && !finalReply.includes('🤗')) {
        finalReply = `${finalReply} 😊`;
      }

      try {
        const { recordLlmExecution } = await import('../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'AI_VERIFIER',
          customerPhone: input.customerPhone,
          customerInput: input.customerMessage,
          bubbleCorrelationId: input.bubbleCorrelationId,
          promptPayload: { systemPrompt, userContent },
          reasoning: reasoningNote + (reasons.length > 0 ? ` | Pelanggaran: ${reasons.join(', ')}` : ''),
          rawReasoning: rawContent,
          groundTruthUsed: {
            draftReply: input.draftReply,
            customerAgeMonths: input.groundTruth.customerAgeMonths,
            customerLocation: input.groundTruth.customerLocation,
            allowedServicesCount: input.groundTruth.allowedServices?.length,
            wasCorrected,
          },
          finalReply,
          modelUsed: usedModel,
          durationMs: Date.now() - startedAt,
          status: wasCorrected ? 'FALLBACK' : 'SUCCESS',
        });
      } catch {}

      return { finalReply, wasCorrected, reasons };
    } catch (err: any) {
      console.warn(`[AI VERIFIER ERROR] QC check failed, using original draft fallback:`, err.message);
      return { finalReply: input.draftReply, wasCorrected: false, reasons: [] };
    }
  }
}
import { z } from 'zod';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { extractJsonContent } from '../utils/json-extract';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';
import { AiModelConfigService } from '../config/ai-models.config';

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

    // Bypass verification jika balasan adalah template deterministik murni (form baku, ongkir murni)
    const isBypassable =
      input.draftReply.includes('list untuk reservasi :') ||
      input.draftReply.includes('Format Pendaftaran') ||
      /^(\[LOCATION|https:\/\/maps)/i.test(input.draftReply);

    if (isBypassable) {
      return { finalReply: input.draftReply, wasCorrected: false, reasons: [] };
    }

    try {
      const verifierConfig = AiModelConfigService.getModelConfig('AI_VERIFIER', tenantId);
      const endpoint = getLlmEndpointConfig();

      const systemPrompt = `Anda adalah Quality Control (QC) & Safety Verifier medis untuk Mom & Baby Home Care Clinic (Bidan Yusi).
Tugas Anda adalah memeriksa apakah "DRAF BALASAN AI" yang akan dikirim ke customer di WhatsApp sudah 100% BENAR, AMAN, dan SESUAI GROUND TRUTH.

GROUND TRUTH DATA:
- Usia Anak: ${input.groundTruth.customerAgeMonths != null ? `${input.groundTruth.customerAgeMonths} bulan (${(input.groundTruth.customerAgeMonths / 12).toFixed(1)} tahun)` : 'Belum diketahui'}
- Target Audiens: ${input.groundTruth.audienceIntent || 'GENERAL'}
- Lokasi Customer: ${input.groundTruth.customerLocation || 'Belum terkonfirmasi'}
- Layanan yang Cocok: ${JSON.stringify(input.groundTruth.allowedServices || [])}
- Treatment Terakhir Dibahas: ${input.groundTruth.lastDiscussedTreatment || 'None'}

4 PILAR PEMERIKSAAN QC:
1. AGE & CATEGORY COMPLIANCE:
   - DILARANG KERAS merekomendasikan treatment kategori MOMS (Prenatal Yoga, Pijat Induksi, Pijat Oksitosin, Laktasi) untuk pasien anak/bayi!
   - Untuk anak usia > 24 bulan (misal 3 tahun = 36 bulan), layanan yang benar adalah "Pijat Kids Ceria" (kategori KIDS), BUKAN Prenatal Yoga atau Pijat Bayi Baru Lahir.
   - Untuk ibu hamil/nifas, jangan tawarkan pijat bayi jika konteksnya untuk ibu.
2. ANTI-HALLUCINATION LOCATION:
   - DILARANG KERAS menebak/menyisipkan nama kelurahan, desa, kecamatan, atau kota luar (misal: "Bintara", "Bintaro", dll) jika customer TIDAK PERNAH menyebutkannya dalam chat.
   - Jika menanyakan lokasi, gunakan formula netral: "kelurahan atau kecamatan mana".
3. PRICING & TREATMENT ACCURACY:
   - Jangan sebutkan harga atau nama paket yang tidak ada dalam daftar layanan resmi klinik.
4. PERSONA COMPLIANCE:
   - Tetap hangat, sopan, dan menggunakan panggilan "Bunda" khas Bidan Yusi.

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
      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: verifierConfig.modelName || 'MiniMax-M2.7-highspeed',
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: 15000,
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

      const rawContent = callResult.data?.choices?.[0]?.message?.content || '{}';
      const parsedJson = extractJsonContent(rawContent);
      const validated = VerifierOutputSchema.safeParse(parsedJson);

      if (validated.success) {
        const result = validated.data;
        if (!result.is_valid && result.corrected_reply && result.corrected_reply.trim().length > 0) {
          console.warn(
            `[AI VERIFIER CORRECTION] Draft reply corrected for ${input.customerPhone}. Violations: ${result.violation_reasons.join(', ')}`
          );
          return {
            finalReply: result.corrected_reply,
            wasCorrected: true,
            reasons: result.violation_reasons,
          };
        }
      }

      return { finalReply: input.draftReply, wasCorrected: false, reasons: [] };
    } catch (err: any) {
      console.warn(`[AI VERIFIER ERROR] QC check failed, using original draft fallback:`, err.message);
      return { finalReply: input.draftReply, wasCorrected: false, reasons: [] };
    }
  }
}
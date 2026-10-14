import { z } from 'zod';
import { prisma } from '../db/client';
import {
  getLlmEndpointConfig,
  callChatWithRetry,
  extractBalancedJson,
} from '../integrations/llm/llm-gateway';

import { KENARI_CATALOG } from '../config/ai-models.config';

/**
 * ReceiptSchema — Kontrak output deteksi struk pembayaran (satu pintu kanonis).
 */
export const ReceiptSchema = z.object({
  isPaymentReceipt: z.boolean(),
  bankDestination: z.string().nullable(), // kode/nama bank/e-wallet tujuan apa adanya dari gambar
  amount: z.number().nullable(),          // angka rupiah murni tanpa desimal
  transferDate: z.string().nullable(),    // YYYY-MM-DD
  referenceNumber: z.string().nullable(), // kode referensi / journal / RRN apa adanya
  confidence: z.number().min(0).max(1),
});

export type ReceiptSignal = z.infer<typeof ReceiptSchema>;

const DEFAULT_NEGATIVE_RECEIPT: ReceiptSignal = {
  isPaymentReceipt: false,
  bankDestination: null,
  amount: null,
  transferDate: null,
  referenceNumber: null,
  confidence: 0,
};

const DEFAULT_RECEIPT_SYSTEM_PROMPT = `Anda adalah sistem AI auditor finansial untuk verifikasi struk/bukti transfer klinik.
Tugas Anda memeriksa gambar dan mengekstrak informasi transaksi keuangan secara akurat dan objektif.

ATURAN EVALUASI:
1. Jika gambar adalah bukti transfer bank (BCA, Mandiri, BRI, BNI, BSI, dll.), konfirmasi transfer e-wallet (GoPay, OVO, ShopeePay, Dana), bukti bayar QRIS, atau struk ATM:
   - "isPaymentReceipt": true
   - "bankDestination": nama bank atau channel tujuan persis seperti tertera di struk (contoh: "BCA", "MANDIRI", "BRI", "QRIS", "GOPAY").
   - "amount": nominal angka rupiah murni (contoh: Rp 250.000 -> 250000). null jika tidak terbaca.
   - "transferDate": tanggal transaksi dalam format "YYYY-MM-DD" jika ada, atau null.
   - "referenceNumber": nomor referensi / kode transaksi / RRN / no jurnal persis seperti tertera, atau null.
   - "confidence": skor keyakinan 0.0 - 1.0 (>= 0.70 bila jelas terbaca).
2. Jika gambar adalah FOTO BAYI, shareloc / peta, screenshot obrolan, selfie, dokumen medis, atau BUKAN bukti pembayaran:
   - "isPaymentReceipt": false
   - Semua field bankDestination, amount, transferDate, referenceNumber HARUS null.
   - "confidence": 0.0 sampai 0.3.
3. KEMBALIKAN HANYA OBJEK JSON MURNI dengan format:
{
  "isPaymentReceipt": boolean,
  "bankDestination": string | null,
  "amount": number | null,
  "transferDate": string | null,
  "referenceNumber": string | null,
  "confidence": number
}`;

/**
 * Skema preprocessing untuk mentoleransi format string angka dari LLM secara tangguh.
 */
const RawLlmReceiptSchema = z.object({
  isPaymentReceipt: z.preprocess((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    return false;
  }, z.boolean()),
  bankDestination: z.preprocess((val) => {
    if (!val || typeof val !== 'string' || val.trim() === '' || val.toLowerCase() === 'null') return null;
    return val.trim();
  }, z.string().nullable()),
  amount: z.preprocess((val) => {
    if (typeof val === 'number') return isNaN(val) ? null : Math.round(val);
    if (typeof val === 'string') {
      const cleaned = val.replace(/[^0-9]/g, '');
      const parsed = parseInt(cleaned, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }, z.number().nullable()),
  transferDate: z.preprocess((val) => {
    if (!val || typeof val !== 'string' || val.trim() === '' || val.toLowerCase() === 'null') return null;
    return val.trim();
  }, z.string().nullable()),
  referenceNumber: z.preprocess((val) => {
    if (val === null || val === undefined) return null;
    const str = String(val).trim();
    return str === '' || str.toLowerCase() === 'null' ? null : str;
  }, z.string().nullable()),
  confidence: z.preprocess((val) => {
    const num = typeof val === 'number' ? val : parseFloat(String(val));
    if (isNaN(num)) return 0;
    return Math.min(1, Math.max(0, num));
  }, z.number().min(0).max(1)),
});

/**
 * Memeriksa gambar menggunakan Vision LLM secara tenant-aware dan fail-closed.
 * Tidak pernah melempar error ke pemanggil; kegagalan jaringan/JSON otomatis mengembalikan non-struk.
 */
export async function detectReceipt(params: {
  tenantId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<ReceiptSignal> {
  const { tenantId, buffer, mimeType } = params;

  if (!buffer || buffer.length === 0) {
    return DEFAULT_NEGATIVE_RECEIPT;
  }

  try {
    let systemPrompt = DEFAULT_RECEIPT_SYSTEM_PROMPT;
    let modelOverride: string | undefined;

    let baseUrlOverride: string | undefined;
    let apiKeyOverride: string | undefined;

    // Baca konfigurasi tenant dari DB jika tersedia
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const settings = (tenant?.settings as any) || {};
      if (typeof settings.receiptVisionPrompt === 'string' && settings.receiptVisionPrompt.trim()) {
        systemPrompt = settings.receiptVisionPrompt.trim();
      }
      if (typeof settings.receiptVisionModel === 'string' && settings.receiptVisionModel.trim()) {
        modelOverride = settings.receiptVisionModel.trim();
      }
      if (typeof settings.receiptVisionBaseUrl === 'string' && settings.receiptVisionBaseUrl.trim()) {
        baseUrlOverride = settings.receiptVisionBaseUrl.trim();
      }
      if (typeof settings.receiptVisionApiKey === 'string' && settings.receiptVisionApiKey.trim()) {
        apiKeyOverride = settings.receiptVisionApiKey.trim();
      }
    } catch {
      // Fallback aman saat DB offline
    }

    if (!baseUrlOverride && modelOverride && KENARI_CATALOG.has(modelOverride)) {
      baseUrlOverride = (process.env.KENARI_BASE_URL || 'https://kenari.id/v1').replace(/\/+$/, '');
      apiKeyOverride = process.env.KENARI_API_KEY || undefined;
    }

    const endpoint = getLlmEndpointConfig({
      tenantId,
      modelConfigKey: 'RECEIPT_VISION',
      model: modelOverride,
      baseUrl: baseUrlOverride,
      apiKey: apiKeyOverride,
      timeoutMs: 20000,
    });

    const base64Image = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const response = await callChatWithRetry({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      fallbackModel: endpoint.fallbackModel,
      timeoutMs: 20000,
      maxRetries: 1,
      payload: {
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analisis gambar ini apakah merupakan bukti transfer / struk pembayaran resmi. Kembalikan JSON persis sesuai format yang ditentukan.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 512,
      },
    });

    const rawContent = response.data?.choices?.[0]?.message?.content?.trim() || '';
    if (!rawContent) {
      return DEFAULT_NEGATIVE_RECEIPT;
    }

    const jsonString = extractBalancedJson(rawContent, 'isPaymentReceipt') || rawContent;
    let rawObj: any;
    try {
      rawObj = JSON.parse(jsonString);
    } catch {
      return DEFAULT_NEGATIVE_RECEIPT;
    }

    const parsed = RawLlmReceiptSchema.parse(rawObj);

    // Threshold keyakinan minimum 0.70 untuk mencegah halusinasi / non-struk samar
    const CONFIDENCE_THRESHOLD = 0.70;
    const isConfirmed = parsed.isPaymentReceipt && parsed.confidence >= CONFIDENCE_THRESHOLD;

    const result: ReceiptSignal = {
      isPaymentReceipt: isConfirmed,
      bankDestination: isConfirmed ? parsed.bankDestination : null,
      amount: isConfirmed ? parsed.amount : null,
      transferDate: isConfirmed ? parsed.transferDate : null,
      referenceNumber: isConfirmed ? parsed.referenceNumber : null,
      confidence: parsed.confidence,
    };

    return ReceiptSchema.parse(result);
  } catch (err: any) {
    console.warn(`[RECEIPT VISION] Gagal menganalisis gambar struk (fail-closed): ${err?.message || err}`);
    return DEFAULT_NEGATIVE_RECEIPT;
  }
}

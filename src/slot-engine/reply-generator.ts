import { CustomerSlate, ExtractedEntities, GroundingPackage } from './types';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { PersonaComposer } from './persona-composer';
import { DynamicCloserService } from './dynamic-closer.service';
import { UnifiedResponseSanitizer } from '../utils/language-sanitizer';

/**
 * Sanitizer Format Deterministik terpusat (alias ke UnifiedResponseSanitizer).
 */
export function sanitizeFinalReply(text: string, options?: { isFollowUp?: boolean; historyCount?: number }): string {
  return UnifiedResponseSanitizer.sanitize(text, options);
}

export class ReplyGenerator {
  /**
   * Menghasilkan balasan percakapan hangat Bidan Yusi dalam 1 kali LLM Call (Single-Pass).
   */
  public static async generate(
    slate: CustomerSlate,
    extraction: ExtractedEntities,
    grounding: GroundingPackage,
    context?: {
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      customerPhone?: string;
      customerInput?: string;
      tenantId?: string;
    }
  ): Promise<string> {
    const tenantId = context?.tenantId || DEFAULT_TENANT_ID;
    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpoint = getLlmEndpointConfig();
    const historyCount = context?.history?.length || 0;

    // Fallback template jika LLM offline
    const baselineFallback = grounding.suggestedPreFilledForm
      ? `Baik Bunda ${slate.name || ''}, berikut kami siapkan format reservasi untuk pencatatan jadwalnya ya Bunda:\n\n${grounding.suggestedPreFilledForm}`
      : `Halo Bunda ${slate.name || ''}! Terima kasih sudah menghubungi Kala Moms and Baby Spa. Ada yang bisa kami bantu untuk si kecil hari ini? 😊`;

    if (!endpoint.apiKey) {
      return sanitizeFinalReply(baselineFallback, { historyCount });
    }

    // 1. Format Fakta Ongkir
    const deliveryText = grounding.deliveryFacts
      ? `• Lokasi Terkonfirmasi: ${grounding.deliveryFacts.kelurahan} (Jarak ~${grounding.deliveryFacts.distanceKm} km)\n• Tarif Ongkir Normal: Rp ${grounding.deliveryFacts.ongkirNormal?.toLocaleString('id-ID')}\n• Tarif Ongkir Promo: Rp ${grounding.deliveryFacts.ongkirPromo?.toLocaleString('id-ID')} (Gunakan harga promo ini ke Bunda!)`
      : '• Lokasi: Belum diketahui secara presisi.';

    // 2. Format Fakta Usia & Layanan Rekomendasi
    const ageText = slate.childAgeMonths !== null
      ? `• Usia Anak: ${slate.childAgeMonths} bulan (${slate.childAgeCategory})`
      : '• Usia Anak: Belum diketahui.';

    const preferencesText = grounding.customerPreferencesText
      ? `• ${grounding.customerPreferencesText}\n`
      : '';

    const catalogText = grounding.filteredCatalog
      .map((s) => {
        const priceText = s.promoPrice ? ` (Tarif Promo: Rp ${s.promoPrice.toLocaleString('id-ID')})` : '';
        const dur = s.durationMinutes ? ` (Durasi: ~${s.durationMinutes} menit)` : '';
        const desc = s.description ? `: ${s.description}` : '';
        return `- ${s.name}${priceText}${dur}${desc}`;
      })
      .join('\n');

    const faqsSection = grounding.relevantFaqs && grounding.relevantFaqs.length > 0
      ? `\nFAKTA FAQ RESMI DARI DATABASE KLINIK (SUMBER KEBENARAN MUTLAK):\n` +
        grounding.relevantFaqs.map((f) => `• ${f.title}\n  ${f.content}`).join('\n\n') + '\n'
      : '';

    // 3. Kalimat Penutup Dinamis berbasis Missing Slots & Smart Form
    const dynamicCloserInstruction = DynamicCloserService.getCloserInstruction(slate, grounding.suggestedPreFilledForm);

    // 4. Susun System Prompt via Single Source of Truth PersonaComposer
    const systemPrompt = PersonaComposer.composeSlotGeneratorPrompt({
      deliveryFactsText: deliveryText,
      ageText,
      preferencesText,
      catalogText,
      faqsSection,
      historyCount,
      dynamicCloserInstruction,
    });

    const historyContext = context?.history && context.history.length > 0
      ? `\nRIWAYAT CHAT SEBELUMNYA:\n${context.history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    const userContent = `${historyContext}\n\nPESAN TERBARU BUNDA:\n"${context?.customerInput || ''}"\n\nBalas dengan ramah sebagai Bidan Yusi:`;

    const startedAt = Date.now();
    try {
      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: modelConfig.modelName || 'gpt-4o-mini',
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: endpoint.timeoutMs || 25000,
        payload: {
          temperature: 0.6,
          max_tokens: 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
      });

      const responseData = callResult.data;
      const rawReply = responseData?.choices?.[0]?.message?.content || baselineFallback;
      const finalReply = sanitizeFinalReply(rawReply, { historyCount });

      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: 'SLOT_GENERATOR',
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: callResult.data?.usage,
        });
      } catch {}

      try {
        const { recordLlmExecution } = await import('../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'SLOT_GENERATOR',
          customerPhone: context?.customerPhone || 'unknown',
          customerInput: context?.customerInput || '',
          promptPayload: { systemPrompt, userContent },
          reasoning: `Single-pass reply generated | Grounding facts: [Loc: ${grounding.deliveryFacts?.kelurahan || '-'}, Age: ${slate.childAgeMonths} bln]`,
          rawReasoning: rawReply,
          groundTruthUsed: grounding,
          finalReply,
          modelUsed: callResult.model || modelConfig.modelName,
          durationMs: Date.now() - startedAt,
          status: 'SUCCESS',
        });
      } catch {}

      return finalReply;
    } catch (err: any) {
      console.warn('[REPLY GENERATOR ERROR] LLM generation failed, using fallback:', err.message);
      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: 'SLOT_GENERATOR',
          model_name: modelConfig.modelName || 'MiniMax-M2.7-highspeed',
          baseUrl: endpoint.baseUrl,
          startedAt,
          error: { message: err?.message },
        });
      } catch {}
      return sanitizeFinalReply(baselineFallback);
    }
  }
}

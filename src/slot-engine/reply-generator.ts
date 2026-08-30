import { CustomerSlate, ExtractedEntities, GroundingPackage } from './types';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { PersonaComposer } from './persona-composer';
import { DynamicCloserService } from './dynamic-closer.service';
import { UnifiedResponseSanitizer } from '../utils/language-sanitizer';
import { ConversationStateSummarizer } from './conversation-summarizer';
import { FewShotExemplarBank } from './few-shot-exemplars';
import { AdaptiveModelSelector } from './adaptive-model-selector';

/**
 * Sanitizer Format Deterministik terpusat (alias ke UnifiedResponseSanitizer).
 */
export function sanitizeFinalReply(text: string, options?: { isFollowUp?: boolean; historyCount?: number; customerInput?: string }): string {
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
    const modelSelection = AdaptiveModelSelector.selectModel(slate, extraction, {
      history: context?.history,
      customerInput: context?.customerInput,
      tenantId,
    });
    const endpoint = getLlmEndpointConfig();
    const botRepliesCount = context?.history?.filter((h) => h.role === 'assistant').length ?? 0;
    const historyCount = botRepliesCount;

    if (!endpoint.apiKey) {
      throw new Error('LLM API Key is missing. Escalating to human handling.');
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
    const dynamicCloserInstruction = DynamicCloserService.getCloserInstruction(
      slate,
      grounding.suggestedPreFilledForm,
      context?.history,
      context?.customerInput
    );

    // 4. Conversation State Summary (0-Token Context Distillation)
    const conversationSummary = ConversationStateSummarizer.summarize(slate, extraction, {
      history: context?.history,
      customerInput: context?.customerInput,
    });

    // 5. Few-Shot Exemplars (Positive Dialogue Reference)
    const relevantExemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, slate, context?.customerInput);
    const fewShotExamples = FewShotExemplarBank.formatExemplarsForPrompt(relevantExemplars);

    // 6. Susun System Prompt via Single Source of Truth PersonaComposer
    const systemPrompt = PersonaComposer.composeSlotGeneratorPrompt({
      deliveryFactsText: deliveryText,
      ageText,
      preferencesText,
      catalogText,
      faqsSection,
      historyCount,
      dynamicCloserInstruction,
      conversationSummary,
      fewShotExamples,
    });

    const historyContext = context?.history && context.history.length > 0
      ? `\nRIWAYAT CHAT SEBELUMNYA:\n${context.history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    const userContent = `${conversationSummary}\n${historyContext}\n\nPESAN TERBARU BUNDA:\n"${context?.customerInput || ''}"\n\nBalas dengan ramah sebagai Bidan Yusi:`;

    const startedAt = Date.now();
    try {
      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: modelSelection.modelName || 'gpt-4o-mini',
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: endpoint.timeoutMs || 30000,
        payload: {
          temperature: modelSelection.modelConfig.temperature || 0.6,
          max_tokens: modelSelection.modelConfig.maxTokens || 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
      });

      const responseData = callResult.data;
      const rawReply =
        responseData?.choices?.[0]?.message?.content?.trim() ||
        responseData?.choices?.[0]?.message?.reasoning_content?.trim() ||
        '';
      if (!rawReply || rawReply.trim().length === 0) {
        throw new Error('Empty response content from LLM choices');
      }
      let finalReply = sanitizeFinalReply(rawReply, { historyCount, customerInput: context?.customerInput });

      // Jaminan Kepatuhan Greeting Turn-0: Jika ini pesan pertama (historyCount === 0),
      // pastikan balasan wajib diawali perkenalan resmi Bidan Yusi jika LLM belum menyertakannya.
      if (
        historyCount === 0 &&
        !finalReply.toLowerCase().includes('bidan yusi') &&
        !finalReply.toLowerCase().includes('perkenalkan')
      ) {
        const { TEMPLATES } = await import('../config/persona');
        const { hasIslamicGreeting } = await import('../utils/islamic-greeting');
        const { stripDuplicateTurn0Greeting } = await import('../utils/language-sanitizer');
        const isIslamic = hasIslamicGreeting(context?.customerInput || '');
        const greetingHeader = TEMPLATES.firstContactGreetingHeader({ isIslamic });
        const cleanBody = stripDuplicateTurn0Greeting(finalReply);
        finalReply = `${greetingHeader}\n\n${cleanBody}`;
      }

      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: modelSelection.task,
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: callResult.data?.usage,
        });
      } catch {}

      try {
        const { recordLlmExecution } = await import('../utils/llm-execution-logger');
        const reasoningContent =
          responseData?.choices?.[0]?.message?.reasoning_content ||
          responseData?.choices?.[0]?.message?.reasoning ||
          null;

        const displayReasoning = reasoningContent
          ? `[AI CoT Reasoning (${callResult.model})]:\n${reasoningContent}\n\n[Summary]: Single-pass reply generated [Model: ${modelSelection.modelName} (${modelSelection.reason})] | Grounding facts: [Loc: ${grounding.deliveryFacts?.kelurahan || '-'}, Age: ${slate.childAgeMonths} bln]`
          : `Single-pass reply generated [Model: ${modelSelection.modelName} (${modelSelection.reason})] | Grounding facts: [Loc: ${grounding.deliveryFacts?.kelurahan || '-'}, Age: ${slate.childAgeMonths} bln]`;

        recordLlmExecution({
          flowType: 'SLOT_GENERATOR',
          customerPhone: context?.customerPhone || 'unknown',
          customerInput: context?.customerInput || '',
          promptPayload: { systemPrompt, userContent },
          reasoning: displayReasoning,
          rawReasoning: reasoningContent || rawReply,
          groundTruthUsed: grounding,
          finalReply,
          modelUsed: callResult.model || modelSelection.modelName,
          durationMs: Date.now() - startedAt,
          status: 'SUCCESS',
        });
      } catch {}

      return finalReply;
    } catch (err: any) {
      console.error('[REPLY GENERATOR ERROR] All LLM models in fallback chain failed:', err.message);
      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: modelSelection.task,
          model_name: modelSelection.modelName || 'gpt-4o-mini',
          baseUrl: endpoint.baseUrl,
          startedAt,
          error: { message: err?.message },
        });
      } catch {}
      // Jangan mengarang teks fallback. Lempar error agar slot-engine melakukan Silent Human Escalation!
      throw err;
    }
  }
}

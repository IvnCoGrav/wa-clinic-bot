import { StateHandlerContext, StateHandlerResult } from '../state-machine/types';
import { CustomerSlate } from './types';
import { FastFaqDetector } from './fast-faq-detector';
import { AiModelConfigService } from '../config/ai-models.config';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { PersonaComposer } from './persona-composer';
import { DynamicCloserService } from './dynamic-closer.service';
import { UnifiedResponseSanitizer } from '../utils/language-sanitizer';

function extractJsonContent(raw: string): string {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) return jsonMatch[1].trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.substring(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}

export class FastFaqGenerator {
  /**
   * Mengeksekusi Single-Pass Fast-Track FAQ (1 LLM Call).
   * Mengembalikan StateHandlerResult & CustomerSlate jika berhasil, atau null jika butuh 2-Call Deep Engine.
   */
  public static async process(
    ctx: StateHandlerContext,
    slate: CustomerSlate
  ): Promise<{ handlerResult: StateHandlerResult; updatedSlate: CustomerSlate } | null> {
    const { customer, incomingMessage, history } = ctx;
    const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;
    const incomingText = incomingMessage?.text?.body || '';
    const historyCount = history?.length || 0;

    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpoint = getLlmEndpointConfig();

    if (!endpoint.apiKey) {
      return null;
    }

    // 1. Ambil knowledge base grounding terkait dari database
    const relevantFaqs = await FastFaqDetector.retrieveFaqGrounding(incomingText, tenantId);
    const faqContext = relevantFaqs.length > 0
      ? relevantFaqs.map((f) => `• [${f.title}]:\n  ${f.content}`).join('\n\n')
      : 'Layanan Mom & Baby Homecare (Bidan Yusi). Bidan bersertifikat datang ke rumah Bunda. Buka setiap hari (weekday & weekend). Area Surabaya & Sidoarjo.';

    // 2. Kalimat Penutup Dinamis berbasis Missing Slots
    const dynamicCloser = DynamicCloserService.getCloserInstruction(slate);

    // 3. Susun System Prompt via Single Source of Truth PersonaComposer
    const systemPrompt = PersonaComposer.composeFastFaqPrompt({
      knowledgeContext: faqContext,
      historyCount,
      dynamicCloser,
    });

    const historyContext = history && history.length > 0
      ? `\nRIWAYAT CHAT TERAKHIR:\n${history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    const userContent = `${historyContext}\n\nPESAN CUSTOMER TERBARU:\n"${incomingText}"\n\nBalas dalam JSON:`;

    const startedAt = Date.now();
    try {
      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: modelConfig.modelName || 'gpt-4o-mini',
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: endpoint.timeoutMs || 25000,
        payload: {
          temperature: 0.5,
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

      let parsed: any = {};
      try {
        parsed = JSON.parse(extractedStr);
      } catch {
        return null; // Fallthrough ke 2-call jika JSON malformed
      }

      if (parsed.needs_deeper_processing === true) {
        return null; // Fallthrough ke 2-call jika LLM minta pemrosesan lebih dalam
      }

      const rawReply = parsed.reply_text || '';
      if (!rawReply || rawReply.trim().length < 10) {
        return null; // Fallthrough jika balasan kosong
      }

      const finalReply = UnifiedResponseSanitizer.sanitize(rawReply, { historyCount });

      // Audit LLM Call
      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: customer.phone || 'unknown',
          tenant_id: tenantId,
          conversation_id: ctx.conversation?.id,
          task_type: 'SLOT_FAST_FAQ',
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: callResult.data?.usage,
        });
      } catch {}

      // Execution Log (Debug Page)
      try {
        const { recordLlmExecution } = await import('../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'SLOT_FAST_FAQ',
          customerPhone: customer.phone || 'unknown',
          customerInput: incomingText,
          promptPayload: { systemPrompt, userContent },
          reasoning: `Fast-Track 1-Call FAQ handled | Intents: [${(parsed.intents || []).join(', ')}] | KB Chunks: ${relevantFaqs.length}`,
          rawReasoning: rawContent,
          groundTruthUsed: { relevantFaqs, intents: parsed.intents },
          finalReply,
          modelUsed: callResult.model || modelConfig.modelName,
          durationMs: Date.now() - startedAt,
          status: 'SUCCESS',
        });
      } catch {}

      const updatedSlate: CustomerSlate = {
        ...slate,
        lastInteractionAt: new Date(),
      };

      const handlerResult: StateHandlerResult = {
        nextState: slate.projectedState,
        replyText: finalReply,
        shouldSendReply: true,
        aiReasoning: `Fast-Track 1-Call FAQ handled: ${parsed.intents?.join(', ') || 'faq'}`,
      };

      return { handlerResult, updatedSlate };
    } catch (err: any) {
      console.warn('[FAST FAQ GENERATOR ERROR] LLM execution failed, falling through to 2-Call engine:', err?.message);
      return null;
    }
  }
}

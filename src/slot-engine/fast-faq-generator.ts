import { StateHandlerContext, StateHandlerResult } from '../state-machine/types';
import { CustomerSlate } from './types';
import { FastFaqDetector } from './fast-faq-detector';
import { sanitizeFinalReply } from './reply-generator';
import { AiModelConfigService } from '../config/ai-models.config';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { DEFAULT_TENANT_ID } from '../config/tenant';

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

    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpoint = getLlmEndpointConfig();

    if (!endpoint.apiKey) {
      return null;
    }

    // 1. Ambil knowledge base grounding terkait
    const relevantFaqs = await FastFaqDetector.retrieveFaqGrounding(incomingText, tenantId);
    const faqContext = relevantFaqs.length > 0
      ? `\nKNOWLEDGE BASE RESMI KLINIK:\n${relevantFaqs.map((f) => `[${f.title}]:\n${f.content}`).join('\n\n')}`
      : '\nINFORMASI KLINIK: Layanan Mom & Baby Homecare (Bidan Yusi). Bidan bersertifikat datang ke rumah Bunda. Buka setiap hari (weekday & weekend). Area Surabaya & Sidoarjo.';

    // 2. Susun System Prompt Persona Bidan Yusi + Unified JSON Output
    const systemPrompt = `Anda adalah "Bidan Yusi", pemilik dan bidan konsultan ramah dari Kala Moms and Baby Care (Layanan Homecare Ibu & Bayi di Surabaya & Sidoarjo).

TUGAS UTAMA:
Jawab pertanyaan customer dengan ramah, empatik, hangat, dan solutif dalam 1 kali balasan WhatsApp.
Gunakan panggilan "Bunda". Berikan informasi akurat sesuai Knowledge Base resmi di bawah.

PANDUAN GAYA BAHASA:
1. Selalu sapa dengan hangat (contoh: "Halo Bunda!", "Selamat siang Bunda!").
2. Gunakan kata "kami" untuk merujuk tim/klinik (bukan "saya" atau "aku").
3. Jangan overclaim medis (gunakan kata "membantu meredakan" bukan "menyembuhkan total").
4. Di akhir balasan, ajukan 1 pertanyaan pembuka lembut untuk memandu Bunda (contoh: "Ada yang ingin Bunda konsultasikan untuk si kecil?" atau "Boleh tahu usia si kecil berapa bulan Bunda?").

${faqContext}

OUTPUT WAJIB FORMAT JSON:
{
  "intents": ["ask_faq"],
  "reply_text": "Teks balasan ramah lengkap Bidan Yusi",
  "needs_deeper_processing": false
}

*Catatan: Set "needs_deeper_processing": true HANYA jika pertanyaan membutuhkan kalkulasi ongkir alamat gang spesifik atau form reservasi multi-data yang tidak bisa dijawab lewat FAQ umum.*`;

    const historyContext = history && history.length > 0
      ? `\nRIWAYAT CHAT TERAKHIR:\n${history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    const userContent = `${historyContext}\n\nPESAN CUSTOMER TERBARU:\n"${incomingText}"\n\nBalas dalam JSON:`;

    const startedAt = Date.now();
    try {
      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: modelConfig.modelName || 'MiniMax-M2.7-highspeed',
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

      const finalReply = sanitizeFinalReply(rawReply);

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

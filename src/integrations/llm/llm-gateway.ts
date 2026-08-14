/**
 * llm-gateway.ts — Helper terpusat untuk plumbing panggilan LLM.
 *
 * Tujuan (Fase 3 — LLM Gateway Abstraction):
 * 1. Satu sumber resolve `apiKey` / `baseUrl` / `model` / `timeout` —
 *    menghilangkan getter duplikat ×6 yang tersebar di ai-router, intent,
 *    generator, phrasing.service, nlu-classifier, llm-evaluator.
 * 2. Satu jalur ekstraksi JSON yang konsisten (reuse src/utils/json-extract.ts).
 * 3. Titik tunggal audit (llm-audit-buffer) & retry/backoff transient.
 */
import { AiModelConfigService, AiTaskType } from '../../config/ai-models.config';
import { getFallbackModel, callChatCompletionsWithFallback, ChatCompletionsWithFallbackCall } from './model-fallback';
import { parsePositiveInt } from '../../utils/env-numeric';

export interface LlmEndpointConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModel: string;
  timeoutMs: number;
}

/** Konfigurasi default provider (bisa di-override per task via env/model registry). */
export function getLlmEndpointConfig(overrides?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  modelConfigKey?: AiTaskType;
}): LlmEndpointConfig {
  const modelConfig = overrides?.modelConfigKey
    ? AiModelConfigService.getModelConfig(overrides.modelConfigKey)
    : null;

  return {
    apiKey: overrides?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: (overrides?.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: overrides?.model || modelConfig?.modelName || process.env.OPENAI_MODEL || '',
    fallbackModel: getFallbackModel(),
    timeoutMs: overrides?.timeoutMs ?? parsePositiveInt(process.env.LLM_TIMEOUT_CHAT_MS, 120000),
  };
}

/** Jalur JSON extraction terpusat (reuse util existing — anti duplikasi fence-strip ×5). */
export { extractJsonContent, extractBalancedJson, repairTruncatedJson } from '../../utils/json-extract';

/**
 * Wrapper panggilan chat completions dengan retry/backoff transient seragam.
 * Error 429/5xx/timeout → retry (default 1×) dengan backoff; error lain di-throw
 * agar circuit breaker / model-fallback chain tetap berfungsi seperti biasa.
 */
export async function callChatWithRetry(
  call: ChatCompletionsWithFallbackCall & { maxRetries?: number; retryDelayMs?: number }
): Promise<Awaited<ReturnType<typeof callChatCompletionsWithFallback>>> {
  const maxRetries = call.maxRetries ?? 1;
  const retryDelayMs = call.retryDelayMs ?? 500;
  let lastErr: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callChatCompletionsWithFallback(call);
    } catch (err: any) {
      lastErr = err;
      const code = err?.code || '';
      const msg = String(err?.message || '');
      const status = err?.response?.status || err?.status || 0;
      const isTransient = code === 'ECONNABORTED' || /timeout/i.test(msg) || status === 429 || status >= 500;
      if (!isTransient || attempt >= maxRetries) throw err;
      const delay = retryDelayMs * Math.pow(2, attempt);
      console.warn(`[LLM GATEWAY] Transient LLM error (${msg}), retrying attempt ${attempt + 1}/${maxRetries} after ${delay}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

import axios from 'axios';

export const DEFAULT_FALLBACK_CHAIN = [
  'gpt-4o-mini',
  'deepseek-v4-flash',
  'MiniMax-M2.7-highspeed',
  'mimo-v2.5',
];

export class LlmOutageError extends Error {
  public readonly isLlmOutage = true;
  constructor(message: string = 'All LLM models in fallback chain failed to respond.') {
    super(message);
    this.name = 'LlmOutageError';
  }
}

export function getFallbackModel(): string {
  return process.env.AI_MODEL_FALLBACK || 'deepseek-chat';
}

/**
 * Rantai fallback DALAM provider yang sama (mis. SumoPod), dipisah koma.
 * Default urutan: MiniMax-M2.7-highspeed -> mimo-v2.5 -> qwen3.7-flash-2026-07-15 -> deepseek-v4-flash
 */
export function getFallbackChain(): string[] {
  const envChain = (process.env.AI_MODEL_FALLBACK_CHAIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return envChain.length > 0 ? envChain : DEFAULT_FALLBACK_CHAIN;
}

export interface ChatCompletionsWithFallbackCall {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  /**
   * Validator opsional untuk memicu fallback saat isi respons dianggap tidak valid
   * (mis. JSON malformed). Jika diberikan dan mengembalikan false untuk respons model
   * utama, helper otomatis mencoba fallbackModel. Default: tidak ada validasi konten.
   */
  isContentValid?: ((content: string) => boolean) | undefined;
  /**
   * Konfigurasi retry transient (429/5xx/timeout) sebelum masuk fallback chain.
   * Default: { maxRetries: 2, baseDelayMs: 400 }.
   */
  transientRetry?: { maxRetries?: number; baseDelayMs?: number };
}

function isTransientError(err: any): boolean {
  const code = err?.code || '';
  const msg = String(err?.message || '') + ' ' + JSON.stringify(err?.response?.data || '');
  const status = err?.response?.status || err?.status || 0;

  // Jika kuota/kredit akun habis, jangan buang waktu retry model yang sama, langsung fallback ke model berikutnya!
  if (/no credits|insufficient_quota|quota|billing|RateLimitError.*OpenAIException/i.test(msg)) {
    return false;
  }

  return (
    code === 'ECONNABORTED' ||
    /timeout/i.test(msg) ||
    status === 429 ||
    status >= 500
  );
}

export interface ChatCompletionsWithFallbackResult {
  data: any;
  model: string;
  usedFallback: boolean;
  /** Base URL dari provider yang benar-benar melayani request (SumoPod / DeepSeek Direct / dst). */
  baseUrl: string;
}

export async function callChatCompletionsWithFallback(
  call: ChatCompletionsWithFallbackCall
): Promise<ChatCompletionsWithFallbackResult> {
  const attempt = async (
    model: string,
    overrideBaseUrl?: string,
    overrideApiKey?: string,
    payloadOverride?: Record<string, unknown>
  ): Promise<any> => {
    const finalBaseUrl = overrideBaseUrl || call.baseUrl;
    const finalApiKey = overrideApiKey || call.apiKey;
    const attemptTimeout = Math.min(call.timeoutMs || 15000, 15000);
    const effectivePayload: any = { ...(payloadOverride ?? call.payload), model };
    if (model.toLowerCase().includes('luna') || model.toLowerCase().includes('o1') || model.toLowerCase().includes('o3')) {
      delete effectivePayload.temperature;
    }
    const resp = await axios.post(
      `${finalBaseUrl}/chat/completions`,
      effectivePayload,
      {
        headers: { Authorization: `Bearer ${finalApiKey}`, 'Content-Type': 'application/json' },
        timeout: attemptTimeout,
      }
    );
    const content = resp.data?.choices?.[0]?.message?.content?.trim() || '';
    const reasoning = resp.data?.choices?.[0]?.message?.reasoning_content || '';
    if (!content && !reasoning) throw new Error('Empty response content from LLM');
    if (content && call.isContentValid && !call.isContentValid(content)) {
      throw new Error('Invalid response content from LLM (validator rejected)');
    }
    return resp;
  };

  // Beberapa provider OpenAI-compatible MENOLAK argumen `response_format`
  // (mis. HTTP 400 "Unrecognized request argument supplied: response_format").
  // Untuk ketahanan: jika request mengandung response_format dan provider
  // menolaknya, ulangi sekali TANPA response_format. Format JSON tetap dijamin
  // lewat instruksi sistem prompt (di tempat pemanggil), jadi tidak ada regresi.
  const hasResponseFormat = Boolean((call.payload as any)?.response_format);
  const isResponseFormatRejection = (err: any): boolean => {
    const raw: string = err?.response?.data?.error?.message || err?.message || String(err);
    return /response_format|response format|unrecognized request argument/i.test(raw);
  };
  const attemptWithFormatRetry = async (
    model: string,
    overrideBaseUrl?: string,
    overrideApiKey?: string
  ): Promise<any> => {
    try {
      return await attempt(model, overrideBaseUrl, overrideApiKey);
    } catch (err: any) {
      if (hasResponseFormat && isResponseFormatRejection(err)) {
        console.warn(
          `[LLM MODEL FALLBACK] Provider menolak response_format (${err?.response?.status || ''} ${err?.response?.data?.error?.message || err?.message || String(err)}). Mencoba ${model} sekali lagi TANPA response_format.`
        );
        return await attempt(model, overrideBaseUrl, overrideApiKey, { ...call.payload, response_format: undefined });
      }
      throw err;
    }
  };

  try {
    return { data: (await attemptWithFormatRetry(call.model)).data, model: call.model, usedFallback: false, baseUrl: call.baseUrl };
  } catch (err: any) {
    const chain = getFallbackChain().filter((m) => m !== call.model);
    let lastErr: any = err;

    // 0) Transient retry: 429/5xx/timeout bisa pulih tanpa ganti model.
    //    Retry terbatas (maks 2) dengan backoff eksponensial singkat, JANGAN
    //    menutup circuit breaker (error tetap diteruskan bila tak kunjung pulih).
    const retryConfig = call.transientRetry ?? { maxRetries: 0, baseDelayMs: 400 };
    const maxRetries = retryConfig.maxRetries ?? 0;
    const baseDelayMs = retryConfig.baseDelayMs ?? 400;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (!isTransientError(lastErr)) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[LLM MODEL FALLBACK] Transient error (${lastErr?.message || String(lastErr)}), retry ${attempt + 1}/${maxRetries} in ${delay}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const resp = await attemptWithFormatRetry(call.model);
        console.log(`[LLM FALLBACK OK] Retry sukses pada ${call.model} (transient recovery).`);
        return { data: resp.data, model: call.model, usedFallback: true, baseUrl: call.baseUrl };
      } catch (e: any) {
        lastErr = e;
      }
    }

    // 1) Rantai model cadangan dalam provider yang sama (mis. SumoPod: deepseek → qwen).
    //    Bisa dikosongkan via env AI_MODEL_FALLBACK_CHAIN untuk perilaku lama.
    for (const fbModel of chain) {
      try {
        console.warn(
          `[LLM MODEL FALLBACK] ${call.model} gagal, mencoba ${fbModel} via provider yang sama (${lastErr?.message || String(lastErr)})`
        );
        const resp = await attemptWithFormatRetry(fbModel);
        console.log(`[LLM FALLBACK OK] ${fbModel} berhasil via ${call.baseUrl}`);
        return { data: resp.data, model: fbModel, usedFallback: true, baseUrl: call.baseUrl };
      } catch (e: any) {
        lastErr = e;
      }
    }

    // 2) Penyelamat terakhir: provider EKSTERNAL (mis. DeepSeek Direct) bila
    //    LLM_FALLBACK_BASE_URL dikonfigurasi. Model = fallbackModel (AI_MODEL_FALLBACK).
    const externalBaseUrl = process.env.LLM_FALLBACK_BASE_URL ? process.env.LLM_FALLBACK_BASE_URL.replace(/\/$/, '') : null;
    if (externalBaseUrl && call.fallbackModel && call.fallbackModel !== call.model) {
      try {
        const externalApiKey = process.env.LLM_FALLBACK_API_KEY || call.apiKey;
        console.warn(
          `[LLM MODEL FALLBACK] ${call.model}${chain.length ? '/' + chain.join(',') : ''} gagal, mencoba last-resort ${call.fallbackModel} via ${externalBaseUrl} (${lastErr?.message || String(lastErr)})`
        );
        const resp = await attemptWithFormatRetry(call.fallbackModel, externalBaseUrl, externalApiKey);
        console.log(`[LLM FALLBACK OK] ${call.fallbackModel} berhasil via ${externalBaseUrl}`);
        return { data: resp.data, model: call.fallbackModel, usedFallback: true, baseUrl: externalBaseUrl };
      } catch (e: any) {
        lastErr = e;
      }
    }

    // 3) Perilaku lama (tanpa AI_MODEL_FALLBACK_CHAIN & tanpa LLM_FALLBACK_BASE_URL):
    //    fallback tunggal dengan baseUrl/key yang sama dengan primary.
    if (chain.length === 0 && !externalBaseUrl && call.fallbackModel && call.fallbackModel !== call.model) {
      try {
        console.warn(
          `[LLM MODEL FALLBACK] ${call.model} gagal, mencoba ${call.fallbackModel} (${lastErr?.message || String(lastErr)})`
        );
        const resp = await attemptWithFormatRetry(call.fallbackModel);
        console.log(`[LLM FALLBACK OK] ${call.fallbackModel} berhasil via ${call.baseUrl}`);
        return { data: resp.data, model: call.fallbackModel, usedFallback: true, baseUrl: call.baseUrl };
      } catch (e: any) {
        lastErr = e;
      }
    }

    const outageErr = new LlmOutageError(
      `Seluruh model LLM fallback (${[call.model, ...chain, call.fallbackModel].filter(Boolean).join(' -> ')}) gagal merespons: ${lastErr?.message || String(lastErr)}`
    );
    (outageErr as any).cause = lastErr;
    throw outageErr;
  }
}

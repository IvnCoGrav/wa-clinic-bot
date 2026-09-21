import axios from 'axios';
import { SUMOPOD_PRIMARY_MODEL, KENARI_PRIMARY_MODEL, DEEPSEEK_DIRECT_MODEL } from '../../config/ai-models.config';

/**
 * Arsitektur fallback 3-TIER (katalog live 2026-09-21):
 *   Tier 1 (primary/utama) : SumoPod  -> MiniMax-M2.7-highspeed (baseUrl + apiKey dari call)
 *   Tier 2 (secondary)      : Kenari   -> deepseek-v4-1-flash   (KENARI_* + LLM_API_KEY)
 *   Tier 3 (last)           : DeepSeek Direct (api.deepseek.com) -> deepseek-chat
 *                             (LLM_FALLBACK_BASE_URL + LLM_FALLBACK_API_KEY)
 *
 * DEFAULT_FALLBACK_CHAIN berisi model Tier 1. Env AI_MODEL_FALLBACK_CHAIN masih bisa
 * meng-override bila ingin chain internal tambahan.
 */
export const DEFAULT_FALLBACK_CHAIN = [SUMOPOD_PRIMARY_MODEL];

/** Definisi sebuah tier provider untuk fallback lintas-provider. */
export interface ProviderTier {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Resolver tier provider dari env. Tier hanya aktif bila baseUrl DAN apiKey tersedia
 * (mencegah request 400 ke endpoint tanpa kredensial).
 */
export function resolveFallbackTiers(): ProviderTier[] {
  const tiers: ProviderTier[] = [];

  // Tier 2 — Kenari (cadangan). Aktif bila KENARI_BASE_URL + key tersedia.
  const kenariBase = (process.env.KENARI_BASE_URL || '').replace(/\/+$/, '');
  const kenariKey = process.env.KENARI_API_KEY || '';
  if (kenariBase && kenariKey) {
    tiers.push({
      name: 'Kenari',
      baseUrl: kenariBase,
      apiKey: kenariKey,
      model: process.env.KENARI_DEFAULT_MODEL || KENARI_PRIMARY_MODEL,
    });
  }

  // Tier 3 — DeepSeek Direct API langsung (last fallback, external last resort).
  const directBase = (process.env.LLM_FALLBACK_BASE_URL || '').replace(/\/+$/, '');
  const directKey = process.env.LLM_FALLBACK_API_KEY || '';
  if (directBase && directKey) {
    tiers.push({
      name: 'DeepSeek Direct',
      baseUrl: directBase,
      apiKey: directKey,
      model: process.env.AI_MODEL_FALLBACK || DEEPSEEK_DIRECT_MODEL,
    });
  }

  return tiers;
}

export class LlmOutageError extends Error {
  public readonly isLlmOutage = true;
  constructor(message: string = 'All LLM models in fallback chain failed to respond.') {
    super(message);
    this.name = 'LlmOutageError';
  }
}

export function getFallbackModel(): string {
  return process.env.AI_MODEL_FALLBACK || DEEPSEEK_DIRECT_MODEL;
}

/**
 * Rantai fallback DALAM provider yang sama (mis. tambahan model Kenari), dipisah koma.
 * Default kini hanya model primer Kenari (tanpa chain internal). Env dapat meng-override.
 */
export function getFallbackChain(): string[] {
  const envChain = (process.env.AI_MODEL_FALLBACK_CHAIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return envChain.length > 0 ? envChain : [...DEFAULT_FALLBACK_CHAIN];
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
    if (!content || content.length < 5) throw new Error('Empty or too short response content from LLM');
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
    let chain = getFallbackChain().filter((m) => m !== call.model);
    // Jika chain kosong karena env hanya berisi call.model, isi otomatis dari DEFAULT_FALLBACK_CHAIN
    if (chain.length === 0) {
      chain = DEFAULT_FALLBACK_CHAIN.filter((m) => m !== call.model);
    }
    let lastErr: any = err;

    // 0) Transient retry: 429/5xx/timeout bisa pulih tanpa ganti model.
    //    Default 2x retry dengan backoff 1s (sebelum ganti model), bedakan 429 transient vs quota habis.
    const retryConfig = call.transientRetry ?? { maxRetries: 2, baseDelayMs: 1000 };
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

    // 1) Rantai model cadangan dalam provider yang sama (Tier 1 internal).
    //    Default kini hanya model primer; env AI_MODEL_FALLBACK_CHAIN bisa menambah.
    for (const fbModel of chain) {
      if (fbModel === call.model) continue;
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

    // 2) Fallback LINTAS-PROVIDER berjenjang (Tier 2 SumoPod -> Tier 3 DeepSeek Direct).
    //    Tier yang baseUrl-nya sama dengan primary di-skip (sudah dicoba di atas).
    const tiers = resolveFallbackTiers();
    for (const tier of tiers) {
      if (tier.baseUrl === call.baseUrl.replace(/\/+$/, '')) continue;
      if (!tier.model || tier.model === call.model) continue;
      try {
        console.warn(
          `[LLM MODEL FALLBACK] ${call.model} gagal, mencoba Tier ${tier.name} (${tier.model}) via ${tier.baseUrl} (${lastErr?.message || String(lastErr)})`
        );
        const resp = await attemptWithFormatRetry(tier.model, tier.baseUrl, tier.apiKey);
        console.log(`[LLM FALLBACK OK] ${tier.model} berhasil via Tier ${tier.name} (${tier.baseUrl})`);
        return { data: resp.data, model: tier.model, usedFallback: true, baseUrl: tier.baseUrl };
      } catch (e: any) {
        lastErr = e;
      }
    }

    const tierNames = tiers.map((t) => `${t.name}:${t.model}`).join(' -> ');
    const outageErr = new LlmOutageError(
      `Seluruh model LLM fallback (${[call.model, ...chain.filter((m) => m !== call.model), tierNames].filter(Boolean).join(' -> ')}) gagal merespons: ${lastErr?.message || String(lastErr)}`
    );
    (outageErr as any).cause = lastErr;
    throw outageErr;
  }
}

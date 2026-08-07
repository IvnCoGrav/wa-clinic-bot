import axios from 'axios';

export function getFallbackModel(): string {
  return process.env.AI_MODEL_FALLBACK || 'qwen3.7-flash-2026-07-15';
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
}

export interface ChatCompletionsWithFallbackResult {
  data: any;
  model: string;
  usedFallback: boolean;
}

export async function callChatCompletionsWithFallback(
  call: ChatCompletionsWithFallbackCall
): Promise<ChatCompletionsWithFallbackResult> {
  const attempt = async (model: string): Promise<any> => {
    const resp = await axios.post(
      `${call.baseUrl}/chat/completions`,
      { ...call.payload, model },
      {
        headers: { Authorization: `Bearer ${call.apiKey}`, 'Content-Type': 'application/json' },
        timeout: call.timeoutMs,
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

  try {
    return { data: (await attempt(call.model)).data, model: call.model, usedFallback: false };
  } catch (err: any) {
    if (!call.fallbackModel) throw err;
    console.warn(
      `[LLM MODEL FALLBACK] ${call.model} gagal, mencoba ${call.fallbackModel} (${err?.message || String(err)})`
    );
    return { data: (await attempt(call.fallbackModel)).data, model: call.fallbackModel, usedFallback: true };
  }
}

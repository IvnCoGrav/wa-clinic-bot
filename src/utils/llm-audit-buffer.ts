import { calculateLlmCost, deriveProvider } from './cost-calculator';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isSimpleLogMode } from './stage-logger';

export interface LlmAuditLogPayload {
  tenant_id?: string;
  customer_phone: string;
  conversation_id?: string | null;
  /** Provider aktual (dari baseUrl request): 'SumoPod', 'DeepSeek Direct', dst. */
  provider?: string;
  model_name: string;
  task_type: string; // NLU_ROUTING, CHAT_REPLY, dst
  prompt_tokens: number;
  completion_tokens: number;
  cached_prompt_tokens?: number;
  /** Kode error bila panggilan LLM gagal (mis. 'EMPTY_CONTENT', 'TIMEOUT'). */
  error_code?: string | null;
  /** Latensi panggilan LLM dalam milidetik. */
  latency_ms?: number;
  /** Label window evaluasi A/B (mis. 'runA-minimax', 'runB-deepseek-sumopod'). */
  eval_run?: string | null;
}

const buffer: LlmAuditLogPayload[] = [];
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 10000; // 10 detik

let timerId: NodeJS.Timeout | null = null;

/**
 * Memasukkan log penggunaan LLM ke buffer in-memory (Fire-and-Forget).
 * Juga mencetak log shadow ke console untuk keperluan audit/testing.
 */
export function recordLlmUsage(payload: LlmAuditLogPayload): void {
  try {
    const promptTokens = payload.prompt_tokens || 0;
    const completionTokens = payload.completion_tokens || 0;
    const cachedTokens = payload.cached_prompt_tokens || 0;
    const { totalCostIdr } = calculateLlmCost(payload.model_name, promptTokens, completionTokens, cachedTokens);

    // Shadow Logging ke console (hanya saat mode debug/verbose)
    if (!isSimpleLogMode()) {
      console.log(
        `[LLM AUDIT SHADOW] Task: ${payload.task_type} | Model: ${payload.model_name} | ` +
          `Tokens: ${promptTokens} in (${cachedTokens} cached) / ${completionTokens} out | ` +
          `Cost: Rp ${totalCostIdr.toLocaleString('id-ID')} | Phone: ${payload.customer_phone}`
      );
    }

    buffer.push({
      ...payload,
      tenant_id: payload.tenant_id || DEFAULT_TENANT_ID,
    });

    if (buffer.length >= BATCH_SIZE) {
      flushLlmAuditBuffer();
    } else if (!timerId) {
      timerId = setTimeout(() => {
        timerId = null;
        flushLlmAuditBuffer();
      }, FLUSH_INTERVAL_MS);
    }
  } catch (err) {
    console.error('[LLM AUDIT BUFFER] Error buffering log:', err);
  }
}

/**
 * Helper audit terpusat untuk panggilan LLM via callChatCompletionsWithFallback.
 * Mencatat sukses (dengan token usage) ATAU kegagalan (dengan error_code),
 * plus provider aktual dari baseUrl request & latensi. Fire-and-forget aman.
 */
export function auditLlmCall(params: {
  customer_phone: string;
  tenant_id?: string;
  conversation_id?: string | null;
  task_type: string;
  /** Model yang BENAR-BENAR melayani (primary atau fallback) — dari result helper. */
  model_name: string;
  /** Base URL aktual dari result helper (menentukan provider di audit). */
  baseUrl: string;
  startedAt: number;
  error?: { message?: string } | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_read_input_tokens?: number } | null;
  } | null;
  eval_run?: string | null;
}): void {
  try {
    const details = params.usage?.prompt_tokens_details || {};
    const cachedTokens = details.cached_tokens || details.cache_read_input_tokens || 0;
    recordLlmUsage({
      tenant_id: params.tenant_id,
      customer_phone: params.customer_phone,
      conversation_id: params.conversation_id ?? null,
      provider: deriveProvider(params.baseUrl),
      model_name: params.model_name,
      task_type: params.task_type,
      prompt_tokens: params.usage?.prompt_tokens || 0,
      completion_tokens: params.usage?.completion_tokens || 0,
      cached_prompt_tokens: cachedTokens,
      error_code: params.error ? (params.error.message || 'LLM_ERROR').slice(0, 200) : null,
      latency_ms: Date.now() - params.startedAt,
      eval_run: params.eval_run || null,
    });
  } catch {
    // Fire-and-forget: audit tidak boleh mengganggu alur utama
  }
}

/**
 * Melakukan batch insert data buffer ke tabel llm_audit_logs via Prisma.
 * Dieksekusi secara asinkron dan aman dari uncaught exceptions.
 */
export async function flushLlmAuditBuffer(): Promise<void> {
  if (buffer.length === 0) return;

  const itemsToFlush = buffer.splice(0, buffer.length);
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }

  try {
    const { prisma } = await import('../db/client');
    const records = itemsToFlush.map((item) => {
      const { provider, totalCostIdr } = calculateLlmCost(
        item.model_name,
        item.prompt_tokens,
        item.completion_tokens,
        item.cached_prompt_tokens || 0
      );
      return {
        tenant_id: item.tenant_id || DEFAULT_TENANT_ID,
        customer_phone: item.customer_phone,
        conversation_id: item.conversation_id || null,
        // Prioritas: provider yang dikirim call site (dari baseUrl aktual) > mapping nama model
        provider: item.provider || provider,
        model_name: item.model_name,
        task_type: item.task_type,
        prompt_tokens: item.prompt_tokens,
        completion_tokens: item.completion_tokens,
        cached_prompt_tokens: item.cached_prompt_tokens || 0,
        cost_idr: totalCostIdr,
        error_code: item.error_code || null,
        latency_ms: item.latency_ms || null,
        eval_run: item.eval_run || null,
      };
    });

    // Gunakan createMany jika tabel dan prisma client siap
    if ((prisma as any).llmAuditLog?.createMany) {
      await (prisma as any).llmAuditLog.createMany({
        data: records,
      });
      if (!isSimpleLogMode()) {
        console.log(`[LLM AUDIT BUFFER] Successfully batch inserted ${records.length} log items to database.`);
      }
    }
  } catch (err: any) {
    console.warn('[LLM AUDIT BUFFER] Failed to batch insert to database (DB offline / schema pending):', err?.message || err);
  }
}

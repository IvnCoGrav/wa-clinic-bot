import { calculateLlmCost } from './cost-calculator';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface LlmAuditLogPayload {
  tenant_id?: string;
  customer_phone: string;
  conversation_id?: string | null;
  model_name: string;
  task_type: string; // NLU_ROUTING, CHAT_REPLY, dst
  prompt_tokens: number;
  completion_tokens: number;
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
    const { totalCostIdr } = calculateLlmCost(payload.model_name, promptTokens, completionTokens);

    // Shadow Logging ke console (untuk memverifikasi kalkulasi tanpa harus langsung query DB)
    console.log(
      `[LLM AUDIT SHADOW] Task: ${payload.task_type} | Model: ${payload.model_name} | ` +
        `Tokens: ${promptTokens} in / ${completionTokens} out | ` +
        `Cost: Rp ${totalCostIdr.toLocaleString('id-ID')} | Phone: ${payload.customer_phone}`
    );

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
      const { totalCostIdr } = calculateLlmCost(item.model_name, item.prompt_tokens, item.completion_tokens);
      return {
        tenant_id: item.tenant_id || DEFAULT_TENANT_ID,
        customer_phone: item.customer_phone,
        conversation_id: item.conversation_id || null,
        model_name: item.model_name,
        task_type: item.task_type,
        prompt_tokens: item.prompt_tokens,
        completion_tokens: item.completion_tokens,
        cost_idr: totalCostIdr,
      };
    });

    // Gunakan createMany jika tabel dan prisma client siap
    if ((prisma as any).llmAuditLog?.createMany) {
      await (prisma as any).llmAuditLog.createMany({
        data: records,
      });
      console.log(`[LLM AUDIT BUFFER] Successfully batch inserted ${records.length} log items to database.`);
    }
  } catch (err: any) {
    console.warn('[LLM AUDIT BUFFER] Failed to batch insert to database (DB offline / schema pending):', err?.message || err);
  }
}

import crypto from 'crypto';

export type LlmFlowType =
  | 'CHATBOT_AUTO'
  | 'COPILOT_DRAFT'
  | 'CLINICAL_ESCALATION'
  | 'REASONING_ONLY'
  | 'NLU_CLASSIFICATION'
  | 'AI_ROUTER'
  | 'AI_VERIFIER'
  | 'PHRASING';

export interface LlmExecutionRecord {
  id: string;
  timestamp: string;
  flowType: LlmFlowType;
  customerPhone?: string;
  customerName?: string;
  customerInput: string;
  reasoning: string | null;
  groundTruthUsed?: any;
  contextSummary?: string;
  finalReply: string;
  confidenceScore?: number;
  modelUsed?: string;
  durationMs?: number;
  status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
}

const MAX_LLM_LOGS = 150;
const llmExecutionBuffer: LlmExecutionRecord[] = [];

/**
 * Catat eksekusi proses LLM (baik auto-reply chatbot maupun copilot draft live-chat).
 */
export function recordLlmExecution(
  data: Omit<LlmExecutionRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
): LlmExecutionRecord {
  const entry: LlmExecutionRecord = {
    id: data.id || `llm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    timestamp: data.timestamp || new Date().toISOString(),
    flowType: data.flowType || 'CHATBOT_AUTO',
    customerPhone: data.customerPhone,
    customerName: data.customerName,
    customerInput: data.customerInput || '',
    reasoning: data.reasoning || null,
    groundTruthUsed: data.groundTruthUsed,
    contextSummary: data.contextSummary,
    finalReply: data.finalReply || '',
    confidenceScore: data.confidenceScore,
    modelUsed: data.modelUsed,
    durationMs: data.durationMs,
    status: data.status || 'SUCCESS',
  };

  llmExecutionBuffer.unshift(entry);
  if (llmExecutionBuffer.length > MAX_LLM_LOGS) {
    llmExecutionBuffer.pop();
  }

  return entry;
}

/**
 * Ambil riwayat log eksekusi LLM terisolasi.
 */
export function getLlmExecutionLogs(limit = 100, flowFilter?: string): LlmExecutionRecord[] {
  let logs = llmExecutionBuffer;
  if (flowFilter && flowFilter !== 'all') {
    logs = logs.filter((l) => l.flowType === flowFilter);
  }
  return logs.slice(0, Math.max(1, Math.min(limit, MAX_LLM_LOGS)));
}

/**
 * Bersihkan buffer log eksekusi LLM (untuk testing/reset).
 */
export function clearLlmExecutionLogs(): void {
  llmExecutionBuffer.length = 0;
}

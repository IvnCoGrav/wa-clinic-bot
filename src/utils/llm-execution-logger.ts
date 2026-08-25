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
  bubbleCorrelationId?: string;
  promptPayload?: any;
  reasoning: string | null;
  rawReasoning?: string | null;
  groundTruthUsed?: any;
  contextSummary?: string;
  finalReply: string;
  confidenceScore?: number;
  modelUsed?: string;
  durationMs?: number;
  status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
}

export interface GroupedBubbleChat {
  correlationId: string;
  timestamp: string;
  customerInput: string;
  customerName?: string;
  aiCalls: LlmExecutionRecord[];
}

export interface GroupedCustomerLlmLogs {
  customerPhone: string;
  customerName: string;
  totalBubbles: number;
  totalAiCalls: number;
  latestTimestamp: string;
  bubbles: GroupedBubbleChat[];
}

const MAX_LLM_LOGS = 500;
const llmExecutionBuffer: LlmExecutionRecord[] = [];

/**
 * Catat eksekusi proses LLM (baik auto-reply chatbot, NLU, AI Router, AI Verifier, maupun copilot).
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
    bubbleCorrelationId: data.bubbleCorrelationId,
    promptPayload: data.promptPayload,
    reasoning: data.reasoning || null,
    rawReasoning: data.rawReasoning || null,
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
 * Ambil riwayat log eksekusi LLM flat (daftar urut waktu).
 */
export function getLlmExecutionLogs(limit = 100, flowFilter?: string): LlmExecutionRecord[] {
  let logs = llmExecutionBuffer;
  if (flowFilter && flowFilter !== 'all') {
    logs = logs.filter((l) => l.flowType === flowFilter);
  }
  return logs.slice(0, Math.max(1, Math.min(limit, MAX_LLM_LOGS)));
}

/**
 * Ambil riwayat log eksekusi LLM terkelompok secara hierarkis 3-Level:
 * Level 1: Nomor Telepon Customer
 * Level 2: Bubble Chat / Input Masuk Pasien
 * Level 3: Daftar Panggilan AI (NLU, Router, Generator, Verifier) untuk bubble tersebut
 */
export function getGroupedLlmExecutionLogs(limit = 100, flowFilter?: string): GroupedCustomerLlmLogs[] {
  const rawLogs = getLlmExecutionLogs(limit, flowFilter);

  // Group by customer phone
  const phoneMap = new Map<string, LlmExecutionRecord[]>();
  for (const log of rawLogs) {
    const phone = log.customerPhone || 'Unknown / General';
    const list = phoneMap.get(phone) || [];
    list.push(log);
    phoneMap.set(phone, list);
  }

  const result: GroupedCustomerLlmLogs[] = [];

  for (const [phone, phoneLogs] of phoneMap.entries()) {
    // Sort phone logs ascending in time to cluster bubbles
    const sorted = [...phoneLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const bubbles: GroupedBubbleChat[] = [];
    let currentBubble: GroupedBubbleChat | null = null;

    for (const log of sorted) {
      const logTime = new Date(log.timestamp).getTime();
      const isDraftQc = log.customerInput.startsWith('[DRAFT QC]');

      // Determine clean input text
      let cleanInput = log.customerInput;
      if (isDraftQc) {
        const match = log.customerInput.match(/\(User:\s*"([^"]+)"\)/);
        if (match && match[1]) {
          cleanInput = match[1];
        }
      }

      // Check if this belongs to current bubble (either same correlationId or within 25s with same/similar input)
      const canMerge =
        currentBubble &&
        ((log.bubbleCorrelationId && log.bubbleCorrelationId === currentBubble.correlationId) ||
          (!log.bubbleCorrelationId &&
            Math.abs(logTime - new Date(currentBubble.timestamp).getTime()) < 25000 &&
            (cleanInput === currentBubble.customerInput || cleanInput.length === 0 || isDraftQc)));

      if (canMerge && currentBubble) {
        currentBubble.aiCalls.push(log);
        if (!currentBubble.customerName && log.customerName) {
          currentBubble.customerName = log.customerName;
        }
      } else {
        currentBubble = {
          correlationId: log.bubbleCorrelationId || `bubble_${log.id}`,
          timestamp: log.timestamp,
          customerInput: cleanInput || log.customerInput,
          customerName: log.customerName,
          aiCalls: [log],
        };
        bubbles.unshift(currentBubble); // newest bubble first
      }
    }

    const latestTs = sorted[sorted.length - 1]?.timestamp || new Date().toISOString();
    const customerName = phoneLogs.find((l) => Boolean(l.customerName))?.customerName || phone;

    result.push({
      customerPhone: phone,
      customerName,
      totalBubbles: bubbles.length,
      totalAiCalls: phoneLogs.length,
      latestTimestamp: latestTs,
      bubbles,
    });
  }

  // Sort customers by latest activity descending
  return result.sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());
}

/**
 * Bersihkan buffer log eksekusi LLM (untuk testing/reset).
 */
export function clearLlmExecutionLogs(): void {
  llmExecutionBuffer.length = 0;
}

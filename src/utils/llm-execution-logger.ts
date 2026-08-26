import crypto from 'crypto';

export type LlmFlowType =
  | 'CHATBOT_AUTO'
  | 'COPILOT_DRAFT'
  | 'CLINICAL_ESCALATION'
  | 'REASONING_ONLY'
  | 'NLU_CLASSIFICATION'
  | 'AI_ROUTER'
  | 'AI_VERIFIER'
  | 'PHRASING'
  | 'SLOT_EXTRACTOR'
  | 'SLOT_GENERATOR'
  | 'SLOT_FAST_FAQ';

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
 * Normalisasi input customer untuk mencocokkan teks asli yang diekstrak
 * dari berbagai wrapper metadata (misal Router [State: ...] atau Verifier [DRAFT QC] ... (User: "...")).
 */
export function normalizeCustomerInput(input: string): string {
  if (!input) return '';
  let cleaned = input.trim();

  // Pattern 1: Router '[State: INITIAL] "Halo mau tanya"'
  const routerMatch = cleaned.match(/^\[State:[^\]]+\]\s*"([\s\S]*)"$/);
  if (routerMatch && routerMatch[1]) {
    cleaned = routerMatch[1].trim();
  }

  // Pattern 2: Verifier '[DRAFT QC] "..." (User: "Halo mau tanya")'
  const verifierMatch = cleaned.match(/\(User:\s*"([\s\S]*)"\)\s*$/);
  if (verifierMatch && verifierMatch[1]) {
    cleaned = verifierMatch[1].trim();
  } else {
    // Fallback if closed differently
    const verifierMatchAlt = cleaned.match(/\(User:\s*"([\s\S]*?)"\)/);
    if (verifierMatchAlt && verifierMatchAlt[1]) {
      cleaned = verifierMatchAlt[1].trim();
    }
  }

  // Pattern 3: Hapus tanda petik ganda/tunggal di awal & akhir jika tersisa
  cleaned = cleaned.replace(/^["']|["']$/g, '').trim();

  return cleaned;
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

  const FLOW_ORDER: Record<string, number> = {
    SLOT_EXTRACTOR: 1,
    NLU_CLASSIFICATION: 1,
    AI_ROUTER: 2,
    SLOT_GENERATOR: 3,
    CHATBOT_AUTO: 3,
    COPILOT_DRAFT: 3,
    AI_VERIFIER: 4,
    PHRASING: 5,
  };

  for (const [phone, phoneLogs] of phoneMap.entries()) {
    // Sort phone logs ascending in time to cluster bubbles
    const sorted = [...phoneLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const bubbles: GroupedBubbleChat[] = [];
    const correlationMap = new Map<string, GroupedBubbleChat>();

    for (const log of sorted) {
      const logTime = new Date(log.timestamp).getTime();
      const cleanInput = normalizeCustomerInput(log.customerInput);

      let targetBubble: GroupedBubbleChat | null = null;

      if (log.bubbleCorrelationId && correlationMap.has(log.bubbleCorrelationId)) {
        targetBubble = correlationMap.get(log.bubbleCorrelationId)!;
      } else {
        // Fallback: check most recent bubble for heuristic merge
        const lastBubble = bubbles[0] || null; // bubbles is unshifted, so bubbles[0] is latest
        if (lastBubble) {
          const isTimeClose = Math.abs(logTime - new Date(lastBubble.timestamp).getTime()) < 35000;
          const isInputMatching =
            cleanInput === lastBubble.customerInput ||
            !cleanInput ||
            !lastBubble.customerInput ||
            cleanInput.includes(lastBubble.customerInput) ||
            lastBubble.customerInput.includes(cleanInput);

          if (!log.bubbleCorrelationId && isTimeClose && isInputMatching) {
            targetBubble = lastBubble;
          }
        }
      }

      if (targetBubble) {
        targetBubble.aiCalls.push(log);
        if (!targetBubble.customerName && log.customerName) {
          targetBubble.customerName = log.customerName;
        }
        if (cleanInput && (!targetBubble.customerInput || targetBubble.customerInput.startsWith('[DRAFT QC]') || targetBubble.customerInput === '(Input)')) {
          targetBubble.customerInput = cleanInput;
        }
        if (log.bubbleCorrelationId) {
          correlationMap.set(log.bubbleCorrelationId, targetBubble);
        }
      } else {
        const bubbleHash = cleanInput ? crypto.createHash('md5').update(cleanInput).digest('hex').slice(0, 6) : log.id;
        const timeBucket = Math.floor(logTime / 30000);
        const deterministicId = log.bubbleCorrelationId || `bubble_${phone.replace(/[^\w]/g, '_')}_${bubbleHash}_${timeBucket}`;

        const newBubble: GroupedBubbleChat = {
          correlationId: deterministicId,
          timestamp: log.timestamp,
          customerInput: cleanInput || log.customerInput || '(Input)',
          customerName: log.customerName,
          aiCalls: [log],
        };

        if (log.bubbleCorrelationId) {
          correlationMap.set(log.bubbleCorrelationId, newBubble);
        }
        bubbles.unshift(newBubble); // newest bubble first
      }
    }

    // Urutkan tahapan AI di dalam setiap bubble secara sekuensial logis (NLU -> Router -> Generator -> QC)
    for (const b of bubbles) {
      b.aiCalls.sort((a, b) => {
        const orderA = FLOW_ORDER[a.flowType] || 99;
        const orderB = FLOW_ORDER[b.flowType] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
    }

    const latestTs = sorted[sorted.length - 1]?.timestamp || new Date().toISOString();
    const customerName = phoneLogs.find((l) => Boolean(l.customerName))?.customerName || (phone.startsWith('62') || phone.startsWith('+') ? 'Pasien' : phone);

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

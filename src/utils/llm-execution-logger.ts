import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type LlmFlowType =
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

const LOGS_DIR = path.resolve(process.cwd(), 'logs');

// Background asynchronous file append queue for LLM JSONL logs (non-blocking)
let llmWriteQueue: string[] = [];
let isLlmFlushing = false;
let llmFlushTimer: NodeJS.Timeout | null = null;

function ensureLogsDir(): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  } catch {}
}

function getLogDateString(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLlmLogFilePath(d = new Date()): string {
  return path.join(LOGS_DIR, `llm-${getLogDateString(d)}.jsonl`);
}

function scheduleLlmFlush(): void {
  if (llmFlushTimer || llmWriteQueue.length === 0) return;
  llmFlushTimer = setTimeout(() => {
    llmFlushTimer = null;
    void flushLlmWriteQueue();
  }, 250);
  if ((llmFlushTimer as any).unref) {
    (llmFlushTimer as any).unref();
  }
}

async function flushLlmWriteQueue(): Promise<void> {
  if (isLlmFlushing || llmWriteQueue.length === 0) return;
  if (process.env.NODE_ENV === 'test') {
    llmWriteQueue = [];
    return;
  }

  isLlmFlushing = true;
  const chunk = llmWriteQueue.splice(0, llmWriteQueue.length);
  try {
    ensureLogsDir();
    const filePath = getLlmLogFilePath();
    await fs.promises.appendFile(filePath, chunk.join('\n') + '\n', 'utf8');
  } catch (_) {
    // Best-effort file writing, never throw or interrupt execution
  } finally {
    isLlmFlushing = false;
    if (llmWriteQueue.length > 0) {
      scheduleLlmFlush();
    }
  }
}

/**
 * Catat eksekusi proses LLM (baik auto-reply chatbot, NLU, AI Router, AI Verifier, maupun copilot).
 */
export function recordLlmExecution(
  data: Omit<LlmExecutionRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
): LlmExecutionRecord {
  const entry: LlmExecutionRecord = {
    id: data.id || `llm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    timestamp: data.timestamp || new Date().toISOString(),
    flowType: data.flowType || 'SLOT_GENERATOR',
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

  // Queue to background JSONL persistent file
  if (process.env.NODE_ENV !== 'test') {
    try {
      llmWriteQueue.push(JSON.stringify(entry));
      if (llmWriteQueue.length >= 10) {
        if (llmFlushTimer) {
          clearTimeout(llmFlushTimer);
          llmFlushTimer = null;
        }
        void flushLlmWriteQueue();
      } else {
        scheduleLlmFlush();
      }
    } catch {}
  }

  return entry;
}

/**
 * Rehydrate LLM execution buffer dari file disk saat server baru boot/restart.
 */
export async function rehydrateLlmBuffer(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  try {
    ensureLogsDir();
    const todayPath = getLlmLogFilePath();
    const loadedRecords: LlmExecutionRecord[] = [];

    const readRecordsFromFile = async (filePath: string) => {
      if (!fs.existsSync(filePath)) return [];
      const content = await fs.promises.readFile(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const records: LlmExecutionRecord[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as LlmExecutionRecord;
          if (parsed.id && parsed.timestamp) {
            records.push(parsed);
          }
        } catch {}
      }
      return records;
    };

    const todayRecords = await readRecordsFromFile(todayPath);
    loadedRecords.push(...todayRecords);

    // Jika hari ini baru ada sedikit log LLM (< 50), ambil juga dari file kemarin
    if (loadedRecords.length < 50) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yesterdayPath = getLlmLogFilePath(yesterday);
      const yesterdayRecords = await readRecordsFromFile(yesterdayPath);
      loadedRecords.unshift(...yesterdayRecords);
    }

    if (loadedRecords.length > 0) {
      // Sort descending (newest first)
      loadedRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const recent = loadedRecords.slice(0, MAX_LLM_LOGS);

      // Merge with any entries currently in buffer
      const existing = [...llmExecutionBuffer];
      llmExecutionBuffer.length = 0;
      llmExecutionBuffer.push(...recent);
      for (const ex of existing) {
        if (!llmExecutionBuffer.some((b) => b.id === ex.id)) {
          llmExecutionBuffer.unshift(ex);
        }
      }
      if (llmExecutionBuffer.length > MAX_LLM_LOGS) {
        llmExecutionBuffer.splice(MAX_LLM_LOGS);
      }
    }
  } catch (err: any) {
    console.warn('[LLM LOGGER] Gagal rehydrate LLM buffer:', err.message);
  }
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
 * Normalisasi input customer — slot-engine sudah kirim teks bersih,
 * hanya trim + lepas quote luar.
 */
export function normalizeCustomerInput(input: string): string {
  if (!input) return '';
  return input.trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * Ambil riwayat log eksekusi LLM terkelompok secara hierarkis 3-Level:
 * Level 1: Nomor Telepon Customer
 * Level 2: Bubble Chat / Input Masuk Pasien
 * Level 3: Daftar Panggilan AI (Slot Extractor, Generator / Fast FAQ) untuk bubble tersebut
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
    SLOT_GENERATOR: 2,
    SLOT_FAST_FAQ: 2,
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

    // Urutkan tahapan AI: Extractor -> Generator / Fast FAQ
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

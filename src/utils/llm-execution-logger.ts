import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { hashPiiPhone } from './logger-sanitizer';

export type LlmFlowType =
  | 'NLU_EXTRACTOR'
  | 'SLOT_EXTRACTOR' // legacy alias NLU
  | 'V3_ROUTING' // Call 1: tool routing & intent
  | 'V3_GENERATION' // Call 2: natural reply generation
  | 'V3_REPROMPT' // Call 3+: hallucination correction
  | 'V3_AGENT' // legacy fallback (monolitik)
  | 'SLOT_GENERATOR' // legacy
  | 'SLOT_FAST_FAQ'; // legacy

export interface LlmExecutionRecord {
  id: string;
  timestamp: string;
  flowType: LlmFlowType;
  customerPhone?: string;
  customerName?: string;
  customerInput: string;
  /** ID kanonis satu turn inbound (aditif, opsional). */
  turnId?: string;
  tenantId?: string;
  conversationId?: string;
  /** Provider gateway aktual yang melayani call (WAHA bukan LLM; WABA tidak dipakai di sini). */
  actualProvider?: string;
  /** Model aktual yang benar-benar dipakai (bukan configured primary saat fallback). */
  actualModel?: string;
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
  errorMessage?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costIdr?: number;
  toolsCalled?: Array<{ name: string; args: any }>;
  callSequence?: number;
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
 * CG-09 (RC-09): mask nama customer agar tidak tersimpan mentah di JSONL.
 * Simpan hanya inisial + panjang (mis. "Bunda Sari" → "B*** S***").
 */
function maskCustomerName(name?: string): string {
  if (!name) return '';
  return String(name)
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : `${w[0]}${'*'.repeat(Math.min(w.length - 1, 3))}`))
    .join(' ');
}

/** Diekspor untuk testing (CG-09). */
export { maskCustomerName };

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
    // Jangan silent-drop: kembalikan chunk ke antrean agar tidak hilang diam-diam
    llmWriteQueue.unshift(...chunk);
  } finally {
    isLlmFlushing = false;
    if (llmWriteQueue.length > 0) {
      scheduleLlmFlush();
    }
  }
}

/**
 * Stage 8 (audit): flush sinkron antrean tulis JSONL saat shutdown.
 * Sebelumnya antrean memakai timer `unref` yang bisa hilang saat proses keluar
 * → berkas `llm-*.jsonl` 0-byte walau ada aktivitas. Panggil dari graceful shutdown.
 */
export async function flushLlmExecutionLogs(): Promise<void> {
  if (llmFlushTimer) {
    clearTimeout(llmFlushTimer);
    llmFlushTimer = null;
  }
  await flushLlmWriteQueue();
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
    turnId: data.turnId,
    tenantId: data.tenantId,
    conversationId: data.conversationId,
    actualProvider: data.actualProvider,
    actualModel: data.actualModel,
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
    errorMessage: data.errorMessage,
    promptTokens: data.promptTokens,
    completionTokens: data.completionTokens,
    cachedPromptTokens: data.cachedPromptTokens,
    reasoningTokens: data.reasoningTokens,
    totalTokens: data.totalTokens,
    costIdr: data.costIdr,
    toolsCalled: data.toolsCalled,
    callSequence: data.callSequence,
  };

  llmExecutionBuffer.unshift(entry);
  if (llmExecutionBuffer.length > MAX_LLM_LOGS) {
    llmExecutionBuffer.pop();
  }

  // Queue to background JSONL persistent file
  if (process.env.NODE_ENV !== 'test') {
    try {
      // CG-09 (RC-09): redact identitas PII HANYA pada berkas JSONL (at-rest).
      // Buffer in-memory tetap mentah agar UI admin bisa mengidentifikasi
      // customer saat sesi berjalan (data tidak persist).
      const persisted: LlmExecutionRecord = {
        ...entry,
        customerPhone: entry.customerPhone ? hashPiiPhone(entry.customerPhone) : entry.customerPhone,
        customerName: entry.customerName ? maskCustomerName(entry.customerName) : entry.customerName,
      };
      llmWriteQueue.push(JSON.stringify(persisted));
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

    // Tail-only: hanya 500 baris terakhir agar tidak membaca 10MB sinkron
    const readRecordsFromFile = async (filePath: string, maxLines = 500) => {
      if (!fs.existsSync(filePath)) return [];
      const content = await fs.promises.readFile(filePath, 'utf8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const lines = allLines.slice(-maxLines);
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
export function getLlmExecutionLogs(limit = 100, flowFilter?: string, tenantId?: string): LlmExecutionRecord[] {
  let logs = llmExecutionBuffer;
  if (tenantId && tenantId.trim()) {
    const t = tenantId.trim();
    logs = logs.filter((l) => l.tenantId === t);
  }
  if (flowFilter && flowFilter !== 'all') {
    if (flowFilter === 'V3_GENERATION') {
      // Direct Reply: DeepSeek menjawab langsung tanpa tool di Call 1.
      // Sertakan agar operator tak mengira bot gagal menghasilkan balasan
      // saat memfilter Reply Generation (Call 2).
      logs = logs.filter(
        (l) =>
          l.flowType === 'V3_GENERATION' ||
          (l.flowType === 'V3_ROUTING' && (!l.toolsCalled || l.toolsCalled.length === 0) && !!l.finalReply)
      );
    } else if (flowFilter === 'NLU_EXTRACTOR') {
      logs = logs.filter((l) => l.flowType === 'NLU_EXTRACTOR' || l.flowType === 'SLOT_EXTRACTOR');
    } else {
      logs = logs.filter((l) => l.flowType === flowFilter);
    }
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
export function getGroupedLlmExecutionLogs(limit = 100, flowFilter?: string, tenantId?: string): GroupedCustomerLlmLogs[] {
  const rawLogs = getLlmExecutionLogs(limit, flowFilter, tenantId);

  // Group by customer phone
  const phoneMap = new Map<string, LlmExecutionRecord[]>();
  for (const log of rawLogs) {
    const phone = log.customerPhone || 'Unknown / General';
    const list = phoneMap.get(phone) || [];
    list.push(log);
    phoneMap.set(phone, list);
  }

  const result: GroupedCustomerLlmLogs[] = [];

  // Korelasi JID kontak umum (xxx@c.us) BUKAN ID pesan spesifik —
  // jangan dipakai sebagai korelasi eksak lintas pesan.
  const isExactCorrelationId = (id?: string): boolean => {
    if (!id) return false;
    if (id.endsWith('@c.us') || id.endsWith('@g.us')) return false;
    return true;
  };

  const FLOW_ORDER: Record<string, number> = {
    NLU_EXTRACTOR: 1,
    SLOT_EXTRACTOR: 1,
    V3_ROUTING: 2,
    SLOT_GENERATOR: 2,
    SLOT_FAST_FAQ: 2,
    V3_GENERATION: 3,
    V3_REPROMPT: 4,
    V3_AGENT: 5,
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

      const hasExactId = isExactCorrelationId(log.bubbleCorrelationId);
      if (hasExactId && correlationMap.has(log.bubbleCorrelationId!)) {
        targetBubble = correlationMap.get(log.bubbleCorrelationId!)!;
      } else {
        // Fallback: cari di SELURUH bubbles dalam window 35 dtk (tahan out-of-order)
        // Window TETAP 35000 ms — hanya ketahanan urutan tiba yang diperbaiki
        for (const candidate of bubbles) {
          const isTimeClose = Math.abs(logTime - new Date(candidate.timestamp).getTime()) < 35000;
          if (!isTimeClose) continue;
          const isInputMatching =
            cleanInput === candidate.customerInput ||
            !cleanInput ||
            !candidate.customerInput ||
            cleanInput.includes(candidate.customerInput) ||
            candidate.customerInput.includes(cleanInput);
          if (!hasExactId && isTimeClose && isInputMatching) {
            targetBubble = candidate;
            break;
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
        if (isExactCorrelationId(log.bubbleCorrelationId)) {
          correlationMap.set(log.bubbleCorrelationId!, targetBubble);
        }
      } else {
        const bubbleHash = cleanInput ? crypto.createHash('md5').update(cleanInput).digest('hex').slice(0, 6) : log.id;
        const timeBucket = Math.floor(logTime / 30000);
        const exactId = isExactCorrelationId(log.bubbleCorrelationId) ? log.bubbleCorrelationId! : null;
        const deterministicId = exactId || `bubble_${phone.replace(/[^\w]/g, '_')}_${bubbleHash}_${timeBucket}`;

        const newBubble: GroupedBubbleChat = {
          correlationId: deterministicId,
          timestamp: log.timestamp,
          customerInput: cleanInput || log.customerInput || '(Input)',
          customerName: log.customerName,
          aiCalls: [log],
        };

        if (isExactCorrelationId(log.bubbleCorrelationId)) {
          correlationMap.set(log.bubbleCorrelationId!, newBubble);
        }
        bubbles.unshift(newBubble); // newest bubble first
      }
    }

    // Urutkan tahapan AI: NLU Extractor -> Routing (Call 1) -> Generation (Call 2) -> Reprompt
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
 * Mengosongkan memori + truncate berkas JSONL hari ini agar reboot tidak memunculkan data lama.
 */
export function clearLlmExecutionLogs(): void {
  llmExecutionBuffer.length = 0;
  llmWriteQueue.length = 0;
  try {
    ensureLogsDir();
    const todayPath = getLlmLogFilePath();
    if (fs.existsSync(todayPath)) {
      fs.writeFileSync(todayPath, '', 'utf8');
    }
  } catch {}
}

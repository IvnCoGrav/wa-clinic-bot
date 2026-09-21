import axios from 'axios';
import { ConversationState } from '@prisma/client';
import { CircuitBreaker } from '../../../utils/circuit-breaker';
import { ALL_V3_TOOLS } from '../../tools/tool-registry';
import { PersonaPromptBuilder, extractFastIntents, PERSONA_STABLE_PREFIX_MARKER } from '../persona';
import { buildCacheableSystemPrompt, buildCachedMessages } from '../../../integrations/llm/prompt-cache';
import { CustomerGoalSession } from '../../state/goal-tracker';
import { ContextGrounder, GroundingOutput } from './context-grounder';
import type { V3RetrievedChunk, AgentRunnerOutput } from '../agent-runner';

export const v3LlmCircuitBreaker = new CircuitBreaker(
  async (url: string, payload: any, headers: any) => {
    const response = await axios.post(url, payload, { headers, timeout: 15000 });
    return response.data;
  },
  async (url: string, payload: any, headers: any) => {
    // Fallback LINTAS-PROVIDER berjenjang (Tier 2 SumoPod -> Tier 3 DeepSeek Direct),
    // via resolver tier terpusat — bukan hardcode api.deepseek.com.
    const { resolveFallbackTiers } = await import('../../../integrations/llm/model-fallback');
    const tiers = resolveFallbackTiers();
    if (tiers.length === 0) {
      throw new Error('LLM circuit breaker fallback: tidak ada tier provider cadangan yang terkonfigurasi');
    }
    let lastErr: any;
    for (const tier of tiers) {
      try {
        const fallbackPayload = { ...payload, model: tier.model };
        const fallbackHeaders = { Authorization: `Bearer ${tier.apiKey}`, 'Content-Type': 'application/json' };
        console.warn(`[CIRCUIT BREAKER FALLBACK] Executing fallback to Tier ${tier.name} (${tier.model})...`);
        const fallbackResponse = await axios.post(`${tier.baseUrl}/chat/completions`, fallbackPayload, {
          headers: fallbackHeaders,
          timeout: 20000,
        });
        // Stage 8: tandai model/provider AKTUAL yang melayani (fallback), agar
        // observability tidak salah mengaitkan dengan model primary.
        const data = fallbackResponse.data;
        if (data && typeof data === 'object') {
          (data as any).__actualModel = tier.model;
          (data as any).__actualProvider = tier.name;
        }
        return data;
      } catch (e: any) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('LLM circuit breaker fallback: seluruh tier gagal');
  },
  {
    name: 'V3 LLM Primary Gateway',
    failureThreshold: 0.5,
    slidingWindowSize: 6,
    cooldownPeriodMs: 45000,
  }
);

/** Disclaimer resmi same-day dari tool (sumber kebenaran tunggal). */
export const SAME_DAY_DISCLAIMER =
  'Kalau hari ini kemungkinan jadwal kami penuh bunda. Untuk memastikan, kami coba cek jadwal dulu ya bund 😊🙏';

/**
 * Ekstraksi Chain-of-Thought universal + pembersihan artefak tag `<think>`.
 * Mendukung dua bentuk keluaran model penalaran (DeepSeek R1/Reasoner, dsb):
 *   1. Properti native `reasoning_content`.
 *   2. Tag inline `<think>...</think>` di dalam `content`.
 * Murni non-semantik: hanya memisahkan tag thinking AI dari teks balasan
 * (diizinkan mandat — bukan gatekeeper intent).
 */
export function extractReasoningAndCleanContent(msg: any): { reasoning: string | null; cleanContent: string } {
  let reasoning: string | null = null;
  let cleanContent = typeof msg?.content === 'string' ? msg.content : '';

  if (typeof msg?.reasoning_content === 'string' && msg.reasoning_content.trim()) {
    reasoning = msg.reasoning_content.trim();
  }

  if (/<think>/i.test(cleanContent)) {
    const match = cleanContent.match(/<think>([\s\S]*?)<\/think>/i);
    if (match) {
      if (!reasoning && match[1].trim()) reasoning = match[1].trim();
      cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }
  }

  return { reasoning, cleanContent };
}

/**
 * Ekstraksi telemetri usage lintas-provider.
 * - Token cache prompt: DeepSeek native `prompt_cache_hit_tokens` ATAU
 *   gaya OpenAI-compatible `prompt_tokens_details.cached_tokens`
 *   (dipakai proxy SumoPod/OpenRouter untuk model yang sama).
 * - Token penalaran: `completion_tokens_details.reasoning_tokens`.
 */
export function extractUsageTelemetry(usage: any): {
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
} {
  if (!usage || typeof usage !== 'object') return {};
  const promptTokens = Number(usage.prompt_tokens) || undefined;
  const completionTokens = Number(usage.completion_tokens) || undefined;
  const cachedRaw =
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cache_read_input_tokens ??
    0;
  const reasoningRaw = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const cachedPromptTokens = Number(cachedRaw) || 0;
  const reasoningTokens = Number(reasoningRaw) || 0;
  return {
    promptTokens,
    completionTokens,
    cachedPromptTokens: cachedPromptTokens > 0 ? cachedPromptTokens : undefined,
    reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
  };
}

/**
 * Status turn bersama yang di-threading lintas stage (menggantikan closure
 * monolitik): observability, messages LLM, dan akumulasi tool/chunks.
 */
export interface TurnState {
  tenantId: string;
  phone: string;
  conversationId: string;
  incomingText: string;
  selectedModel: string;
  baseUrl: string;
  apiKey: string;
  turnStartedAt: number;
  correlationId: string;
  /** ID kanonis turn inbound (aditif, opsional). */
  turnId?: string;
  /** Provider asal pesan (aditif, opsional). */
  provider?: 'WAHA' | 'WABA';
  /** Stage 8: model AKTUAL yang melayani (fallback bisa berbeda dari selected). */
  actualModelUsed?: string;
  totalTokens: { prompt: number; completion: number; total: number };
  currentSystemPrompt: string;
  messages: any[];
  executedTools: Array<{ name: string; args: any; result: any }>;
  retrievedChunks: V3RetrievedChunk[];
  fewShotExemplars: any[];
  reasoning: string | null;
  perCallLogged: boolean;
}

export interface RecordCallParams {
  flowType: 'V3_ROUTING' | 'V3_GENERATION' | 'V3_REPROMPT' | 'V3_AGENT';
  reply: string;
  status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
  durationMs: number;
  promptPayload?: any;
  callReasoning?: string | null;
  toolsCalled?: Array<{ name: string; args: any }>;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
  errorMessage?: string;
  callSequence?: number;
  groundTruth?: any;
}

export interface TurnTelemetry {
  addUsage: (usage: any) => void;
  auditUsage: (usage: any, startedAt: number, error?: any) => Promise<void>;
  finishCost: () => Promise<number>;
  recordCall: (params: RecordCallParams) => Promise<void>;
  traceExecution: (params: {
    reply: string;
    status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
    tools: Array<{ name: string; args: any; result: any }>;
  }) => Promise<void>;
}

export function createTelemetry(turn: TurnState): TurnTelemetry {
  const addUsage = (usage: any): void => {
    const p = Number(usage?.prompt_tokens) || 0;
    const c = Number(usage?.completion_tokens) || 0;
    turn.totalTokens.prompt += p;
    turn.totalTokens.completion += c;
    turn.totalTokens.total += p + c;
  };
  const auditUsage = async (usage: any, startedAt: number, error?: any): Promise<void> => {
    try {
      const { auditLlmCall } = await import('../../../utils/llm-audit-buffer');
      auditLlmCall({
        customer_phone: turn.phone,
        tenant_id: turn.tenantId,
        conversation_id: turn.conversationId,
        task_type: 'V3_AGENT',
        model_name: turn.selectedModel,
        baseUrl: turn.baseUrl,
        startedAt,
        error: error ?? null,
        usage: usage ?? null,
      });
    } catch {}
  };
  const calcCostFor = async (prompt: number, completion: number, cachedPrompt = 0): Promise<number> => {
    try {
      const { calculateLlmCost } = await import('../../../utils/cost-calculator');
      return calculateLlmCost(turn.selectedModel, prompt, completion, cachedPrompt, { baseUrl: turn.baseUrl }).totalCostIdr || 0;
    } catch {
      return 0;
    }
  };
  const finishCost = async (): Promise<number> => {
    try {
      const { calculateLlmCost } = await import('../../../utils/cost-calculator');
      return calculateLlmCost(turn.selectedModel, turn.totalTokens.prompt, turn.totalTokens.completion, 0, { baseUrl: turn.baseUrl }).totalCostIdr || 0;
    } catch {
      return 0;
    }
  };
  const recordCall = async (params: RecordCallParams): Promise<void> => {
    try {
      const { recordLlmExecution } = await import('../../../utils/llm-execution-logger');
      const p = params.promptTokens || 0;
      const c = params.completionTokens || 0;
      const cached = params.cachedPromptTokens || 0;
      recordLlmExecution({
        flowType: params.flowType as any,
        customerPhone: turn.phone,
        customerInput: turn.incomingText,
        turnId: turn.turnId,
        tenantId: turn.tenantId,
        conversationId: turn.conversationId,
        actualProvider: turn.provider,
        actualModel: turn.actualModelUsed || turn.selectedModel,
        bubbleCorrelationId: turn.correlationId,
        promptPayload: params.promptPayload || { model: turn.selectedModel, systemPrompt: turn.currentSystemPrompt, messageCount: turn.messages.length },
        reasoning: params.callReasoning !== undefined ? params.callReasoning : turn.reasoning,
        groundTruthUsed: params.groundTruth || {
          retrievedChunks: turn.retrievedChunks,
          fewShotExemplars: turn.fewShotExemplars.map((e) => ({ id: e.id, scenario: e.scenario })),
          executedTools: turn.executedTools.map((t) => t.name),
        },
        finalReply: params.reply,
        modelUsed: turn.actualModelUsed || turn.selectedModel,
        durationMs: params.durationMs,
        status: params.status,
        errorMessage: params.errorMessage,
        promptTokens: p || undefined,
        completionTokens: c || undefined,
        cachedPromptTokens: cached || undefined,
        reasoningTokens: params.reasoningTokens,
        totalTokens: p || c ? p + c : undefined,
        costIdr: p || c ? await calcCostFor(p, c, cached) : undefined,
        toolsCalled: params.toolsCalled,
        callSequence: params.callSequence,
      });
    } catch {}
  };
  const traceExecution = async (params: {
    reply: string;
    status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
    tools: Array<{ name: string; args: any; result: any }>;
  }): Promise<void> => {
    await recordCall({
      flowType: 'V3_AGENT',
      reply: params.reply,
      status: params.status,
      durationMs: Date.now() - turn.turnStartedAt,
      toolsCalled: params.tools.map((t) => ({ name: t.name, args: t.args })),
      promptTokens: turn.totalTokens.prompt || undefined,
      completionTokens: turn.totalTokens.completion || undefined,
    });
  };
  return { addUsage, auditUsage, finishCost, recordCall, traceExecution };
}

export interface RoutingOutput {
  assistantMessage: any;
  toolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string | any } }>;
  reasoning: string | null;
  /** ST6 (RC-05): verdict komitmen semantik dari Call 1 (opsional). */
  commitment?: 'EXPLORING' | 'CONSIDERING' | 'COMMITTED' | null;
}

/** Persistensi INBOUND/OUTBOUND turn (dilewati bila skipDbLogging). */
export async function persistTurnMessages(opts: {
  tenantId: string;
  conversationId: string;
  skipDbLogging?: boolean;
  originalText?: string;
  incomingText: string;
  finalReply: string;
  isEscalated: boolean;
}): Promise<void> {
  if (!opts.conversationId || opts.skipDbLogging) return;
  try {
    const { messageService } = await import('../../../services/message.service');
    const { Direction } = await import('@prisma/client');
    await messageService.logMessage({
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      direction: Direction.INBOUND,
      content: opts.originalText || opts.incomingText,
    });
    if (opts.finalReply && !opts.isEscalated) {
      await messageService.logMessage({
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        direction: Direction.OUTBOUND,
        content: opts.finalReply,
      });
    }
  } catch (e) {}
}

/** Jalur error turn (Fase B): audit + trace ERROR + eskalasi sunyi. */
export async function reportTurnError(
  turn: TurnState,
  session: CustomerGoalSession,
  err: any,
  incomingText: string,
  bubbleCorrelationId?: string
): Promise<AgentRunnerOutput> {
  const { maskPhoneNumber } = await import('../../../utils/pii-masker');
  console.error(JSON.stringify({ event: 'V3_AGENT_RUNNER_ERROR', tenantId: turn.tenantId, conversationId: turn.conversationId, phone: maskPhoneNumber(turn.phone), error: err.response?.data || err.message, timestamp: new Date().toISOString() }));
  const errorDetails =
    err?.response?.data?.error?.message ||
    (typeof err?.response?.data === 'string' ? err.response.data : null) ||
    err?.response?.data?.message ||
    err?.message ||
    'Unknown LLM execution error';
  const safeErrorMessage = String(errorDetails).slice(0, 500);
  try {
    const { auditLlmCall } = await import('../../../utils/llm-audit-buffer');
    auditLlmCall({
      customer_phone: turn.phone,
      tenant_id: turn.tenantId,
      conversation_id: turn.conversationId,
      task_type: 'V3_AGENT',
      model_name: turn.selectedModel,
      baseUrl: turn.baseUrl,
      startedAt: turn.turnStartedAt,
      error: { message: err?.message || 'V3_AGENT_ERROR' },
      usage: null,
    });
  } catch {}
  try {
    const { recordLlmExecution } = await import('../../../utils/llm-execution-logger');
    recordLlmExecution({
      flowType: 'V3_AGENT' as any,
      customerPhone: turn.phone,
      customerInput: incomingText,
      bubbleCorrelationId: bubbleCorrelationId || `${turn.phone}_${Date.now()}`,
      promptPayload: { model: turn.selectedModel, baseUrl: turn.baseUrl, messages: turn.messages.slice(-2) },
      reasoning: turn.reasoning,
      finalReply: '',
      modelUsed: turn.selectedModel,
      durationMs: Date.now() - turn.turnStartedAt,
      status: 'ERROR',
      errorMessage: safeErrorMessage,
    });
  } catch {}
  return {
    replyText: '',
    executedTools: [],
    updatedSession: session,
    shouldSendReply: false,
    isEscalated: true,
    retrievedChunks: turn.retrievedChunks,
    fewShotExemplars: turn.fewShotExemplars,
    systemPrompt: turn.currentSystemPrompt,
    reasoning: turn.reasoning,
    tokens: { ...turn.totalTokens },
    costIdr: 0,
    nextState: ConversationState.HUMAN_HANDLING,
  };
}

export interface GenerationOutput {
  finalReply: string;
  reasoning: string | null;
  contextSummary: string;
  phaseDirective: string;
}

/**
 * Stage 4 — GenerationStage: Call 1 (Router LLM) dan Call 2 (Persona
 * Synthesis LLM). Merakit prompt via PersonaPromptBuilder.
 */
export class GenerationStage {
  /** Transport LLM publik (static agar seam mock test lestari via spyOn). */
  public static async executeChatCompletion(params: {
    payload: any;
    tenantId: string;
    phone: string;
    conversationId: string;
    baseUrl: string;
    apiKey: string;
    selectedModel: string;
  }): Promise<any> {
    const url = `${params.baseUrl}/chat/completions`;
    const headers = { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' };
    return await v3LlmCircuitBreaker.execute(url, params.payload, headers);
  }

  public static async routeTools(
    turn: TurnState,
    tel: TurnTelemetry,
    opts: {
      cleanIncomingText: string;
      session: CustomerGoalSession;
      messages: any[];
      grounding: GroundingOutput;
      conversationHistory?: Array<{ role: string; content: string }>;
    }
  ): Promise<RoutingOutput> {
    const { cleanIncomingText, messages, grounding, session, conversationHistory = [] } = opts;
    // 4. Panggilan Pertama: Model mengevaluasi apakah perlu memanggil Tools
    const detectedIntents = extractFastIntents(cleanIncomingText);

    // Autonomous tool routing: hanya lokasi yang di-forcing deterministik
    // (ongkir wajib hitung via calculate_delivery). Pertanyaan harga/konsultasi/FAQ
    // dibiarkan 'auto' agar Call 1 bebas memilih get_catalog_and_price ATAU
    // search_knowledge_faq sesuai kebutuhan — forcing katalog berbasis substring
    // "berapa" sebelumnya memblokir pemanggilan FAQ (mis. "berapa minggu ... induksi?").
    let dynamicToolChoice: any = 'auto';

    // Prioritaskan lokasi (ongkir) bila gazetteer match, karena kalimat "berapa ongkir ke X"
    // mengandung dua sinyal (ask_price + provide_location) namun intent utamanya adalah cek ongkir
    if (detectedIntents.includes('provide_location')) {
      dynamicToolChoice = { type: 'function', function: { name: 'calculate_delivery' } };
    } else if (grounding.hasFallInjury) {
      // Audit 337101 (pediatric safety): trauma jatuh WAJIB grounding SOP
      // skrining — setara prioritas forcing lokasi/vaksin. Mencegah LLM
      // mencatut artikel mandi/relaksasi untuk kasus trauma fisik.
      dynamicToolChoice = { type: 'function', function: { name: 'search_knowledge_faq' } };
    } else if (grounding.hasVaccineSignal) {
      // Audit 222655 (fatal medical error): pertanyaan imunisasi/vaksinasi
      // WAJIB di-grounding SOP pasca-vaksin deterministik (clinical safety —
      // setara prioritasnya dengan forcing lokasi). Mencegah LLM mencatut
      // artikel mandi untuk menjawab soal vaksin.
      dynamicToolChoice = { type: 'function', function: { name: 'get_clinic_policy_faq' } };
    } else if (ContextGrounder.isBookingCommitReady(session, cleanIncomingText, conversationHistory)) {
      // Audit sesi 614425 (booking buntu): treatment sudah disepakati DAN customer
      // sudah menyebut hari/tanggal → Paksa save_reservation, jangan serahkan
      // keputusan commit ke judgment LLM (akar masalah: model buntu lalu
      // menanyakan jam spesifik yang justru dilarang).
      dynamicToolChoice = { type: 'function', function: { name: 'save_reservation' } };
    } else if (detectedIntents.includes('ask_duration')) {
      // Fase 4' (Turn 4: "durasi pijatnya berapa lama?"): paksa
      // get_catalog_and_price agar durasi datang dari katalog DB per-tenant
      // (bukan karangan "40 menit") — memakai sinyal intent eksisting,
      // tanpa deteksi keyword baru.
      dynamicToolChoice = { type: 'function', function: { name: 'get_catalog_and_price' } };
    }

    // Tool-Masking Evaluation (FASE 2, SHADOW MODE)
    const { evaluateToolMasking } = await import('../../tools/tool-masker');
    const { isToolMaskingEnforced } = await import('../../../config/feature-flags');
    const maskingEval = evaluateToolMasking(ALL_V3_TOOLS, session, cleanIncomingText, conversationHistory);

    // Tool Schema Filtering untuk Call 1:
    // Jika di-forcing ke 1 tool spesifik, kirim HANYA tool tersebut (hemat ~1.500 token).
    // Jika enforce mode aktif: kirim maskingEval.availableTools.
    // Jika shadow mode (default): kirim ALL_V3_TOOLS (perilaku produksi utuh).
    const baseToolsForCall1 = isToolMaskingEnforced() ? maskingEval.availableTools : ALL_V3_TOOLS;
    // Fase 6 K4 — telemetri cutover: catat setiap turn di mana enforce aktif
    // memangkas tool (fail-safe: logging DILARANG menggagalkan turn).
    if (isToolMaskingEnforced() && maskingEval.maskedToolNames.length > 0) {
      try {
        console.log(JSON.stringify({
          event: 'TOOL_MASKING_ENFORCED_APPLIED',
          tenantId: turn.tenantId,
          conversationId: turn.conversationId,
          maskedTools: maskingEval.maskedToolNames,
          maskingReason: maskingEval.reason,
          toolsSent: baseToolsForCall1.map((t: any) => t?.function?.name || t?.name),
          timestamp: new Date().toISOString(),
        }));
      } catch {}
    }
    let toolsForCall1: any[] = baseToolsForCall1;
    if (typeof dynamicToolChoice === 'object' && dynamicToolChoice?.function?.name) {
      const forcedName = dynamicToolChoice.function.name;
      const matchingTool = baseToolsForCall1.find((t: any) => t.function?.name === forcedName);
      if (matchingTool) {
        toolsForCall1 = [matchingTool];
      } else {
        // Tool yang di-forcing ternyata di-mask gate pre-LLM (mis. lokasi
        // disebut tapi tanpa entitas baru) — turunkan ke 'auto' agar LLM tak
        // dipaksa memanggil tool yang fisiknya absen dari skema.
        dynamicToolChoice = 'auto';
      }
    }

    const firstPayload: any = {
      model: turn.selectedModel,
      messages,
      tools: toolsForCall1,
      tool_choice: dynamicToolChoice,
      parallel_tool_calls: false, // MANDAT ATOMIC ROUTING (audit 993955): 1 turn WhatsApp = maksimal 1 tool utama.
      temperature: 0.2,
    };

    const firstStartedAt = Date.now();
    const firstData = await GenerationStage.executeChatCompletion({
      payload: firstPayload,
      tenantId: turn.tenantId,
      phone: turn.phone,
      conversationId: turn.conversationId,
      baseUrl: turn.baseUrl,
      apiKey: turn.apiKey,
      selectedModel: turn.selectedModel,
    }).then(async (data) => {
      tel.addUsage((data as any)?.usage);
      await tel.auditUsage((data as any)?.usage, firstStartedAt);
      if ((data as any)?.__actualModel) turn.actualModelUsed = (data as any).__actualModel;
      return data;
    });

    const choice = firstData?.choices?.[0];
    const assistantMessage = choice?.message;
    let toolCalls = assistantMessage?.tool_calls;
    const { reasoning: callReasoning, cleanContent } = extractReasoningAndCleanContent(assistantMessage);
    let reasoning = turn.reasoning;
    if (!reasoning && callReasoning) {
      reasoning = callReasoning;
      turn.reasoning = reasoning;
    }

    // Tracing Call 1 (Tool Routing): latensi bersih model + token/biaya per-call
    let parsedCalls = Array.isArray(toolCalls)
      ? toolCalls.map((tc: any) => {
          let a: any = {};
          try {
            a = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
          } catch {}
          return { name: tc.function?.name || 'unknown', args: a, _raw: tc };
        })
      : [] as any;
    // Atomic Routing: 1 turn = 1 tool utama (mitigasi parallel spraying).
    // Prioritas berpegang pada gate sistem (bukan hafalan pola): coverage la
    // pembatas jangkauan (luar area → tolak) setara kunci keamanan bisnis,
    // MAKA lebih diutamakan daripada quote harga/katalog bila sama-sama
    // diminta router. Rujukan: dynamicToolChoice (baris 410) menetapkan
    // calculate_delivery sebagai intent utama kala lokasi disebut.
    let pruned = false;
    if (parsedCalls.length > 1) {
      const pick = (n: string) => parsedCalls.find((c: any) => c.name === n);
      const primary = pick('calculate_delivery') || pick('get_catalog_and_price') || pick('get_clinic_policy_faq') || parsedCalls[0];
      console.warn(JSON.stringify({ event: 'PARALLEL_TOOL_CALLS_PRUNED', pruned: parsedCalls.map((c: any) => c.name), kept: primary.name, timestamp: new Date().toISOString() }));
      parsedCalls = [primary];
      // Sinkronkan toolCalls mentah agar eksekusi hanya 1 (jangan reassign
      // binding let/const_ — mutasi array langsung + perbarui assistantMessage).
      if (Array.isArray(toolCalls)) {
        const keptRaw = (primary as any)._raw;
        const keptCalls = keptRaw ? [keptRaw] : toolCalls.slice(0, 1);
        toolCalls.length = 0;
        toolCalls.push(...keptCalls);
        assistantMessage.tool_calls = toolCalls;
      }
      pruned = true;
    }
    // Hapus _raw helper sebelum tracing
    parsedCalls = parsedCalls.map(({ _raw, ...rest }: any) => rest);

    {
      const firstDurationMs = Date.now() - firstStartedAt;
      const firstUsageTel = extractUsageTelemetry((firstData as any)?.usage);
      await tel.recordCall({
        flowType: 'V3_ROUTING',
        reply: parsedCalls.length > 0
          ? `[Memanggil Tool: ${parsedCalls.map((t: any) => t.name).join(', ')}]`
          : cleanContent,
        status: 'SUCCESS',
        durationMs: firstDurationMs,
        promptPayload: { model: turn.selectedModel, systemPrompt: turn.currentSystemPrompt, messages: messages.slice(1), tools: toolsForCall1 },
        callReasoning: reasoning,
        toolsCalled: parsedCalls,
        promptTokens: firstUsageTel.promptTokens,
        completionTokens: firstUsageTel.completionTokens,
        cachedPromptTokens: firstUsageTel.cachedPromptTokens,
        reasoningTokens: firstUsageTel.reasoningTokens,
        callSequence: 1,
      });
      turn.perCallLogged = true;
    }

    // ST6 (RC-05): verdict komitmen semantik dari Call 1 (dipakai log + veto cart).
    const commitmentVerdict: 'EXPLORING' | 'CONSIDERING' | 'COMMITTED' | null =
      (parsedCalls.find((t: any) => t?.args?.commitment) as any)?.args?.commitment || null;

    // Telemetri Shadow Evaluation (FASE 2, SHADOW MODE)
    try {
      const calledToolNames = parsedCalls.map((t: any) => t.name);
      const isSaveCalled = calledToolNames.includes('save_reservation');

      // ST6 shadow (RC-05): catat verdict komitmen dari Call 1.
      try {
        const { maskPhoneNumber } = await import('../../../utils/pii-masker');
        console.log(JSON.stringify({
          event: 'ROUTER_COMMITMENT_VERDICT',
          tenantId: turn.tenantId,
          conversationId: turn.conversationId,
          phone: maskPhoneNumber(turn.phone),
          commitment: commitmentVerdict,
          calledTools: calledToolNames,
          timestamp: new Date().toISOString(),
        }));
      } catch {}
      let classification: string;
      if (!maskingEval.isSaveReservationAllowed && isSaveCalled) {
        classification = 'LLM_OVER_TRIGGER';
      } else if (!maskingEval.isSaveReservationAllowed && maskingEval.suspectOverRestrictive) {
        classification = 'MASKER_OVER_RESTRICTIVE_SUSPECT';
      } else if (!maskingEval.isSaveReservationAllowed && !isSaveCalled) {
        classification = 'ALIGNED_BLOCKED';
      } else if (maskingEval.isSaveReservationAllowed && isSaveCalled) {
        classification = 'ALIGNED_ALLOWED';
      } else {
        classification = 'LLM_UNDER_TRIGGER';
      }

      const { maskPhoneNumber } = await import('../../../utils/pii-masker');
      console.log(JSON.stringify({
        event: 'TOOL_MASKING_SHADOW_EVAL',
        tenantId: turn.tenantId,
        conversationId: turn.conversationId,
        phone: maskPhoneNumber(turn.phone),
        isSaveReservationAllowed: maskingEval.isSaveReservationAllowed,
        maskedTools: maskingEval.maskedToolNames,
        maskingReason: maskingEval.reason,
        calledTools: calledToolNames,
        classification,
        suspectOverRestrictive: maskingEval.suspectOverRestrictive,
        timestamp: new Date().toISOString(),
      }));
    } catch {}

    return { assistantMessage, toolCalls, reasoning, commitment: commitmentVerdict };
  }

  public static async generateReply(
    turn: TurnState,
    tel: TurnTelemetry,
    opts: {
      session: CustomerGoalSession;
      isFollowUp: boolean;
      cleanIncomingText: string;
      conversationHistory: Array<{ role: string; content: string }>;
      messages: any[];
      preGroundingBlock: string;
      tenantId: string;
    }
  ): Promise<GenerationOutput> {
    const { session, isFollowUp, cleanIncomingText, conversationHistory, messages, preGroundingBlock, tenantId } = opts;
    // 6. Panggilan Kedua: Menyusun teks balasan ramah Bidan Yusi menggunakan fakta tool
    // Perbarui system prompt di messages[0] dengan session terbaru yang telah di-grounding hasil tools
    // (async agar blok contoh dinamis bank tetap dipakai, bukan revert ke statis).
    const refreshedPrompt = await PersonaPromptBuilder.buildSystemPromptAsync(session, isFollowUp, {
      tenantId,
      incomingText: cleanIncomingText,
    });
    turn.fewShotExemplars = refreshedPrompt.exemplars;

    // Tempel ulang ringkasan + phase directive dari session terbaru
    const contextSummary = ContextGrounder.buildContextSummary(session, cleanIncomingText, conversationHistory);
    const phaseDirective = ContextGrounder.buildPhaseDirective(
      ContextGrounder.deriveConversationPhase(session, isFollowUp),
      session
    );

    // Sesi 462651: penanda reservasi same-day turn ini (dipakai direktif
    // Call 2 + safety-net disclaimer pasca-generasi di bawah).
    const saveReservationSuccess = turn.executedTools.find(
      (t) => t?.name === 'save_reservation' && (t as any)?.result?.success === true
    );

    const fullSystemPromptParts = [
      refreshedPrompt.systemPrompt,
      contextSummary,
      phaseDirective,
      preGroundingBlock,
    ].filter(Boolean);
    // Plan Fase 4 (sesi 89-turn, DSML bleeding): lapis SEKUNDER setelah
    // sanitizer diperbaiki — deklarasi peran Call 2 sebagai penghasil bahasa
    // natural murni. Gerbang utama tetap sanitizer (kode), bukan kepatuhan ini.
    fullSystemPromptParts.push(
      '[PERAN GENERASI JAWABAN (CALL 2)]: Tugas Anda HANYA menyusun balasan percakapan ramah dalam bahasa Indonesia untuk Bunda berdasarkan data resmi tool di atas. Seluruh pemanggilan data/tool SUDAH SELESAI di tahap sebelumnya — DILARANG memanggil fungsi, mengeluarkan sintaks tool, XML, atau tag khusus model apa pun dalam balasan.'
    );
    if (saveReservationSuccess && (saveReservationSuccess as any).result?.isSameDay === true) {
      fullSystemPromptParts.push(
        `[MANDAT SAME-DAY BOOKING — WAJIB DIPATUHI (sesi 462651)]: Customer meminta jadwal HARI INI. Balasan WAJIB memuat kalimat disclaimer resmi dari tool: "${SAME_DAY_DISCLAIMER}". DILARANG membuang atau memperhalus kalimat kemungkinan jadwal penuh — ekspektasi customer WAJIB diturunkan.`
      );
    }
    const fullSystemPrompt = fullSystemPromptParts.join('\n\n');

    // PLAN 9 FASE 9.1 — Prompt caching: pisahkan prefix statis (byte-stabil) dari
    // tail dinamis, lalu susun messages dengan anotasi cache bila provider mendukung.
    // Provider non-pendukung → digabung kembali, byte-identik dengan perilaku lama.
    // PENTING: objek riwayat (termasuk pesan tool/assistant dengan tool_calls dan
    // tool_call_id) diteruskan utuh tanpa pemangkasan field agar kontinuitas tool tetap valid.
    const cacheParts = buildCacheableSystemPrompt(fullSystemPrompt, PERSONA_STABLE_PREFIX_MARKER);
    const cachedMessages = buildCachedMessages(cacheParts, turn.baseUrl, messages.slice(1));

    // Pertahankan mutasi messages[0] untuk kompatibilitas observability downstream
    // (telemetry mencatat messages.slice(1); turn.currentSystemPrompt dipakai guardrail).
    messages[0].content = fullSystemPrompt;
    turn.currentSystemPrompt = fullSystemPrompt;

    const secondPayload: any = {
      model: turn.selectedModel,
      messages: cachedMessages,
      temperature: 0.65,
    };

    const secondStartedAt = Date.now();
    const secondData = await GenerationStage.executeChatCompletion({
      payload: secondPayload,
      tenantId: turn.tenantId,
      phone: turn.phone,
      conversationId: turn.conversationId,
      baseUrl: turn.baseUrl,
      apiKey: turn.apiKey,
      selectedModel: turn.selectedModel,
    }).then(async (data) => {
      tel.addUsage((data as any)?.usage);
      await tel.auditUsage((data as any)?.usage, secondStartedAt);
      if ((data as any)?.__actualModel) turn.actualModelUsed = (data as any).__actualModel;
      return data;
    });

    const secondMessage = secondData?.choices?.[0]?.message;
    const { reasoning: secondCallReasoning, cleanContent: cleanSecondContent } = extractReasoningAndCleanContent(secondMessage);
    let finalReply = cleanSecondContent;

    // Fase 1 (observability, sesi 648324): deteksi kebocoran tag tool-call DSML di Call 2.
    // Call 2 adalah tahap sintesis bahasa alami akhir — tidak boleh memanggil tool.
    // Jika output mentah mengandung tag DSML tetapi hasil bersih kosong, catat
    // sebagai event observability tanpa mengubah balasan (perilaku tidak diubah).
    try {
      const rawSecondContent = typeof (secondMessage as any)?.content === 'string' ? (secondMessage as any).content : '';
      const isPureDsmlLeak = /<｜｜DSML｜｜/i.test(rawSecondContent) && !cleanSecondContent.trim();
      if (isPureDsmlLeak) {
        console.warn(JSON.stringify({
          event: 'CALL2_DSML_LEAKAGE_INTERCEPTED',
          tenantId: turn.tenantId,
          conversationId: turn.conversationId,
          rawContent: rawSecondContent.slice(0, 150),
          timestamp: new Date().toISOString(),
        }));
      }
    } catch {}
    if (!turn.reasoning && secondCallReasoning) {
      turn.reasoning = secondCallReasoning;
    }

    // Plan 7 (Audit 216683 - Garansi Sapaan Resmi Turn-0):
    // Jika turn ini adalah chat pembuka (!isFollowUp), pastikan sapaan resmi Bidan Yusi
    // tidak terlewat akibat penjiplakan template tool (mis. calculate_delivery suggestedTemplateReply).
    if (!isFollowUp && finalReply) {
      const lower = finalReply.toLowerCase();
      const hasGreeting = lower.includes('bidan yusi') || lower.includes('perkenalkan, saya bidan') || lower.includes('perkenalkan saya bidan');
      if (!hasGreeting) {
        const { getBrandIdentity } = await import('../../../config/brand');
        const brand = getBrandIdentity();
        const greeting = session.genderGreeting || 'Bunda';
        const greetingPrefix = `Halo ${greeting}! ✨ Perkenalkan, saya Bidan Yusi dari ${brand.businessName}.\n\n`;
        finalReply = greetingPrefix + finalReply.trimStart();
      }
    }
    // Tracing Call 2 (Response Generation): latensi bersih + grounding yang dipakai
    {
      const secondDurationMs = Date.now() - secondStartedAt;
      const secondUsageTel = extractUsageTelemetry((secondData as any)?.usage);
      const secondReasoning = secondCallReasoning || turn.reasoning;
      await tel.recordCall({
        flowType: 'V3_GENERATION',
        reply: finalReply,
        status: 'SUCCESS',
        durationMs: secondDurationMs,
        promptPayload: { model: turn.selectedModel, systemPrompt: fullSystemPrompt, messages: messages.slice(1) },
        callReasoning: secondReasoning,
        toolsCalled: turn.executedTools.map((t) => ({ name: t.name, args: t.args })),
        promptTokens: secondUsageTel.promptTokens,
        completionTokens: secondUsageTel.completionTokens,
        cachedPromptTokens: secondUsageTel.cachedPromptTokens,
        reasoningTokens: secondUsageTel.reasoningTokens,
        callSequence: 2,
        groundTruth: {
          executedTools: turn.executedTools.map((t) => t.name),
          retrievedChunks: turn.retrievedChunks,
        },
      });
    }
    return { finalReply, reasoning: turn.reasoning, contextSummary, phaseDirective };
  }
}

import axios from 'axios';
import { ConversationState } from '@prisma/client';
import { CircuitBreaker } from '../../../utils/circuit-breaker';
import { ALL_V3_TOOLS } from '../../tools/tool-registry';
import { PersonaPromptBuilder, extractFastIntents } from '../persona';
import { CustomerGoalSession } from '../../state/goal-tracker';
import { ContextGrounder, GroundingOutput } from './context-grounder';
import type { V3RetrievedChunk, AgentRunnerOutput } from '../agent-runner';

export const v3LlmCircuitBreaker = new CircuitBreaker(
  async (url: string, payload: any, headers: any) => {
    const response = await axios.post(url, payload, { headers, timeout: 15000 });
    return response.data;
  },
  async (url: string, payload: any, headers: any) => {
    const fallbackApiKey = process.env.LLM_FALLBACK_API_KEY || '';
    const fallbackBaseUrl = (process.env.LLM_FALLBACK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const fallbackModel = process.env.AI_MODEL_FALLBACK || 'deepseek-chat';
    const fallbackPayload = { ...payload, model: fallbackModel };
    const fallbackHeaders = { Authorization: `Bearer ${fallbackApiKey}`, 'Content-Type': 'application/json' };
    console.warn(`[CIRCUIT BREAKER FALLBACK] Executing fallback to ${fallbackModel}...`);
    if (!fallbackApiKey) {
      throw new Error('LLM_FALLBACK_API_KEY not configured');
    }
    const fallbackResponse = await axios.post(`${fallbackBaseUrl}/chat/completions`, fallbackPayload, {
      headers: fallbackHeaders,
      timeout: 20000,
    });
    return fallbackResponse.data;
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
  const calcCostFor = async (prompt: number, completion: number): Promise<number> => {
    try {
      const { calculateLlmCost } = await import('../../../utils/cost-calculator');
      return calculateLlmCost(turn.selectedModel, prompt, completion, 0).totalCostIdr || 0;
    } catch {
      return 0;
    }
  };
  const finishCost = async (): Promise<number> => {
    try {
      const { calculateLlmCost } = await import('../../../utils/cost-calculator');
      return calculateLlmCost(turn.selectedModel, turn.totalTokens.prompt, turn.totalTokens.completion, 0).totalCostIdr || 0;
    } catch {
      return 0;
    }
  };
  const recordCall = async (params: RecordCallParams): Promise<void> => {
    try {
      const { recordLlmExecution } = await import('../../../utils/llm-execution-logger');
      const p = params.promptTokens || 0;
      const c = params.completionTokens || 0;
      recordLlmExecution({
        flowType: params.flowType as any,
        customerPhone: turn.phone,
        customerInput: turn.incomingText,
        bubbleCorrelationId: turn.correlationId,
        promptPayload: params.promptPayload || { model: turn.selectedModel, systemPrompt: turn.currentSystemPrompt, messageCount: turn.messages.length },
        reasoning: params.callReasoning !== undefined ? params.callReasoning : turn.reasoning,
        groundTruthUsed: params.groundTruth || {
          retrievedChunks: turn.retrievedChunks,
          fewShotExemplars: turn.fewShotExemplars.map((e) => ({ id: e.id, scenario: e.scenario })),
          executedTools: turn.executedTools.map((t) => t.name),
        },
        finalReply: params.reply,
        modelUsed: turn.selectedModel,
        durationMs: params.durationMs,
        status: params.status,
        promptTokens: p || undefined,
        completionTokens: c || undefined,
        totalTokens: p || c ? p + c : undefined,
        costIdr: p || c ? await calcCostFor(p, c) : undefined,
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
      promptPayload: { model: turn.selectedModel },
      reasoning: turn.reasoning,
      finalReply: '',
      modelUsed: turn.selectedModel,
      durationMs: Date.now() - turn.turnStartedAt,
      status: 'ERROR',
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
    }
  ): Promise<RoutingOutput> {
    const { cleanIncomingText, messages, grounding } = opts;
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
    }

    // Tool Schema Filtering untuk Call 1:
    // Jika di-forcing ke 1 tool spesifik, kirim HANYA tool tersebut (hemat ~1.500 token).
    // Jika 'auto', kirim seluruh ALL_V3_TOOLS agar router bebas memilih.
    let toolsForCall1: any[] = ALL_V3_TOOLS;
    if (typeof dynamicToolChoice === 'object' && dynamicToolChoice?.function?.name) {
      const forcedName = dynamicToolChoice.function.name;
      const matchingTool = ALL_V3_TOOLS.find((t: any) => t.function?.name === forcedName);
      if (matchingTool) {
        toolsForCall1 = [matchingTool];
      }
    }

    const firstPayload: any = {
      model: turn.selectedModel,
      messages,
      tools: toolsForCall1,
      tool_choice: dynamicToolChoice,
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
      return data;
    });

    const choice = firstData?.choices?.[0];
    const assistantMessage = choice?.message;
    const toolCalls = assistantMessage?.tool_calls;
    let reasoning = turn.reasoning;
    if (!reasoning && typeof (assistantMessage as any)?.reasoning_content === 'string') {
      reasoning = (assistantMessage as any).reasoning_content;
      turn.reasoning = reasoning;
    }

    // Tracing Call 1 (Tool Routing): latensi bersih model + token/biaya per-call
    {
      const firstDurationMs = Date.now() - firstStartedAt;
      const firstUsage: any = (firstData as any)?.usage;
      const parsedCalls = Array.isArray(toolCalls)
        ? toolCalls.map((tc: any) => {
            let a: any = {};
            try {
              a = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
            } catch {}
            return { name: tc.function?.name || 'unknown', args: a };
          })
        : [];
      await tel.recordCall({
        flowType: 'V3_ROUTING',
        reply: parsedCalls.length > 0
          ? `[Memanggil Tool: ${parsedCalls.map((t) => t.name).join(', ')}]`
          : assistantMessage?.content || '',
        status: 'SUCCESS',
        durationMs: firstDurationMs,
        promptPayload: { model: turn.selectedModel, systemPrompt: turn.currentSystemPrompt, messages: messages.slice(1), tools: toolsForCall1 },
        callReasoning: reasoning,
        toolsCalled: parsedCalls,
        promptTokens: Number(firstUsage?.prompt_tokens) || undefined,
        completionTokens: Number(firstUsage?.completion_tokens) || undefined,
        callSequence: 1,
      });
      turn.perCallLogged = true;
    }

    return { assistantMessage, toolCalls, reasoning };
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
    if (saveReservationSuccess && (saveReservationSuccess as any).result?.isSameDay === true) {
      fullSystemPromptParts.push(
        `[MANDAT SAME-DAY BOOKING — WAJIB DIPATUHI (sesi 462651)]: Customer meminta jadwal HARI INI. Balasan WAJIB memuat kalimat disclaimer resmi dari tool: "${SAME_DAY_DISCLAIMER}". DILARANG membuang atau memperhalus kalimat kemungkinan jadwal penuh — ekspektasi customer WAJIB diturunkan.`
      );
    }
    const fullSystemPrompt = fullSystemPromptParts.join('\n\n');

    messages[0].content = fullSystemPrompt;
    turn.currentSystemPrompt = fullSystemPrompt;

    const secondPayload: any = {
      model: turn.selectedModel,
      messages,
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
      return data;
    });

    let finalReply = secondData?.choices?.[0]?.message?.content || '';
    if (!turn.reasoning && typeof (secondData?.choices?.[0]?.message as any)?.reasoning_content === 'string') {
      turn.reasoning = (secondData.choices[0].message as any).reasoning_content;
    }
    // Tracing Call 2 (Response Generation): latensi bersih + grounding yang dipakai
    {
      const secondDurationMs = Date.now() - secondStartedAt;
      const secondUsage: any = (secondData as any)?.usage;
      const secondReasoning = typeof (secondData?.choices?.[0]?.message as any)?.reasoning_content === 'string'
        ? (secondData.choices[0].message as any).reasoning_content
        : turn.reasoning;
      await tel.recordCall({
        flowType: 'V3_GENERATION',
        reply: finalReply,
        status: 'SUCCESS',
        durationMs: secondDurationMs,
        promptPayload: { model: turn.selectedModel, systemPrompt: fullSystemPrompt, messages: messages.slice(1) },
        callReasoning: secondReasoning,
        toolsCalled: turn.executedTools.map((t) => ({ name: t.name, args: t.args })),
        promptTokens: Number(secondUsage?.prompt_tokens) || undefined,
        completionTokens: Number(secondUsage?.completion_tokens) || undefined,
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

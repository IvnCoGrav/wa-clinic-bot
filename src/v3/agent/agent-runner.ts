import { ConversationState } from '@prisma/client';
import { CustomerGoalSession, GoalTracker } from '../state/goal-tracker';
import { PersonaPromptBuilder, extractFastIntents } from './persona';
import type { DynamicPromptExemplar } from './persona';
import { getLlmEndpointConfig } from '../../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { ContextGrounder, FastResponseGate } from './pipeline/context-grounder';
import { CartManager } from '../state/cart-manager';
import { ToolExecutionPipeline } from './pipeline/tool-pipeline';
import { DeliveryFastPath } from './pipeline/delivery-fast-path';
import { GuardrailPipeline } from './pipeline/guardrail-pipeline';
import { GenerationStage, TurnState, createTelemetry, persistTurnMessages, reportTurnError } from './pipeline/generation-stage';
import { telemetryService } from '../../services/telemetry.service';

/**
 * Detektor semantik token-based (sesi 951450): apakah pesan adalah komitmen
 * asisten/klinik untuk MENGECEK ketersediaan jadwal (3 komponen AND: subjek
 * klinik + verba cek/koordinasi + nomina jadwal/slot), dengan guard pertanyaan
 * balik ke customer ("jadwalnya kapan ya?") agar tidak salah terdeteksi.
 * DILARANG berbasis regex hafalan kalimat — murni token & state semantik.
 */
export function isScheduleCheckCommitment(text: string): boolean {
  const lower = (text || '').toLowerCase();
  const tokens = lower.replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  // Guard pertanyaan balik ke customer (anti false-positive).
  if (lower.includes('?')) return false;
  const questionWords = ['kapan', 'bagaimana', 'gimana', 'kenapa', 'dimana', 'mana', 'apakah', 'berapa', 'kenapa'];
  if (tokens.some((t) => questionWords.includes(t))) return false;
  if (tokens.includes('hari') && tokens.includes('apa')) return false;
  if (tokens.includes('jam') && tokens.includes('berapa')) return false;
  // 3 komponen AND: subjek klinik + verba cek + nomina jadwal.
  const hasClinicSubject = tokens.some((t) => t === 'kami' || t === 'bidan');
  const hasCheckVerb = tokens.some((t) => t.includes('cek') || t.includes('koordinasi'));
  const hasScheduleNoun = tokens.some((t) => t.includes('jadwal') || t === 'slot');
  return hasClinicSubject && hasCheckVerb && hasScheduleNoun;
}

export interface AgentRunnerInput {
  tenantId?: string;
  customerId: string;
  conversationId: string;
  phone: string;
  chatId: string;
  bubbleCorrelationId?: string;
  /** ID kanonis turn inbound (aditif, opsional). */
  turnId?: string;
  /** Provider asal pesan (aditif, opsional). */
  provider?: 'WAHA' | 'WABA';
  incomingText: string;
  originalText?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  forceModel?: string;
  skipDbLogging?: boolean;
  preExtractedIntents?: string[];
}

export interface V3RetrievedChunk {
  id: string;
  title: string;
  content: string;
  similarity: number | null;
  score?: number | null;
}

export interface V3TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface AgentRunnerOutput {
  replyText: string;
  executedTools: Array<{ name: string; args: any; result: any }>;
  updatedSession: CustomerGoalSession;
  shouldSendReply: boolean;
  isEscalated: boolean;
  escalationReason?: string;
  escalationNote?: string;
  unresolvedFaq?: boolean;
  retrievedChunks: V3RetrievedChunk[];
  fewShotExemplars: DynamicPromptExemplar[];
  systemPrompt: string;
  reasoning: string | null;
  tokens: V3TokenUsage;
  costIdr: number;
  nextState?: ConversationState;
  contextSummary?: string;
}
export class V3AgentRunner {
  public static async processMessage(input: AgentRunnerInput): Promise<AgentRunnerOutput> {
    const {
      tenantId = DEFAULT_TENANT_ID,
      customerId,
      conversationId,
      phone,
      chatId,
      incomingText,
      history = [],
      forceModel,
    } = input;

    // 1. Session saat ini.
    let session = await GoalTracker.getGoalSession(conversationId, tenantId);

    // Kontrak domain: keputusan gerbang via modul tunggal conversation-gates
    // (PLAN 8 FASE 3) — otoritas yang sama dengan machine.ts. Dihentikan sebelum LLM.
    const { evaluateDomainGate } = await import('../../state-machine/conversation-gates');
    const domainVerdict = evaluateDomainGate(input.preExtractedIntents);
    if (domainVerdict.action === 'silent_escalate') {
      console.log(`[V3 DOMAIN GATE] ${domainVerdict.reason} pra-ekstraksi untuk ${phone} — eskalasi sunyi tanpa LLM.`);
      return {
        replyText: '',
        executedTools: [],
        updatedSession: session,
        shouldSendReply: false,
        isEscalated: true,
        retrievedChunks: [],
        fewShotExemplars: [],
        systemPrompt: '',
        reasoning: null,
        tokens: { prompt: 0, completion: 0, total: 0 },
        costIdr: 0,
        nextState: ConversationState.HUMAN_HANDLING,
      };
    }

    // 2. Endpoint & model LLM (Dual-Model Pipeline).
    // Call 1 (Router): INTENT_CLASSIFICATION (mis. glm-5.3-flash, hemat & cepat ~1.2s tanpa thinking)
    // Call 2 (Generator): CHAT_REPLY (mis. gpt-4o-mini, persona ramah & natural)
    const routerModelConfig = AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION', tenantId);
    const routerEndpointConfig = getLlmEndpointConfig({ modelConfigKey: 'INTENT_CLASSIFICATION', tenantId });
    const routerModel = forceModel || routerEndpointConfig.model || routerModelConfig?.modelName || 'glm-5.3-flash';

    const generatorModelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const generatorEndpointConfig = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY', tenantId });
    const generatorModel = forceModel || generatorEndpointConfig.model || generatorModelConfig?.modelName || 'gpt-4o-mini';

    const selectedModel = generatorModel;
    const baseUrl = generatorEndpointConfig.baseUrl || routerEndpointConfig.baseUrl;
    const apiKey = generatorEndpointConfig.apiKey || routerEndpointConfig.apiKey;

    // 3. Penyiapan session + riwayat (Stage 1a).
    const prepared = await ContextGrounder.prepareSession({ session, conversationId, tenantId, incomingText, history });
    session = prepared.session;
    const { conversationHistory, cleanIncomingText, isFollowUp } = prepared;

    // Ringkasan + direktif fase + prompt router Call 1.
    const contextSummary = ContextGrounder.buildContextSummary(session, cleanIncomingText, conversationHistory);
    let lastContextSummary = contextSummary;
    const phaseDirective = ContextGrounder.buildPhaseDirective(
      ContextGrounder.deriveConversationPhase(session, isFollowUp), session
    );
    let lastPhaseDirective = phaseDirective;
    // Fase 3 (router masker-aware): evaluasi masker pra-prompt (murni, murah)
    // agar teks Call 1 selaras dengan skema tool yang akan dikirim — prompt
    // tak membahas pemanggilan tool yang di-mask. Evaluasi penuh diulang di
    // generation-stage dengan data yang sama (deterministik, tanpa drift).
    let isSaveReservationMasked = false;
    try {
      const { evaluateToolMasking } = await import('../tools/tool-masker');
      const { ALL_V3_TOOLS } = await import('../tools/tool-registry');
      isSaveReservationMasked = !evaluateToolMasking(
        ALL_V3_TOOLS, session, cleanIncomingText, conversationHistory
      ).isSaveReservationAllowed;
    } catch {}
    const routerPrompt = await PersonaPromptBuilder.buildRouterPromptAsync(session, isFollowUp, {
      contextSummary,
      phaseDirective: lastPhaseDirective,
      tenantId,
      isSaveReservationMasked,
    });
    const currentSystemPrompt = routerPrompt;
    const fewShotExemplars: any[] = [];
    let preGroundingBlock = '';

    // Jendela 8 pesan terakhir (4 turn).
    const recentHistory = conversationHistory.slice(-8).map((h) => ({ role: h.role, content: h.content }));
    const messages: any[] = [
      { role: 'system', content: routerPrompt },
      ...recentHistory,
      { role: 'user', content: `<customer_message>\n${cleanIncomingText}\n</customer_message>` },
    ];

    // Stage 0: Fast Gate deterministik (sapaan Turn-0 / ack pasca-reservasi).
    const gate = await FastResponseGate.check({
      tenantId, conversationId, phone, incomingText,
      originalText: input.originalText, cleanIncomingText,
      skipDbLogging: input.skipDbLogging, isFollowUp,
      session, currentSystemPrompt, fewShotExemplars,
    });
    session = gate.session;
    if (gate.handled) return gate.output;

    // Status turn bersama lintas stage.
    const retrievedChunks: V3RetrievedChunk[] = [];
    const seenChunkKeys = new Set<string>();
    const correlationId =
      (input as any).bubbleCorrelationId || (chatId ? `${phone}_${Date.now()}` : `bubble_${Date.now()}`);
    const turn: TurnState = {
      tenantId, phone, conversationId, incomingText,
      selectedModel, routerModel, generatorModel, baseUrl, apiKey,
      routerBaseUrl: routerEndpointConfig.baseUrl, routerApiKey: routerEndpointConfig.apiKey,
      generatorBaseUrl: generatorEndpointConfig.baseUrl, generatorApiKey: generatorEndpointConfig.apiKey,
      turnStartedAt: Date.now(), correlationId,
      turnId: input.turnId, provider: input.provider,
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      currentSystemPrompt, messages, executedTools: [], retrievedChunks,
      fewShotExemplars, reasoning: null, perCallLogged: false,
    };
    const tel = createTelemetry(turn);

    try {
      // Stage 1b: grounding + latch session pra-routing.
      const grounding = await ContextGrounder.ground({
        incomingText, cleanIncomingText, session, tenantId, phone,
        conversationId, isFollowUp, seenChunkKeys, retrievedChunks,
      });
      preGroundingBlock = grounding.preGroundingBlock;
      if (preGroundingBlock) {
        messages[0].content = `${messages[0].content}\n\n${preGroundingBlock}`;
        turn.currentSystemPrompt = messages[0].content;
      }
      session = await ContextGrounder.applySessionLatches(session, cleanIncomingText, conversationId, tenantId);

      // Stage 2: Call 1 Tool Routing.
      const routing = await GenerationStage.routeTools(turn, tel, { cleanIncomingText, session, messages, grounding, conversationHistory });

      // ST6 (RC-05): simpan verdict komitmen Call 1 secara persisten
      // (lastCommitment) agar turn-turn berikutnya tidak mengisi ulang cart
      // dari penyebutan layanan saat konsultasi. Sekaligus terapkan veto untuk
      // turn INI (prepareSession sudah menulis cart ke DB sebelum Call 1).
      if (routing.commitment) {
        const vetoed = CartManager.applyCommitmentVeto(session, routing.commitment);
        const needVetoPersist = routing.commitment === 'EXPLORING' && (session.cartItems || []).length > 0;
        try {
          session = await GoalTracker.updateGoalSession(conversationId, {
            lastCommitment: routing.commitment,
            ...(needVetoPersist
              ? { cartItems: [], totalPrice: undefined, discussedTreatments: vetoed.discussedTreatments }
              : {}),
          }, tenantId);
        } catch {
          (session as any).lastCommitment = routing.commitment;
          if (needVetoPersist) session = vetoed;
        }
      }

      // ST6-4 (RC-05): verdict COMMITTED me-latch komitmen booking (sticky) —
      // menyatukan cart & tool-masker pada SATU sumber (penilaian semantik LLM),
      // menggantikan ketergantungan pada daftar verba hafalan. Pengaman tidak
      // berubah: save_reservation tetap butuh treatment + lokasi + tanggal.
      if (routing.commitment === 'COMMITTED' && !session.bookingCommitConfirmed) {
        try {
          session = await GoalTracker.updateGoalSession(conversationId, { bookingCommitConfirmed: true }, tenantId);
        } catch {
          (session as any).bookingCommitConfirmed = true;
        }
      }

      let draftReply: string;
      let toolEmptyKnowledge = false;
      if (routing.toolCalls && (routing.toolCalls as any[]).length > 0) {
        // Stage 3: eksekusi tool + reduksi session.
        const toolOutput = await ToolExecutionPipeline.execute({
          toolCalls: routing.toolCalls as any[], assistantMessage: routing.assistantMessage,
          session, tenantId, customerId, phone, conversationId, chatId,
          conversationHistory, cleanIncomingText, grounding,
          seenChunkKeys, retrievedChunks, messages,
        });
        session = toolOutput.updatedSession;
        turn.executedTools = toolOutput.executedTools;
        toolEmptyKnowledge = toolOutput.emptyKnowledgeResult;
        if (toolOutput.isEscalated) {
          await tel.traceExecution({ reply: '', status: 'SUCCESS', tools: turn.executedTools });
          return {
            replyText: '',
            executedTools: turn.executedTools,
            updatedSession: session,
            shouldSendReply: false,
            isEscalated: true,
            retrievedChunks,
            fewShotExemplars: turn.fewShotExemplars,
            systemPrompt: turn.currentSystemPrompt,
            reasoning: turn.reasoning,
            tokens: { ...turn.totalTokens },
            costIdr: await tel.finishCost(),
            nextState: ConversationState.HUMAN_HANDLING,
          };
        }
        // Stage 3b: Gerbang Deterministik Balasan Lokasi Murni (Fast SOP).
        // Giliran lokasi-murni dibalas template resmi tool tanpa Call 2
        // (hemat token, nol parafrase/narasi basecamp). Konsumsi RAW
        // executedTools (template utuh) — payload LLM tetap murni terstruktur
        // (anti parrot-effect). Giliran campuran → fail-open ke Call 2 + D8.
        // draftReply tetap mengalir ke Stage 5 (validator + sanitizer).
        const fastPath = DeliveryFastPath.evaluate({
          executedTools: turn.executedTools, cleanIncomingText, isFollowUp, tenantId,
        });
        if (fastPath.eligible) {
          console.log(JSON.stringify({ event: 'DELIVERY_FAST_PATH_ELIGIBLE', tenantId, conversationId, timestamp: new Date().toISOString() }));
          await tel.traceExecution({ reply: fastPath.reply, status: 'SUCCESS', tools: turn.executedTools });
          draftReply = fastPath.reply;
        } else {
          // Stage 4: Call 2 Persona Generation.
          const gen = await GenerationStage.generateReply(turn, tel, {
            session, isFollowUp, cleanIncomingText, conversationHistory,
            messages, preGroundingBlock, tenantId,
          });
          lastContextSummary = gen.contextSummary;
          lastPhaseDirective = gen.phaseDirective;
          draftReply = gen.finalReply;
        }
      } else {
        draftReply = routing.assistantMessage?.content || '';
      }

      // Stage 5: guardrail + reprompt engine.
      const guard = await GuardrailPipeline.verifyAndReprompt({
        draftReply, incomingText, isFollowUp,
        executedTools: turn.executedTools, retrievedChunks, session,
        tenantId, phone, conversationId, selectedModel, baseUrl, apiKey,
        shouldSendReply: true, isEscalated: false,
        emptyKnowledgeResult: toolEmptyKnowledge,
        executeChat: (p) => GenerationStage.executeChatCompletion(p),
        recordCall: (m) => tel.recordCall({ flowType: 'V3_REPROMPT', ...m }),
        addUsage: tel.addUsage, auditUsage: tel.auditUsage,
      });
      const finalReply = guard.finalReply;

      await persistTurnMessages({
        tenantId, conversationId, skipDbLogging: input.skipDbLogging,
        originalText: input.originalText, incomingText,
        finalReply, isEscalated: guard.isEscalated,
      });

      // F0 T0.1 — Telemetri per-turn (fail-closed observability): catat metrik kualitas
      // raw vs sanitized untuk SMR, silent-drop, dan latensi. Overhead <2ms (hanya hitung string).
      try {
        const rawForTelemetry = draftReply || '';
        const sanitizedForTelemetry = finalReply || '';
        const latencyMs = Date.now() - turn.turnStartedAt;
        const isSilentDrop = !guard.shouldSendReply && !guard.isEscalated;
        const isUnjustifiedRsqr = (guard.violationsDetected || []).some((v: string) => v.includes('RSQR') || v.includes('Unjustified'));
        telemetryService.recordTurn({
          conversationId,
          customerPhone: phone,
          tenantId,
          timestamp: Date.now(),
          rawLlmReply: rawForTelemetry || null,
          sanitizedReply: sanitizedForTelemetry || null,
          mutilationRatio: telemetryService.calculateMutilationRatio(rawForTelemetry, sanitizedForTelemetry),
          isSilentDrop,
          isUnjustifiedRsqr,
          nluErrorCode: null,
          isJsonTruncated: false,
          latencyMs,
          modelName: selectedModel,
        });
      } catch {}

      // Monolitik V3_AGENT sudah dipecah menjadi ROUTING/GENERATION/REPROMPT per-call;
      // hanya catat legacy bila belum ada per-call (mis. jalur deterministik tanpa LLM).
      if (!turn.perCallLogged) {
        await tel.traceExecution({ reply: finalReply, status: 'SUCCESS', tools: turn.executedTools });
      }
      return {
        replyText: finalReply,
        executedTools: turn.executedTools,
        updatedSession: session,
        shouldSendReply: guard.shouldSendReply && !!finalReply.trim(),
        isEscalated: guard.isEscalated,
        unresolvedFaq: guard.emptyKnowledgeResult && !guard.isEscalated,
        retrievedChunks,
        fewShotExemplars: turn.fewShotExemplars,
        systemPrompt: turn.currentSystemPrompt,
        reasoning: turn.reasoning,
        tokens: { ...turn.totalTokens },
        costIdr: await tel.finishCost(),
        nextState: guard.isEscalated
          ? ConversationState.HUMAN_HANDLING
          : ContextGrounder.deriveConversationState(session, extractFastIntents(cleanIncomingText)),
        contextSummary: lastContextSummary || undefined,
      };
    } catch (err: any) {
      // Outage LLM total (Fase B): TANPA balasan generik — eskalasi sunyi.
      return reportTurnError(turn, session, err, incomingText, (input as any).bubbleCorrelationId);
    }
  }
}

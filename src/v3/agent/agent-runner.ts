import { ConversationState } from '@prisma/client';
import { CustomerGoalSession, GoalTracker } from '../state/goal-tracker';
import { PersonaPromptBuilder, extractFastIntents } from './persona';
import type { DynamicPromptExemplar } from './persona';
import { getLlmEndpointConfig } from '../../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { ContextGrounder, FastResponseGate } from './pipeline/context-grounder';
import { ToolExecutionPipeline } from './pipeline/tool-pipeline';
import { GuardrailPipeline } from './pipeline/guardrail-pipeline';
import { GenerationStage, TurnState, createTelemetry, persistTurnMessages, reportTurnError } from './pipeline/generation-stage';

export interface AgentRunnerInput {
  tenantId?: string;
  customerId: string;
  conversationId: string;
  phone: string;
  chatId: string;
  bubbleCorrelationId?: string;
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

    // Kontrak domain: out_of_domain pra-ekstraksi dihentikan sebelum LLM — eskalasi sunyi.
    if (input.preExtractedIntents?.includes('out_of_domain')) {
      console.log(`[V3 DOMAIN GATE] out_of_domain pra-ekstraksi untuk ${phone} — eskalasi sunyi tanpa LLM.`);
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

    // 2. Endpoint & model LLM.
    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpointConfig = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' });
    const selectedModel = forceModel || modelConfig?.modelName || 'gpt-4o-mini';
    const baseUrl = endpointConfig.baseUrl;
    const apiKey = endpointConfig.apiKey;

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
    const routerPrompt = PersonaPromptBuilder.buildRouterPrompt(session, isFollowUp, {
      contextSummary,
      phaseDirective: lastPhaseDirective,
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
      selectedModel, baseUrl, apiKey, turnStartedAt: Date.now(), correlationId,
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
      const routing = await GenerationStage.routeTools(turn, tel, { cleanIncomingText, session, messages, grounding });
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
        // Stage 4: Call 2 Persona Generation.
        const gen = await GenerationStage.generateReply(turn, tel, {
          session, isFollowUp, cleanIncomingText, conversationHistory,
          messages, preGroundingBlock, tenantId,
        });
        lastContextSummary = gen.contextSummary;
        lastPhaseDirective = gen.phaseDirective;
        draftReply = gen.finalReply;
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

      // Monolitik V3_AGENT sudah dipecah menjadi ROUTING/GENERATION/REPROMPT per-call;
      // hanya catat legacy bila belum ada per-call (mis. jalur deterministik tanpa LLM).
      if (!turn.perCallLogged) {
        await tel.traceExecution({ reply: finalReply, status: 'SUCCESS', tools: turn.executedTools });
      }
      return {
        replyText: guard.isEscalated ? '' : finalReply,
        executedTools: turn.executedTools,
        updatedSession: session,
        shouldSendReply: guard.shouldSendReply && !guard.isEscalated,
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

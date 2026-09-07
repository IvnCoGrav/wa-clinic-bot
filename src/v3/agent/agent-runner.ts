import axios from 'axios';
import { ALL_V3_TOOLS, executeToolByName, ToolExecutionContext } from '../tools/tool-registry';
import { CustomerGoalSession, GoalTracker } from '../state/goal-tracker';
import { PersonaPromptBuilder, DynamicPromptExemplar, extractFastIntents } from './persona';
import { ConversationStateSummarizer } from '../../slot-engine/conversation-summarizer';
import { ConversationState } from '@prisma/client';
import type { CustomerSlate, ExtractedEntities } from '../../slot-engine/types';
import { OutputSanitizer } from '../guardrails/sanitizer';
import { isPureLeadGreeting, stripAdTags } from '../../utils/lead-greeting-detector';
import { TEMPLATES } from '../../config/persona';
import { getLlmEndpointConfig } from '../../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

import { prisma } from '../../db/client';

export interface AgentRunnerInput {
  tenantId?: string;
  customerId: string;
  conversationId: string;
  phone: string;
  chatId: string;
  incomingText: string;
  /**
   * Teks mentah asli customer (termasuk tag iklan Promo[...]) untuk DB audit
   * trail. Jika kosong, incomingText dipakai sebagai fallback.
   */
  originalText?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  forceModel?: string;
  skipDbLogging?: boolean;
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
  /** Observability: RAG chunks yang diambil via tool search_knowledge_faq. */
  retrievedChunks: V3RetrievedChunk[];
  /** Observability: contoh chat dinamis yang disuntikkan ke system prompt. */
  fewShotExemplars: DynamicPromptExemplar[];
  /** Observability: teks utuh system prompt yang dikirim ke LLM. */
  systemPrompt: string;
  /** Observability: reasoning/chain-of-thought model (bila disediakan provider). */
  reasoning: string | null;
  /** Observability: agregat token kedua panggilan LLM. */
  tokens: V3TokenUsage;
  /** Observability: estimasi biaya Rupiah agregat. */
  costIdr: number;
  /** Sinkronisasi CRM: status state-machine turunan dari session (agar tidak beku di INITIAL). */
  nextState?: ConversationState;
  /** Observability: ringkasan konteks deterministik terakhir yang disuntik ke system prompt. */
  contextSummary?: string;
}

export class V3AgentRunner {
  /**
   * Adaptasi CustomerGoalSession (V3) menjadi CustomerSlate (slot-engine) agar
   * ConversationStateSummarizer deterministik dapat dipakai lintas engine.
   */
  public static buildSlateAdapter(session: CustomerGoalSession): CustomerSlate {
    return {
      customerId: '',
      phone: '',
      name: session.customerName || null,
      tenantId: DEFAULT_TENANT_ID,
      conversationId: '',
      kelurahan: session.location?.kelurahan || null,
      kecamatan: session.location?.kecamatan || null,
      kota: session.location?.kota || null,
      lat: null,
      lng: null,
      streetDetail: null,
      distanceKm: session.location?.distanceKm ?? null,
      ongkirFee: session.location?.ongkirNormal ?? null,
      ongkirPromoFee: session.location?.ongkirPromo ?? null,
      isLocationConfirmed: Boolean(session.location?.kelurahan || session.location?.distanceKm != null),
      isOutOfCoverage: Boolean(session.location?.isOutOfCoverage),
      childAgeMonths: session.childProfile?.ageMonths ?? null,
      childAgeCategory: null,
      symptoms: session.childProfile?.symptoms || [],
      medicalConcerns: [],
      selectedTreatmentName: session.selectedTreatment || (session.cartItems && session.cartItems[0] ? session.cartItems[0].name : null),
      preferredDate: session.booking?.preferredDate || null,
      preferredTime: session.booking?.preferredTime || null,
      pricelistSent: false,
      reservationFormSent: false,
      isHumanHandling: false,
      humanHandlingReason: null,
      lastInteractionAt: new Date(),
      projectedState: ConversationState.INITIAL,
    };
  }

  /**
   * Turunan status state-machine dari session (reuse enum existing — tanpa migrasi):
   * lokasi terkonfirmasi → LOCATION_CONFIRMED; cart/treatment terisi → AWAITING_INTEREST;
   * jadwal ditanyakan → RESERVATION_SENT; reservasi tersimpan → COMPLETED.
   */
  public static deriveConversationState(session: CustomerGoalSession, currentIntents: string[] = []): ConversationState {
    if (session.booking?.isConfirmed || session.booking?.reservationId) {
      return ConversationState.COMPLETED;
    }
    if (session.booking?.preferredDate || currentIntents.includes('ask_schedule')) {
      return ConversationState.RESERVATION_SENT;
    }
    if ((session.cartItems && session.cartItems.length > 0) || session.selectedTreatment) {
      return ConversationState.AWAITING_INTEREST;
    }
    if (session.location?.kelurahan || session.location?.distanceKm != null) {
      return ConversationState.LOCATION_CONFIRMED;
    }
    return ConversationState.INITIAL;
  }

  /**
   * Deteksi layanan katalog yang disepakati dari riwayat obrolan (data-driven:
   * pencocokan substring nama layanan katalog aktif, tanpa regex/daftar hardcode).
   * Dipindai dari pesan terbaru; nama terpanjang menang (paling spesifik).
   */
  public static detectAgreedTreatment(
    history: Array<{ role: string; content: string }>,
    catalogNames: string[]
  ): string | null {
    if (!history || history.length === 0 || !catalogNames || catalogNames.length === 0) return null;
    const names = [...catalogNames]
      .filter((n) => n && n.trim().length >= 4)
      .sort((a, b) => b.length - a.length);
    for (let i = history.length - 1; i >= 0; i--) {
      const text = (history[i]?.content || '').toLowerCase();
      if (!text) continue;
      for (const name of names) {
        if (text.includes(name.toLowerCase())) return name;
      }
    }
    return null;
  }

  private static async executeChatCompletion(params: {
    payload: any;
    tenantId: string;
    phone: string;
    conversationId: string;
    baseUrl: string;
    apiKey: string;
    selectedModel: string;
  }): Promise<any> {
    const fallbackApiKey = process.env.LLM_FALLBACK_API_KEY || '';
    const fallbackBaseUrl = (process.env.LLM_FALLBACK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const fallbackModel = process.env.AI_MODEL_FALLBACK || 'deepseek-chat';

    try {
      const response = await axios.post(`${params.baseUrl}/chat/completions`, params.payload, {
        headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      return response.data;
    } catch (primaryErr: any) {
      console.warn(
        `[V3 AGENT PRIMARY FAILED] ${params.selectedModel} error: ${primaryErr.response?.status || primaryErr.message}. Triggering fallback to ${fallbackModel}...`
      );

      if (!fallbackApiKey) {
        throw primaryErr;
      }

      const fallbackPayload = {
        ...params.payload,
        model: fallbackModel,
      };

      const fallbackResponse = await axios.post(`${fallbackBaseUrl}/chat/completions`, fallbackPayload, {
        headers: { Authorization: `Bearer ${fallbackApiKey}`, 'Content-Type': 'application/json' },
        timeout: 20000,
      });
      return fallbackResponse.data;
    }
  }

  /**
   * Menjalankan agentic execution loop dengan native tool-calling & context grounding.
   */
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

    // 1. Ambil session state saat ini
    let session = await GoalTracker.getGoalSession(conversationId, tenantId);

    const toolContext: ToolExecutionContext = {
      tenantId,
      customerId,
      conversationId,
      phone,
      chatId,
      selectedTreatment: session.selectedTreatment,
    };

    // 2. Siapkan LLM endpoint & API keys
    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpointConfig = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' });
    const selectedModel = forceModel || modelConfig?.modelName || 'gpt-4o-mini';
    const baseUrl = endpointConfig.baseUrl;
    const apiKey = endpointConfig.apiKey;

    // 3. Susun percakapan dengan auto-rehydrate dari DB jika history kosong.
    // Gunakan messageService.getRecentMessages (punya in-memory fallback) agar
    // isFollowUp tidak false-negative saat DB offline / pengujian lokal.
    // Teks bersih (tanpa tag iklan Promo[...]) khusus lapisan inferensi LLM.
    const cleanIncomingText = stripAdTags(incomingText) || incomingText;
    let conversationHistory = [...history];
    if (conversationHistory.length === 0 && conversationId) {
      try {
        const { messageService } = await import('../../services/message.service');
        const recentMsgs = await messageService.getRecentMessages(conversationId, 20, tenantId);
        conversationHistory = (recentMsgs || []).map((m: any) => ({
          role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        }));
      } catch (e) {}
    }

    // Auto-capture ringan: jika riwayat obrolan aktif menyebut layanan katalog yang
    // disepakati (misal Pulih Ceria, Cukur) sementara session belum mencatatnya,
    // sinkronkan selectedTreatment agar header status tidak amnesia pada turn berikut.
    // Data-driven dari katalog aktif (tanpa regex/daftar hardcode).
    if (!session.selectedTreatment && conversationId) {
      try {
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        const agreed = V3AgentRunner.detectAgreedTreatment(
          conversationHistory,
          treatmentCatalogService.getAllServices(true).map((s) => s.name)
        );
        if (agreed) {
          session = await GoalTracker.updateGoalSession(conversationId, {
            selectedTreatment: agreed,
          }, tenantId);
        }
      } catch (e) {}
    }

    const isFollowUp = conversationHistory.some((m) => m.role === 'assistant');

    // Sinkronisasi keranjang layanan dari riwayat + pesan masuk (deterministik),
    // agar penambahan add-on (Sinar Moksa, Cukur) tidak amnesia antar turn.
    if (conversationId) {
      try {
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        const syncedCart = GoalTracker.syncCartItems(
          session,
          [...conversationHistory, { role: 'user', content: cleanIncomingText }],
          treatmentCatalogService.getAllServices(true).map((s) => ({
            name: s.name,
            promoPrice: s.promoPrice,
            originalPrice: s.originalPrice,
            category: s.category,
            isAddon: (treatmentCatalogService as any).isAddonService
              ? (treatmentCatalogService as any).isAddonService(s)
              : false,
          }))
        );
        if (JSON.stringify(syncedCart) !== JSON.stringify(session.cartItems || [])) {
          session = await GoalTracker.updateGoalSession(conversationId, {
            cartItems: syncedCart,
            totalPrice: GoalTracker.calcCartTotal({ ...session, cartItems: syncedCart }),
          }, tenantId);
        }
      } catch (e) {}
    }

    // Ekstraksi profil anak otomatis dari pesan masuk (usia, gejala, peran Adik/Kakak),
    // sinkron ke session.children (+ mirror childProfile) sebelum pemanggilan LLM.
    if (conversationId && cleanIncomingText) {
      try {
        const nextChildren = GoalTracker.syncChildrenProfiles(session, cleanIncomingText);
        if (JSON.stringify(nextChildren) !== JSON.stringify(session.children || [])) {
          const firstChild = nextChildren[0];
          session = await GoalTracker.updateGoalSession(conversationId, {
            children: nextChildren,
            childProfile: firstChild
              ? { name: firstChild.name, roleLabel: firstChild.roleLabel, ageMonths: firstChild.ageMonths, symptoms: [...(firstChild.symptoms || [])] }
              : session.childProfile,
          }, tenantId);
        }
      } catch (e) {}
    }

    // System prompt ASYNC: contoh chat dimuat dinamis dari bank few_shot_exemplars
    // (DB Koleksi Emas, fallback statis). Exemplar terpilih diekspor untuk observability.
    const dynamicPrompt = await PersonaPromptBuilder.buildSystemPromptAsync(session, isFollowUp, {
      tenantId,
      incomingText: cleanIncomingText,
    });
    const systemPrompt = dynamicPrompt.systemPrompt;
    const fewShotExemplars = dynamicPrompt.exemplars;
    // Ringkasan konteks deterministik (0 token): apa yang SUDAH dibahas, FOKUS saat ini,
    // dan apa yang DILARANG diulang — anti kaset-rusak & anti amnesia antar turn.
    // Closure agar bisa dihitung ulang dari session terbaru sebelum Call 2 (refresh prompt
    // menimpa messages[0], sehingga summary harus ditempel ulang).
    const buildContextSummary = (): string => {
      try {
        const slateAdapter = V3AgentRunner.buildSlateAdapter(session);
        const summaryExtraction: ExtractedEntities = {
          intents: extractFastIntents(cleanIncomingText) as ExtractedEntities['intents'],
          locationText: null,
          streetDetail: null,
          childAgeMonths: session.childProfile?.ageMonths ?? session.children?.[0]?.ageMonths ?? null,
          symptoms: [...(session.childProfile?.symptoms || []), ...((session.children || []).flatMap((c) => c.symptoms || []))].filter(
            (s, i, arr) => arr.indexOf(s) === i
          ),
          treatmentReferenced: null,
          preferredDateText: null,
          preferredTimeText: null,
          customerName: null,
          isMedicalEmergency: false,
          confidenceScore: 0.8,
        };
        return ConversationStateSummarizer.summarize(slateAdapter, summaryExtraction, {
          history: conversationHistory.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
          customerInput: cleanIncomingText,
        });
      } catch (e) {
        return '';
      }
    };
    const contextSummary = buildContextSummary();
    let lastContextSummary = contextSummary;
    const messages: any[] = [
      { role: 'system', content: contextSummary ? `${systemPrompt}\n\n${contextSummary}` : systemPrompt },
      // Jendela 14 pesan terakhir (7 turn) agar lokasi & ongkir turn awal tidak terpotong amnesia.
      ...conversationHistory.slice(-14).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: cleanIncomingText },
    ];

    const emptyTokens: V3TokenUsage = { prompt: 0, completion: 0, total: 0 };
    const turnStartedAt = Date.now();

    // GATE DETERMINISTIK: sapaan pembuka murni (Turn-0) langsung dibalas template
    // resmi tanpa LLM (0 token). Hanya bila asisten belum pernah membalas.
    if (!isFollowUp) {
      const leadCheck = isPureLeadGreeting(cleanIncomingText);
      if (leadCheck.isLeadGreeting) {
        const staticReply = TEMPLATES.greeting({ isIslamic: leadCheck.isIslamic });
        if (conversationId && !input.skipDbLogging) {
          try {
            const { messageService } = await import('../../services/message.service');
            const { Direction } = await import('@prisma/client');
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.INBOUND,
              content: input.originalText || incomingText,
            });
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.OUTBOUND,
              content: staticReply,
            });
          } catch (e) {}
        }
        return {
          replyText: staticReply,
          executedTools: [],
          updatedSession: session,
          shouldSendReply: true,
          isEscalated: false,
          retrievedChunks: [],
          fewShotExemplars,
          systemPrompt,
          reasoning: null,
          tokens: emptyTokens,
          costIdr: 0,
          nextState: V3AgentRunner.deriveConversationState(session, extractFastIntents(cleanIncomingText)),
        };
      }
    }

    const executedTools: Array<{ name: string; args: any; result: any }> = [];
    let isEscalated = false;
    let shouldSendReply = true;
    let finalReply = '';

    // Observability turn-level: chunks RAG, reasoning model, agregat token.
    const retrievedChunks: V3RetrievedChunk[] = [];
    const retrievedChunkIds = new Set<string>();
    let reasoning: string | null = null;
    const totalTokens: V3TokenUsage = { prompt: 0, completion: 0, total: 0 };
    const addUsage = (usage: any): void => {
      const p = Number(usage?.prompt_tokens) || 0;
      const c = Number(usage?.completion_tokens) || 0;
      totalTokens.prompt += p;
      totalTokens.completion += c;
      totalTokens.total += p + c;
    };
    const auditUsage = async (usage: any, startedAt: number, error?: any): Promise<void> => {
      try {
        const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: phone,
          tenant_id: tenantId,
          conversation_id: conversationId,
          task_type: 'V3_AGENT',
          model_name: selectedModel,
          baseUrl,
          startedAt,
          error: error ?? null,
          usage: usage ?? null,
        });
      } catch {}
    };
    const finishCost = async (): Promise<number> => {
      try {
        const { calculateLlmCost } = await import('../../utils/cost-calculator');
        return calculateLlmCost(selectedModel, totalTokens.prompt, totalTokens.completion, 0).totalCostIdr || 0;
      } catch {
        return 0;
      }
    };
    const traceExecution = async (params: {
      reply: string;
      status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
      tools: Array<{ name: string; args: any; result: any }>;
    }): Promise<void> => {
      try {
        const { recordLlmExecution } = await import('../../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'V3_AGENT' as any,
          customerPhone: phone,
          customerInput: incomingText,
          bubbleCorrelationId: chatId,
          promptPayload: { model: selectedModel, systemPrompt, messageCount: messages.length },
          reasoning,
          groundTruthUsed: {
            retrievedChunks,
            fewShotExemplars: fewShotExemplars.map((e) => ({ id: e.id, scenario: e.scenario })),
            executedTools: params.tools.map((t) => t.name),
          },
          finalReply: params.reply,
          modelUsed: selectedModel,
          durationMs: Date.now() - turnStartedAt,
          status: params.status,
        });
      } catch {}
    };

    try {
      // 4. Panggilan Pertama: Model mengevaluasi apakah perlu memanggil Tools
      const firstPayload: any = {
        model: selectedModel,
        messages,
        tools: ALL_V3_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
      };

      const firstStartedAt = Date.now();
      const firstData = await V3AgentRunner.executeChatCompletion({
        payload: firstPayload,
        tenantId,
        phone,
        conversationId,
        baseUrl,
        apiKey,
        selectedModel,
      }).then(async (data) => {
        addUsage((data as any)?.usage);
        await auditUsage((data as any)?.usage, firstStartedAt);
        return data;
      });

      const choice = firstData?.choices?.[0];
      const assistantMessage = choice?.message;
      const toolCalls = assistantMessage?.tool_calls;
      if (!reasoning && typeof (assistantMessage as any)?.reasoning_content === 'string') {
        reasoning = (assistantMessage as any).reasoning_content;
      }

      // 5. Jika Model Memanggil Tools
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        messages.push(assistantMessage);

        for (const tc of toolCalls) {
          const fnName = tc.function?.name;
          let fnArgs: any = {};
          try {
            fnArgs = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {};
          } catch (_) {}

          console.log(`[V3 AGENT TOOL EXECUTE] Tool: "${fnName}", Args:`, JSON.stringify(fnArgs));

          let toolResult: any;
          try {
            toolResult = await executeToolByName(fnName, fnArgs, toolContext);
          } catch (toolErr: any) {
            toolResult = { error: toolErr.message };
          }

          executedTools.push({ name: fnName, args: fnArgs, result: toolResult });

          // Observability: tampung RAG chunks — pakai skor riil (similarity/score/rank) jika ada, fallback 0.90 hanya bila tidak ada.
          if (fnName === 'search_knowledge_faq' && Array.isArray(toolResult?.chunks)) {
            for (const c of toolResult.chunks) {
              const key = String(c?.id || c?.title || '');
              if (key && !retrievedChunkIds.has(key)) {
                retrievedChunkIds.add(key);
                const realScore = typeof c?.similarity === 'number' ? c.similarity : (typeof c?.score === 'number' ? c.score : (typeof (c as any)?.rank === 'number' ? (c as any).rank : null));
                retrievedChunks.push({
                  id: String(c?.id || key),
                  title: String(c?.title || ''),
                  content: String(c?.content || ''),
                  similarity: realScore !== null ? realScore : 0.90,
                  score: realScore !== null ? realScore : 0.90,
                } as any);
              }
            }
          }

          // Perbarui session state berdasarkan hasil tool
          if (fnName === 'calculate_delivery' && toolResult.success) {
            session = await GoalTracker.updateGoalSession(conversationId, {
              location: {
                rawText: fnArgs.locationText,
                kelurahan: toolResult.kelurahan,
                kecamatan: toolResult.kecamatan,
                kota: toolResult.kota,
                distanceKm: toolResult.distanceKm,
                ongkirNormal: toolResult.ongkirNormal,
                ongkirPromo: toolResult.ongkirPromo,
                isOutOfCoverage: toolResult.isOutOfCoverage,
              },
            }, tenantId);
            // Lifecycle ongkir: hasil kalkulasi akan disampaikan ke customer → QUOTED.
            if (!toolResult.isOutOfCoverage) {
              session = await GoalTracker.markOngkirQuoted(conversationId, tenantId);
            }
          } else if (fnName === 'get_catalog_and_price' && toolResult.success) {
            if (fnArgs.specificTreatmentName) {
              session = await GoalTracker.updateGoalSession(conversationId, {
                selectedTreatment: fnArgs.specificTreatmentName,
              }, tenantId);
            } else if (!session.selectedTreatment && Array.isArray(toolResult.treatments) && toolResult.treatments.length > 0) {
              // Jika belum ada treatment terpilih tetapi AI mencari katalog/gejala,
              // simpan kandidat rekomendasi teratas agar konteks tidak amnesia pada turn berikutnya
              const topTreatment = toolResult.treatments.find((t: any) => t.isRecommendedForSymptoms) || toolResult.treatments[0];
              if (topTreatment?.name) {
                session = await GoalTracker.updateGoalSession(conversationId, {
                  selectedTreatment: topTreatment.name,
                }, tenantId);
              }
            }
            if (fnArgs.childAgeMonths || (fnArgs.symptoms && fnArgs.symptoms.length > 0)) {
              session = await GoalTracker.updateGoalSession(conversationId, {
                childProfile: {
                  ageMonths: fnArgs.childAgeMonths,
                  symptoms: fnArgs.symptoms || [],
                },
              }, tenantId);
            }
          } else if (fnName === 'save_reservation' && toolResult.success) {
            session = await GoalTracker.updateGoalSession(conversationId, {
              selectedTreatment: fnArgs.treatmentName,
              booking: {
                preferredDate: fnArgs.bookingDate,
                preferredTime: fnArgs.bookingTime,
                reservationId: toolResult.reservationId,
                isConfirmed: true,
              },
            }, tenantId);
            session = await GoalTracker.markOngkirConfirmed(conversationId, tenantId);
          } else if (fnName === 'escalate_to_human') {
            isEscalated = true;
            shouldSendReply = false;
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: fnName,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          });
        }

        // Jika tereskalasi, hentikan langsung agar bot tidak mengirim balasan
        if (isEscalated) {
          await traceExecution({ reply: '', status: 'SUCCESS', tools: executedTools });
          return {
            replyText: '',
            executedTools,
            updatedSession: session,
            shouldSendReply: false,
            isEscalated: true,
            retrievedChunks,
            fewShotExemplars,
            systemPrompt,
            reasoning,
            tokens: { ...totalTokens },
            costIdr: await finishCost(),
            nextState: ConversationState.HUMAN_HANDLING,
          };
        }

        // 6. Panggilan Kedua: Menyusun teks balasan ramah Bidan Yusi menggunakan fakta tool
        // Perbarui system prompt di messages[0] dengan session terbaru yang telah di-grounding hasil tools
        // (async agar blok contoh dinamis bank tetap dipakai, bukan revert ke statis).
        const refreshedPrompt = await PersonaPromptBuilder.buildSystemPromptAsync(session, isFollowUp, {
          tenantId,
          incomingText: cleanIncomingText,
        });
        messages[0].content = refreshedPrompt.systemPrompt;
        // Tempel ulang ringkasan dari session terbaru (refresh menimpa messages[0]).
        const refreshedSummary = buildContextSummary();
        if (refreshedSummary) {
          messages[0].content = `${messages[0].content}\n\n${refreshedSummary}`;
          lastContextSummary = refreshedSummary;
        }

        const secondPayload: any = {
          model: selectedModel,
          messages,
          temperature: 0.65,
        };

        const secondStartedAt = Date.now();
        const secondData = await V3AgentRunner.executeChatCompletion({
          payload: secondPayload,
          tenantId,
          phone,
          conversationId,
          baseUrl,
          apiKey,
          selectedModel,
        }).then(async (data) => {
          addUsage((data as any)?.usage);
          await auditUsage((data as any)?.usage, secondStartedAt);
          return data;
        });

        finalReply = secondData?.choices?.[0]?.message?.content || '';
        if (!reasoning && typeof (secondData?.choices?.[0]?.message as any)?.reasoning_content === 'string') {
          reasoning = (secondData.choices[0].message as any).reasoning_content;
        }
      } else {
        // Jika tidak ada tool calls, gunakan langsung konten balasan
        finalReply = assistantMessage?.content || '';
      }

      // 7. Sanitasi Balasan
      finalReply = OutputSanitizer.cleanOutboundReply(finalReply, incomingText, isFollowUp);

      if (!OutputSanitizer.isValidReply(finalReply)) {
        console.warn(`[V3 AGENT WARNING] Reply rejected by sanitizer: "${finalReply}". Triggering silent fallback.`);
        finalReply = `Halo ${session.genderGreeting} 😊\n\nTerima kasih sudah menghubungi kami di Kala Moms & Baby Spa. Ada yang bisa Bidan Yusi bantu untuk perawatan Bunda atau si kecil hari ini? ✨`;
      }

      if (conversationId && !input.skipDbLogging) {
        try {
          const { messageService } = await import('../../services/message.service');
          const { Direction } = await import('@prisma/client');
          await messageService.logMessage({
            tenantId,
            conversationId,
            direction: Direction.INBOUND,
            content: input.originalText || incomingText,
          });
          if (finalReply && !isEscalated) {
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.OUTBOUND,
              content: finalReply,
            });
          }
        } catch (e) {}
      }

      await traceExecution({ reply: finalReply, status: 'SUCCESS', tools: executedTools });
      return {
        replyText: finalReply,
        executedTools,
        updatedSession: session,
        shouldSendReply: shouldSendReply && !isEscalated,
        isEscalated,
        retrievedChunks,
        fewShotExemplars,
        systemPrompt,
        reasoning,
        tokens: { ...totalTokens },
        costIdr: await finishCost(),
        nextState: isEscalated
          ? ConversationState.HUMAN_HANDLING
          : V3AgentRunner.deriveConversationState(session, extractFastIntents(cleanIncomingText)),
        contextSummary: lastContextSummary || undefined,
      };
    } catch (err: any) {
      console.error('[V3 AGENT RUNNER ERROR]', err.response?.data || err.message);

      try {
        const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: phone,
          tenant_id: tenantId,
          conversation_id: conversationId,
          task_type: 'V3_AGENT',
          model_name: selectedModel,
          baseUrl,
          startedAt: turnStartedAt,
          error: { message: err?.message || 'V3_AGENT_ERROR' },
          usage: null,
        });
      } catch {}

      // Fallback ramah jika terjadi outage koneksi
      const fallbackReply = `Halo ${session.genderGreeting} 😊\n\nTerima kasih sudah menghubungi Kala Moms & Baby Spa. Kami siap membantu layanan Homecare treatment untuk Bunda dan si kecil. Boleh dibantu info daerah tempat tinggalnya ya Bund? 🙏`;

      try {
        const { recordLlmExecution } = await import('../../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'V3_AGENT' as any,
          customerPhone: phone,
          customerInput: incomingText,
          bubbleCorrelationId: chatId,
          promptPayload: { model: selectedModel },
          reasoning,
          finalReply: fallbackReply,
          modelUsed: selectedModel,
          durationMs: Date.now() - turnStartedAt,
          status: 'ERROR',
        });
      } catch {}

      return {
        replyText: fallbackReply,
        executedTools: [],
        updatedSession: session,
        shouldSendReply: true,
        isEscalated: false,
        retrievedChunks,
        fewShotExemplars,
        systemPrompt,
        reasoning,
        tokens: { ...totalTokens },
        costIdr: 0,
      };
    }
  }
}

import axios from 'axios';
import { ALL_V3_TOOLS, executeToolByName, ToolExecutionContext } from '../tools/tool-registry';
import { CustomerGoalSession, GoalTracker } from '../state/goal-tracker';
import { PersonaPromptBuilder, DynamicPromptExemplar, extractFastIntents } from './persona';
import { V3ConversationSummarizer } from '../state/conversation-summarizer';
import { ConversationState } from '@prisma/client';
import { OutputSanitizer } from '../guardrails/sanitizer';
import { isPureLeadGreeting, stripAdTags } from '../../utils/lead-greeting-detector';
import { TEMPLATES } from '../../config/persona';
import { getLlmEndpointConfig } from '../../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

import { prisma } from '../../db/client';
import { validateToolArgs } from '../tools/tool-schemas';
import { validateNumericFacts } from '../guardrails/numeric-fact-validator';
import { normalizeWhatsAppFormat } from '../../utils/whatsapp-format';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { maskPhoneNumber, maskToolArgsForLogging } from '../../utils/pii-masker';

/**
 * Bungkus promise dengan batas waktu aman (default 7 detik).
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

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

  /**
   * Penentu pesan substantif untuk Hybrid RAG pre-retrieval (deterministik, 0 token).
   * Data-driven includes (tanpa regex intent gatekeeper): keluhan, perbedaan layanan,
   * syarat usia/SOP, kehamilan/induksi. Sapaan/harga murni/ongkir/jadwal dikecualikan
   * agar tidak membebani FTS.
   */
  public static isSubstantiveForPreGrounding(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower || lower.trim().length < 8) return false;
    // Sapaan murni tidak perlu grounding
    const greetingOnly = ['halo', 'hallo', 'hai', 'pagi', 'siang', 'sore', 'malam', 'assalamualaikum', 'permisi', 'tes', 'test', 'oke', 'ok', 'siap', 'makasih', 'terima kasih'];
    const tokens = lower.split(' ').filter((t) => t.length > 0);
    if (tokens.length <= 3 && greetingOnly.some((g) => lower.includes(g))) return false;
    const substantiveSignals = [
      // Keluhan fisik ibu & anak
      'sakit', 'nyeri', 'pegal', 'capek', 'lelah', 'bengkak', 'kembung', 'kolik', 'batuk', 'pilek', 'bapil',
      'flu', 'demam', 'rewel', 'grok', 'diare', 'gtm', 'susah makan', 'susah tidur', 'kontraksi', 'mual',
      'pusing', 'asi', 'laktasi', 'menyusui',
      // Perbedaan / pemilihan layanan
      'beda', 'perbedaan', 'pilih', 'rekomendasi', 'cocok', 'bagus', 'mending', 'sebaiknya',
      // Syarat usia / SOP klinik
      'usia', 'umur', 'bulan', 'tahun', 'minggu', 'week', 'boleh', 'aman', 'syarat', 'minimal',
      'mandi', 'susu', 'minyak', 'telon', 'balsem', 'cukur', 'gundul', 'tumbuh gigi', 'vaksin',
      'fisioterapi', 'newborn', 'hamil', 'kehamilan', 'nifas', 'induksi', 'oksitosin', 'prenatal',
      'perineum', 'kontraksi', 'pembukaan', 'hpl',
      // Penjelasan terapi / khasiat
      'fungsi', 'manfaat', 'khasiat', 'cara kerja', 'gimana', 'bagaimana', 'maksudnya', 'seperti apa',
      'treatment', 'terapi', 'moksa', 'inframerah', 'laktasi', 'pijat',
    ];
    return substantiveSignals.some((s) => lower.includes(s));
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
    const url = `${params.baseUrl}/chat/completions`;
    const headers = { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' };
    return await v3LlmCircuitBreaker.execute(url, params.payload, headers);
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
          treatmentCatalogService.getAllServices(true, tenantId).map((s) => s.name)
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
          treatmentCatalogService.getAllServices(true, tenantId).map((s) => ({
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
    // Guard maternal-only di dalam syncChildrenProfiles mencegah "38 weeks" bocor ke usia anak.
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

    // Ekstraksi profil ibu multi-audience (kehamilan/nifas/keluhan Bunda) + subjek perawatan.
    // First-class MomProfileState — terpisah 100% dari data anak (anti kontaminasi silang).
    if (conversationId && cleanIncomingText) {
      try {
        const nextMom = GoalTracker.syncMomProfile(session, cleanIncomingText);
        const nextAudience = GoalTracker.detectTargetAudience(cleanIncomingText);
        const momChanged = JSON.stringify(nextMom || null) !== JSON.stringify(session.momProfile || null);
        // Naikkan ke BOTH bila kedua sinyal hadir di turn berbeda (misal turn 1 MOMS, turn 2 anak)
        let resolvedAudience = nextAudience || session.targetAudience;
        if (session.targetAudience && nextAudience && session.targetAudience !== nextAudience) {
          const oneMom = session.targetAudience === 'MOMS' || nextAudience === 'MOMS';
          const oneChild = session.targetAudience === 'BABY' || session.targetAudience === 'KIDS' || nextAudience === 'BABY' || nextAudience === 'KIDS';
          if (oneMom && oneChild) resolvedAudience = 'BOTH';
          else resolvedAudience = nextAudience;
        }
        if (momChanged || (resolvedAudience && resolvedAudience !== session.targetAudience)) {
          session = await GoalTracker.updateGoalSession(conversationId, {
            ...(momChanged ? { momProfile: nextMom } : {}),
            ...(resolvedAudience ? { targetAudience: resolvedAudience } : {}),
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
        return V3ConversationSummarizer.summarize(session, cleanIncomingText, {
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
      {
        role: 'user',
        content: `<customer_message>\n${cleanIncomingText}\n</customer_message>`,
      },
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

    // ── Hybrid RAG: Deterministic Semantic Pre-Retrieval (Pre-Call 1 Grounding) ──
    // Pertanyaan konsultatif (keluhan, perbedaan treatment, syarat usia, SOP klinik,
    // kehamilan/induksi) otomatis dicarikan artikel resmi knowledge_chunks SEBELUM Call 1.
    // LLM dijamin memegang SOP resmi klinik tanpa bergantung pada insting tool-calling.
    try {
      if (V3AgentRunner.isSubstantiveForPreGrounding(cleanIncomingText)) {
        const { knowledgeBaseService } = await import('../../services/knowledge.service');
        const preChunks = await knowledgeBaseService.searchRelevantChunks(cleanIncomingText, 2, tenantId);
        if (preChunks && preChunks.length > 0) {
          const groundingBlock = `[PANDUAN & KNOWLEDGE BASE RESMI KLINIK - WAJIB DIPATUHI]\n`
            + `Berikut panduan resmi klinik yang RELEVAN dengan pertanyaan customer saat ini. Jadikan sebagai acuan utama jawaban (grounded), jangan mengarang di luar panduan ini:\n`
            + preChunks.map((c: any, i: number) => `Artikel ${i + 1} — ${c.title}:\n${c.content}`).join('\n\n');
          messages[0].content = `${messages[0].content}\n\n${groundingBlock}`;
          for (const c of preChunks as any[]) {
            const key = String((c as any)?.id || (c as any)?.title || '');
            if (key && !retrievedChunkIds.has(key)) {
              retrievedChunkIds.add(key);
              const realScore = typeof (c as any)?.similarity === 'number' ? (c as any).similarity
                : (typeof (c as any)?.score === 'number' ? (c as any).score
                : (typeof (c as any)?.rank === 'number' ? (c as any).rank : 0.9));
              retrievedChunks.push({
                id: String((c as any)?.id || key),
                title: String((c as any)?.title || ''),
                content: String((c as any)?.content || ''),
                similarity: realScore,
                score: realScore,
              } as any);
            }
          }
        }
      }
    } catch (e) {}

    try {
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
      }

      const firstPayload: any = {
        model: selectedModel,
        messages,
        tools: ALL_V3_TOOLS,
        tool_choice: dynamicToolChoice,
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

          // Pengayaan deterministik: bila LLM memanggil save_reservation tanpa
          // data ibu padahal session.momProfile sudah diketahui dari turn
          // sebelumnya, suntikkan agar usia kehamilan tidak hilang saat booking.
          if (fnName === 'save_reservation' && session.momProfile) {
            if (fnArgs.gestationalWeeks == null && session.momProfile.gestationalWeeks != null) {
              fnArgs.gestationalWeeks = session.momProfile.gestationalWeeks;
            }
            if (fnArgs.momStage == null && session.momProfile.stage != null) {
              fnArgs.momStage = session.momProfile.stage;
            }
            if ((fnArgs.momNotes == null || fnArgs.momNotes === '') && (session.momProfile.complaints || []).length > 0) {
              fnArgs.momNotes = session.momProfile.complaints.join(', ');
            }
          }

          console.log(`[V3 AGENT TOOL EXECUTE] Tool: "${fnName}", Args:`, JSON.stringify(maskToolArgsForLogging(fnName, fnArgs)));

          const validation = validateToolArgs(fnName, fnArgs);
          let toolResult: any;
          if (!validation.success) {
            console.warn(JSON.stringify({ event: 'V3_TOOL_SCHEMA_REJECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), tool: fnName, error: validation.error, timestamp: new Date().toISOString() }));
            toolResult = { error: validation.error };
          } else {
            const TOOL_TIMEOUT_MS = fnName === 'calculate_delivery' ? 12000 : 7000;
            try {
              toolResult = await withTimeout(
                executeToolByName(fnName, validation.data, toolContext),
                TOOL_TIMEOUT_MS,
                `Tool "${fnName}" timeout setelah ${TOOL_TIMEOUT_MS}ms`
              );
            } catch (toolErr: any) {
              console.warn(JSON.stringify({ event: 'V3_TOOL_TIMEOUT_ERROR', tenantId, conversationId, phone: maskPhoneNumber(phone), tool: fnName, error: toolErr.message, timestamp: new Date().toISOString() }));
              toolResult = { error: toolErr.message };
            }
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
            // Unified Knowledge Observability: daftarkan spesifikasi katalog resmi
            // ke trace retrievedChunks agar Inspector menampilkan seluruh ground truth
            // (artikel SOP + katalog layanan) yang dipakai LLM di Call 2.
            try {
              if (Array.isArray(toolResult.treatments)) {
                for (const t of toolResult.treatments.slice(0, 5)) {
                  const key = `catalog-${String(t?.id || t?.name || '')}`;
                  if (key && !retrievedChunkIds.has(key)) {
                    retrievedChunkIds.add(key);
                    retrievedChunks.push({
                      id: key,
                      title: `[Katalog Layanan] ${String(t?.name || '')}`,
                      content: `${String(t?.description || '')}\nKategori: ${String(t?.category || '')}, Durasi: ${Number(t?.durationMinutes || 0)} menit, Promo: Rp ${Number(t?.promoPrice || 0).toLocaleString('id-ID')}`,
                      similarity: 1.0,
                      score: 1.0,
                    } as any);
                  }
                }
              }
            } catch (_) {}
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
            // Audience-aware routing (anti cross-contamination 100% di tingkat tool):
            // MOMS/gestationalWeeks/momStage -> momProfile; BABY/KIDS/childAgeMonths -> children.
            const isMomArgs = fnArgs.category === 'MOMS' || fnArgs.category === 'BOTH'
              || fnArgs.gestationalWeeks != null || fnArgs.momStage != null;
            const isChildArgs = fnArgs.category === 'BABY' || fnArgs.category === 'KIDS' || fnArgs.category === 'BOTH'
              || fnArgs.childAgeMonths != null;
            if (isMomArgs) {
              const prevMom = session.momProfile || { complaints: [] as string[] };
              const mergedComplaints = [...(prevMom.complaints || [])];
              for (const s of (fnArgs.symptoms || [])) {
                if (s && !mergedComplaints.includes(s)) mergedComplaints.push(s);
              }
              const patch: any = { complaints: mergedComplaints };
              if (fnArgs.gestationalWeeks != null) patch.gestationalWeeks = fnArgs.gestationalWeeks;
              if (fnArgs.momStage != null) patch.stage = fnArgs.momStage;
              else if (!prevMom.stage && fnArgs.category === 'MOMS') patch.stage = 'GENERAL';
              session = await GoalTracker.updateGoalSession(conversationId, {
                momProfile: { ...prevMom, ...patch },
                ...(fnArgs.category ? { targetAudience: fnArgs.category as any } : {}),
              }, tenantId);
            }
            if (isChildArgs && (fnArgs.childAgeMonths != null || (fnArgs.symptoms && fnArgs.symptoms.length > 0))) {
              // BOTH: gejala anak tetap dicatat ke anak; MOMS-only: JANGAN timpa anak.
              const shouldWriteChild = fnArgs.category !== 'MOMS' || fnArgs.childAgeMonths != null;
              if (shouldWriteChild) {
                const childSymptoms = fnArgs.category === 'BOTH' ? (fnArgs.symptoms || []) : (fnArgs.category === 'MOMS' ? [] : (fnArgs.symptoms || []));
                if (fnArgs.childAgeMonths != null || childSymptoms.length > 0) {
                  const prevChild = session.childProfile || { symptoms: [] as string[] };
                  const merged = [...(prevChild.symptoms || [])];
                  for (const s of childSymptoms) {
                    if (s && !merged.includes(s)) merged.push(s);
                  }
                  session = await GoalTracker.updateGoalSession(conversationId, {
                    childProfile: {
                      ageMonths: fnArgs.childAgeMonths ?? (prevChild as any).ageMonths,
                      symptoms: merged,
                    } as any,
                  }, tenantId);
                }
              }
            } else if (!isMomArgs && !isChildArgs && fnArgs.symptoms && fnArgs.symptoms.length > 0) {
              // Fallback lama: tanpa kategori eksplisit, perlakukan sebagai gejala anak
              // KECUALI pesan murni maternal (sudah ditangani momProfile via syncMomProfile).
              if (!GoalTracker.isMaternalOnlyMessage(cleanIncomingText)) {
                session = await GoalTracker.updateGoalSession(conversationId, {
                  childProfile: {
                    ageMonths: fnArgs.childAgeMonths,
                    symptoms: fnArgs.symptoms || [],
                  },
                }, tenantId);
              }
            }
          } else if (fnName === 'save_reservation' && toolResult.success) {
            // Reservasi tercatat sebagai pending (ketersediaan dicekkan tim Bidan);
            // isConfirmed tetap false agar state = RESERVATION_SENT, bukan COMPLETED.
            session = await GoalTracker.updateGoalSession(conversationId, {
              selectedTreatment: fnArgs.treatmentName,
              booking: {
                preferredDate: fnArgs.bookingDate,
                preferredTime: fnArgs.bookingTime,
                reservationId: toolResult.reservationId,
                isConfirmed: false,
              },
            }, tenantId);
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

      const numCheck = validateNumericFacts(finalReply, executedTools, { tenantId, session });
      if (!numCheck.isValid && executedTools.length > 0) {
        console.warn(JSON.stringify({ event: 'NUMERIC_HALLUCINATION_DETECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: numCheck.violations, timestamp: new Date().toISOString() }));
        // Gunakan suggestedPriceReply / suggestedTemplateReply dari tool jika ada
        const fallbackToolReply = executedTools[0]?.result?.suggestedPriceReply || executedTools[0]?.result?.suggestedTemplateReply;
        if (fallbackToolReply) {
          finalReply = fallbackToolReply;
        }
      }

      // Post-processor deterministik: konversi Markdown ganda (**tebal**) ke
      // format WhatsApp tunggal (*tebal*) untuk SEMUA output agent — berlaku di
      // simulator, dashboard, log LLM, maupun WAHA (sebelum validasi & logging).
      finalReply = normalizeWhatsAppFormat(finalReply);

      if (!OutputSanitizer.isValidReply(finalReply)) {
        console.warn(JSON.stringify({ event: 'V3_AGENT_SANITIZER_REJECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), reply: finalReply.slice(0, 100), timestamp: new Date().toISOString() }));
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
      console.error(JSON.stringify({ event: 'V3_AGENT_RUNNER_ERROR', tenantId, conversationId, phone: maskPhoneNumber(phone), error: err.response?.data || err.message, timestamp: new Date().toISOString() }));

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

import axios from 'axios';
import { ALL_V3_TOOLS, executeToolByName, ToolExecutionContext } from '../tools/tool-registry';
import { CustomerGoalSession, GoalTracker } from '../state/goal-tracker';
import { PersonaPromptBuilder } from './persona';
import { OutputSanitizer } from '../guardrails/sanitizer';
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
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  forceModel?: string;
  skipDbLogging?: boolean;
}

export interface AgentRunnerOutput {
  replyText: string;
  executedTools: Array<{ name: string; args: any; result: any }>;
  updatedSession: CustomerGoalSession;
  shouldSendReply: boolean;
  isEscalated: boolean;
}

export class V3AgentRunner {
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

    // 3. Susun percakapan dengan auto-rehydrate dari DB jika history kosong
    let conversationHistory = [...history];
    if (conversationHistory.length === 0 && conversationId) {
      try {
        const recentDbMessages = await prisma.message.findMany({
          where: { conversation_id: conversationId },
          orderBy: { created_at: 'desc' },
          take: 8,
        });
        conversationHistory = recentDbMessages.reverse().map((m) => ({
          role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        }));
      } catch (e) {}
    }

    const isFollowUp = conversationHistory.length > 0;
    const systemPrompt = PersonaPromptBuilder.buildSystemPrompt(session, isFollowUp);
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-6).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: incomingText },
    ];

    const executedTools: Array<{ name: string; args: any; result: any }> = [];
    let isEscalated = false;
    let shouldSendReply = true;
    let finalReply = '';

    try {
      // 4. Panggilan Pertama: Model mengevaluasi apakah perlu memanggil Tools
      const firstPayload: any = {
        model: selectedModel,
        messages,
        tools: ALL_V3_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
      };

      const firstData = await V3AgentRunner.executeChatCompletion({
        payload: firstPayload,
        tenantId,
        phone,
        conversationId,
        baseUrl,
        apiKey,
        selectedModel,
      });

      const choice = firstData?.choices?.[0];
      const assistantMessage = choice?.message;
      const toolCalls = assistantMessage?.tool_calls;

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
          return {
            replyText: '',
            executedTools,
            updatedSession: session,
            shouldSendReply: false,
            isEscalated: true,
          };
        }

        // 6. Panggilan Kedua: Menyusun teks balasan ramah Bidan Yusi menggunakan fakta tool
        // Perbarui system prompt di messages[0] dengan session terbaru yang telah di-grounding hasil tools
        messages[0].content = PersonaPromptBuilder.buildSystemPrompt(session, isFollowUp);

        const secondPayload: any = {
          model: selectedModel,
          messages,
          temperature: 0.65,
        };

        const secondData = await V3AgentRunner.executeChatCompletion({
          payload: secondPayload,
          tenantId,
          phone,
          conversationId,
          baseUrl,
          apiKey,
          selectedModel,
        });

        finalReply = secondData?.choices?.[0]?.message?.content || '';
      } else {
        // Jika tidak ada tool calls, gunakan langsung konten balasan
        finalReply = assistantMessage?.content || '';
      }

      // 7. Sanitasi Balasan
      finalReply = OutputSanitizer.cleanOutboundReply(finalReply);

      if (!OutputSanitizer.isValidReply(finalReply)) {
        console.warn(`[V3 AGENT WARNING] Reply rejected by sanitizer: "${finalReply}". Triggering silent fallback.`);
        finalReply = `Halo ${session.genderGreeting} 😊\n\nTerima kasih sudah menghubungi kami di Kala Moms & Baby Spa. Ada yang bisa Bidan Yusi bantu untuk perawatan Bunda atau si kecil hari ini? ✨`;
      }

      if (conversationId && !input.skipDbLogging) {
        try {
          await prisma.message.create({
            data: {
              tenant_id: tenantId,
              conversation_id: conversationId,
              direction: 'INBOUND',
              content: incomingText,
              sender_type: 'CUSTOMER',
            },
          });
          if (finalReply && !isEscalated) {
            await prisma.message.create({
              data: {
                tenant_id: tenantId,
                conversation_id: conversationId,
                direction: 'OUTBOUND',
                content: finalReply,
                sender_type: 'BOT',
              },
            });
          }
        } catch (e) {}
      }

      return {
        replyText: finalReply,
        executedTools,
        updatedSession: session,
        shouldSendReply: shouldSendReply && !isEscalated,
        isEscalated,
      };
    } catch (err: any) {
      console.error('[V3 AGENT RUNNER ERROR]', err.response?.data || err.message);
      
      // Fallback ramah jika terjadi outage koneksi
      const fallbackReply = `Halo ${session.genderGreeting} 😊\n\nTerima kasih sudah menghubungi Kala Moms & Baby Spa. Kami siap membantu layanan Homecare treatment untuk Bunda dan si kecil. Boleh dibantu info daerah tempat tinggalnya ya Bund? 🙏`;
      
      return {
        replyText: fallbackReply,
        executedTools: [],
        updatedSession: session,
        shouldSendReply: true,
        isEscalated: false,
      };
    }
  }
}

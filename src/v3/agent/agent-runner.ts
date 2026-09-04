import axios from 'axios';
import { ALL_V3_TOOLS, executeToolByName, ToolExecutionContext } from '../tools/tool-registry';
import { CustomerGoalSession, GoalTracker } from '../state/goal-tracker';
import { PersonaPromptBuilder } from './persona';
import { OutputSanitizer } from '../guardrails/sanitizer';
import { getLlmEndpointConfig } from '../../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface AgentRunnerInput {
  tenantId?: string;
  customerId: string;
  conversationId: string;
  phone: string;
  chatId: string;
  incomingText: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  forceModel?: string;
}

export interface AgentRunnerOutput {
  replyText: string;
  executedTools: Array<{ name: string; args: any; result: any }>;
  updatedSession: CustomerGoalSession;
  shouldSendReply: boolean;
  isEscalated: boolean;
}

export class V3AgentRunner {
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

    const toolContext: ToolExecutionContext = {
      tenantId,
      customerId,
      conversationId,
      phone,
      chatId,
    };

    // 1. Ambil session state saat ini
    let session = await GoalTracker.getGoalSession(conversationId, tenantId);

    // 2. Siapkan LLM endpoint & API keys
    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpointConfig = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' });
    const selectedModel = forceModel || modelConfig?.modelName || 'gpt-4o-mini';
    const baseUrl = endpointConfig.baseUrl;
    const apiKey = endpointConfig.apiKey;

    // 3. Susun percakapan awal
    const systemPrompt = PersonaPromptBuilder.buildSystemPrompt(session);
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
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
        temperature: 0.3,
      };

      const firstResponse = await axios.post(`${baseUrl}/chat/completions`, firstPayload, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });

      const choice = firstResponse.data?.choices?.[0];
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
        const secondPayload: any = {
          model: selectedModel,
          messages,
          temperature: 0.5,
        };

        const secondResponse = await axios.post(`${baseUrl}/chat/completions`, secondPayload, {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 15000,
        });

        finalReply = secondResponse.data?.choices?.[0]?.message?.content || '';
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

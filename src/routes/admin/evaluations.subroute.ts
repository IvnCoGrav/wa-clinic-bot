import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import type { IWahaClient } from '../../integrations/waha/client';

const sandboxPhoneLocks = new Map<string, Promise<any>>();

export async function evaluationsAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/sandbox/chat
   * Simulate a chat message (or burst messages) and inspect RAG retrieval & LLM generation
   */
  fastify.post(
    '/api/admin/sandbox/chat',
    {
      config: {
        rateLimit: {
          max: process.env.NODE_ENV === 'test' ? 30 : 300,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { text?: string; messages?: string[]; simulateOutage?: boolean; sandboxPhone?: string } }>,
      reply: FastifyReply
    ) => {
      const { text, messages, simulateOutage, sandboxPhone } = request.body || {};
      const rawTextList = Array.isArray(messages) && messages.length > 0
        ? messages.filter((m) => typeof m === 'string' && m.trim().length > 0)
        : typeof text === 'string' && text.trim().length > 0 ? [text] : [];

      if (rawTextList.length === 0) {
        return reply.status(400).send({ error: 'Text or messages field is required' });
      }
      const targetPhone = sandboxPhone || '628999999999';
      const combinedRawText = rawTextList.join('\n');

      const prevLock = sandboxPhoneLocks.get(targetPhone) || Promise.resolve();
      const currentTask = prevLock.catch(() => {}).then(async () => {
        const { llmOutageStorage } = await import('../../integrations/llm/context');

        return llmOutageStorage.run({ simulateOutage: Boolean(simulateOutage) }, async () => {
        try {
          const { knowledgeBaseService } = await import('../../services/knowledge.service');
          const { customerService } = await import('../../services/customer.service');
          const { conversationService } = await import('../../services/conversation.service');
          const { ConversationStateMachine } = await import('../../state-machine/machine');
          const { TypingService } = await import('../../services/typing.service');

          class SandboxWAHAClient implements IWahaClient {
            public sentMessages: Array<{ type: 'text' | 'image'; text: string; fileUrl?: string }> = [];

            public async sendSeen(chatId: string, messageId?: string): Promise<boolean> {
              return true;
            }
            public async startTyping(chatId: string): Promise<boolean> {
              return true;
            }
            public async stopTyping(chatId: string): Promise<boolean> {
              return true;
            }
            public async sendText(chatId: string, text: string): Promise<boolean> {
              this.sentMessages.push({ type: 'text', text });
              return true;
            }
            public async sendImage(chatId: string, fileUrl: string, caption?: string): Promise<boolean> {
              try {
                const imageTag = `🖼️ [Media Gambar Terkirim]\nURL: ${fileUrl}${caption ? '\nCaption: ' + caption : ''}`;
                this.sentMessages.push({
                  type: 'image',
                  text: imageTag,
                  fileUrl,
                });
                return true;
              } catch (err: any) {
                this.sentMessages.push({
                  type: 'text',
                  text: '🖼️ [Gagal kirim media gambar di sandbox]',
                });
                return false;
              }
            }
            public async addLabel(chatId: string, labelId: string): Promise<boolean> {
              return true;
            }
            public async removeLabel(chatId: string, labelId: string): Promise<boolean> {
              return true;
            }
            public async getChatLabels(chatId: string): Promise<string[]> {
              return [];
            }
            public async getChatLabelsOrNull(chatId: string): Promise<string[] | null> {
              return [];
            }

            public async getSessionStatus(session?: string): Promise<string> {
              return 'WORKING';
            }
            public async startSession(session?: string): Promise<string> {
              return 'WORKING';
            }
            public async stopSession(session?: string): Promise<boolean> {
              return true;
            }
            public async getSession(session?: string): Promise<any | null> {
              return null;
            }
            public async deleteSession(session?: string): Promise<boolean> {
              return true;
            }
            public async createSession(session?: string, config?: any): Promise<string> {
              return 'CREATED';
            }
            public async getAuthQr(session?: string): Promise<import('../../integrations/waha/client').WahaQr | null> {
              return null;
            }
            public async getChats(): Promise<any[]> {
              return [];
            }
            public async deleteMessage(chatId: string, messageId: string, everyone = true): Promise<boolean> {
              return true;
            }
            public async editMessage(chatId: string, messageId: string, newText: string): Promise<boolean> {
              return true;
            }
            public async getMessages(chatId: string, limit?: number): Promise<any[]> {
              return [];
            }
            public async getContact(phone: string): Promise<import('../../integrations/waha/client').WahaContact | null> {
              return null;
            }
            public async getPhoneNumberFromLid(chatId: string): Promise<string | null> {
              return targetPhone;
            }
            public async downloadMedia(messageId: string, chatId: string): Promise<Buffer | null> {
              return Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64'
              );
            }
            public async sendReaction(chatId: string, messageId: string, emoji: string): Promise<boolean> {
              return true;
            }
          }

          const sandboxClient = new SandboxWAHAClient();
          const sandboxTypingService = new TypingService(sandboxClient);
          sandboxTypingService.setSpeedFactor(100000);

          const sandboxStateMachine = new ConversationStateMachine(sandboxTypingService);

          const customer = await customerService.getOrCreateCustomer(targetPhone, 'Sandbox Customer', DEFAULT_TENANT_ID);
          try {
            await prisma.customer.update({
              where: { id: customer.id },
              data: { is_sandbox_test: true },
            });
          } catch (e) {}

          let conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

          if (combinedRawText.trim().toLowerCase() === '/reset') {
            await customerService.clearPendingLocation(customer.id, DEFAULT_TENANT_ID);
            conversation = await conversationService.updateConversationState(
              conversation.id,
              {
                currentState: 'INITIAL',
                previousState: null,
                locationAttempts: 0,
                isHumanHandling: false,
                humanHandlingSince: null,
                escalationReason: null,
              },
              DEFAULT_TENANT_ID
            );
            return {
              answer:
                'Sesi percakapan simulator berhasil di-reset ke INITIAL! 🌸 Silakan ketik "halo" atau sapaan lainnya untuk mulai menguji.',
              chunks: [],
              query: combinedRawText,
              burstCount: rawTextList.length,
              timestamp: new Date(),
            };
          }

          let incomingMessage: any;
          const locationMatch = combinedRawText.match(/^\/location\s+([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)/i);

          if (locationMatch) {
            incomingMessage = {
              id: `msg_sandbox_${Date.now()}`,
              from: targetPhone,
              chatId: `${targetPhone}@c.us`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'location',
              location: {
                latitude: parseFloat(locationMatch[1]),
                longitude: parseFloat(locationMatch[2]),
              },
            };
          } else {
            const strippedList = rawTextList.map((t) =>
              t.replace(/(?:Promo|ID|Iklan|Diskon)?\s*\[\s*[\w\s]{1,10}?\s*\]/gi, '').trim() || t
            );
            const strippedCombinedText = strippedList.join('\n');

            incomingMessage = {
              id: `msg_sandbox_${Date.now()}`,
              from: targetPhone,
              chatId: `${targetPhone}@c.us`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text',
              text: { body: strippedCombinedText },
              _rawBody: combinedRawText,
              originalText: combinedRawText,
              burstMessages: rawTextList,
              burstCount: rawTextList.length,
            };
          }

          await sandboxStateMachine.processMessage({
            tenantId: DEFAULT_TENANT_ID,
            customer,
            conversation,
            incomingMessage,
          });

          const chunks = await knowledgeBaseService.searchRelevantChunks(
            incomingMessage.text?.body || '',
            3,
            DEFAULT_TENANT_ID
          );

          const sentBubbles = sandboxClient.sentMessages.map((m) => m.text);
          const answer =
            sentBubbles.length > 0
              ? sentBubbles.join('\n\n')
              : '🌸 [Bot sedang diam - Percakapan dialihkan ke Human Handling / Bidan]';

          return {
            answer,
            sentBubbles,
            chunks,
            query: combinedRawText,
            burstCount: rawTextList.length,
            timestamp: new Date(),
            llmError: simulateOutage ? 'Primary LLM provider connection timeout (500 Internal Server Error)' : null,
          };
        } catch (err: any) {
          return {
            answer: `Error processing sandbox message: ${err.message}`,
            chunks: [],
            query: combinedRawText,
            burstCount: rawTextList.length,
            timestamp: new Date(),
            llmError: err.message,
          };
        }
      });
      });

      sandboxPhoneLocks.set(targetPhone, currentTask);
      const result = await currentTask;
      return reply.send(result);
    }
  );

  /**
   * POST /api/admin/sandbox/cleanup
   */
  fastify.post('/api/admin/sandbox/cleanup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const deleted = await prisma.customer.deleteMany({
        where: {
          OR: [{ is_sandbox_test: true }, { phone: { startsWith: '6289999' } }],
        },
      });
      return reply
        .status(200)
        .send({ success: true, message: `Successfully cleaned up ${deleted.count} sandbox test records.` });
    } catch (err: any) {
      return reply.status(200).send({ success: true, message: 'Sandbox cleanup complete.' });
    }
  });

  /**
   * GET /api/admin/ai-evaluations
   */
  fastify.get(
    '/api/admin/ai-evaluations',
    async (request: FastifyRequest<{ Querystring: { days?: string; limit?: string } }>, reply: FastifyReply) => {
      try {
        const days = Math.max(1, Math.min(90, parseInt(request.query?.days || '7', 10) || 7));
        const limit = Math.max(1, Math.min(200, parseInt(request.query?.limit || '100', 10) || 100));
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const where = { tenant_id: DEFAULT_TENANT_ID, created_at: { gte: since } };

        const [recent, total] = await Promise.all([
          prisma.aiEvaluation.findMany({ where, orderBy: { created_at: 'desc' }, take: limit }),
          prisma.aiEvaluation.count({ where }),
        ]);

        const stats = await prisma.aiEvaluation.aggregate({
          where,
          _avg: { score: true },
          _min: { score: true },
          _max: { score: true },
        });

        return reply.status(200).send({
          success: true,
          data: {
            total,
            avgScore: stats._avg.score ?? 0,
            minScore: stats._min.score ?? 0,
            maxScore: stats._max.score ?? 0,
            recent,
          },
        });
      } catch (err: any) {
        return reply
          .status(200)
          .send({ success: true, data: { total: 0, avgScore: 0, minScore: 0, maxScore: 0, recent: [] } });
      }
    }
  );

  /**
   * GET /api/admin/ai-audit-summary
   * Aggregates real-time LLM audit logs (tokens, cost_idr, model breakdown, recent transactions)
   */
  fastify.get(
    '/api/admin/ai-audit-summary',
    async (request: FastifyRequest<{ Querystring: { days?: string; limit?: string } }>, reply: FastifyReply) => {
      try {
        const days = Math.max(1, Math.min(90, parseInt(request.query?.days || '7', 10) || 7));
        const limit = Math.max(1, Math.min(200, parseInt(request.query?.limit || '50', 10) || 50));
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const where = { tenant_id: DEFAULT_TENANT_ID, created_at: { gte: since } };

        const [recent, totalLogs, stats] = await Promise.all([
          prisma.llmAuditLog.findMany({ where, orderBy: { created_at: 'desc' }, take: limit }),
          prisma.llmAuditLog.count({ where }),
          prisma.llmAuditLog.aggregate({
            where,
            _sum: { prompt_tokens: true, completion_tokens: true, cost_idr: true },
          }),
        ]);

        const totalPromptTokens = stats._sum.prompt_tokens ?? 0;
        const totalCompletionTokens = stats._sum.completion_tokens ?? 0;
        const totalCostIdr = stats._sum.cost_idr ?? 0;

        const formattedRecent = recent.map((item) => ({
          ...item,
          // Provider asli dari DB (deriveProvider baseUrl aktual: SumoPod / DeepSeek Direct),
          // bukan ditimpa mapping nama model — supaya dashboard jujur soal jalur request.
        }));

        return reply.status(200).send({
          success: true,
          data: {
            days,
            totalLogs,
            totalPromptTokens,
            totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
            totalCostIdr,
            recent: formattedRecent,
          },
        });
      } catch (err: any) {
        return reply.status(200).send({
          success: true,
          data: {
            days: 7,
            totalLogs: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalCostIdr: 0,
            recent: [],
          },
        });
      }
    }
  );

  /**
   * GET /api/admin/debug/system
   */
  fastify.get('/api/admin/debug/system', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { collectSystemInfo } = await import('../../services/system-debug.service');
      const info = await collectSystemInfo();
      return reply.status(200).send({ success: true, data: info });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err?.message });
    }
  });

  /**
   * GET /api/admin/debug/ai-router
   */
  fastify.get(
    '/api/admin/debug/ai-router',
    async (request: FastifyRequest<{ Querystring: { days?: string } }>, reply: FastifyReply) => {
      try {
        const { collectAiRouterSummary } = await import('../../services/system-debug.service');
        const days = Math.max(1, Math.min(90, parseInt(request.query?.days || '7', 10) || 7));
        const summary = await collectAiRouterSummary(days);
        return reply.status(200).send({ success: true, data: summary });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/debug/logs
   */
  fastify.get(
    '/api/admin/debug/logs',
    async (request: FastifyRequest<{ Querystring: { limit?: string; level?: string } }>, reply: FastifyReply) => {
      try {
        const { getLogBuffer, getLogBufferStats, isLogBufferInstalled } = await import(
          '../../services/system-debug.service'
        );
        const limit = Math.max(1, Math.min(500, parseInt(request.query?.limit || '200', 10) || 200));
        const level = (request.query?.level || 'all') as any;
        return reply.status(200).send({
          success: true,
          data: {
            installed: isLogBufferInstalled(),
            stats: getLogBufferStats(),
            entries: getLogBuffer(limit, level),
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/debug/messages
   */
  fastify.get(
    '/api/admin/debug/messages',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      try {
        const { collectRecentMessages } = await import('../../services/system-debug.service');
        const limit = parseInt(request.query?.limit || '50', 10) || 50;
        const data = await collectRecentMessages(limit);
        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/debug/conversations
   */
  fastify.get(
    '/api/admin/debug/conversations',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      try {
        const { collectConversationTrace } = await import('../../services/system-debug.service');
        const limit = parseInt(request.query?.limit || '50', 10) || 50;
        const data = await collectConversationTrace(limit);
        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/debug/llm-logs
   * Dedicated LLM reasoning & execution log feed (flat)
   */
  fastify.get(
    '/api/admin/debug/llm-logs',
    async (
      request: FastifyRequest<{ Querystring: { limit?: string; flow?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const { getLlmExecutionLogs } = await import('../../utils/llm-execution-logger');
        const limit = Math.max(1, Math.min(300, parseInt(request.query?.limit || '100', 10) || 100));
        const flow = request.query?.flow || 'all';
        const logs = getLlmExecutionLogs(limit, flow);
        return reply.status(200).send({ success: true, data: logs });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/debug/llm-grouped-logs
   * Hierarchical 3-Level LLM execution log feed:
   * Level 1: Customer Phone
   * Level 2: Chat Bubble
   * Level 3: AI Calls (NLU, Router, Generator, Verifier)
   */
  fastify.get(
    '/api/admin/debug/llm-grouped-logs',
    async (
      request: FastifyRequest<{ Querystring: { limit?: string; flow?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const { getGroupedLlmExecutionLogs } = await import('../../utils/llm-execution-logger');
        const limit = Math.max(1, Math.min(500, parseInt(request.query?.limit || '200', 10) || 200));
        const flow = request.query?.flow || 'all';
        const groupedLogs = getGroupedLlmExecutionLogs(limit, flow);
        return reply.status(200).send({ success: true, data: groupedLogs });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );

  /**
   * DELETE /api/admin/debug/llm-logs
   * Reset / bersihkan buffer log eksekusi LLM
   */
  fastify.delete(
    '/api/admin/debug/llm-logs',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { clearLlmExecutionLogs } = await import('../../utils/llm-execution-logger');
        clearLlmExecutionLogs();
        return reply.status(200).send({ success: true, message: 'Buffer LLM execution logs berhasil dibersihkan.' });
      } catch (err: any) {
        return reply.status(500).send({ success: false, message: err?.message });
      }
    }
  );
}

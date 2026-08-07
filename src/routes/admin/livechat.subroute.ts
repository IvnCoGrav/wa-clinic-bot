import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { liveChatService } from '../../services/live-chat.service';
import { getLiveChatHub } from '../../services/live-chat-hub.service';
import { conversationService, buildConversationUpdatedPayload } from '../../services/conversation.service';
import { ConversationState } from '@prisma/client';

export async function livechatAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/human-handling-conversations
   * REST Endpoint untuk melihat daftar percakapan yang aktif diserahkan ke Human Agent.
   */
  fastify.get('/api/admin/human-handling-conversations', async (request, reply) => {
    try {
      const activeHumanHandling = await prisma.conversation.findMany({
        where: { is_human_handling: true, tenant_id: DEFAULT_TENANT_ID },
        include: {
          customer: true,
          messages: {
            orderBy: { created_at: 'desc' },
            take: 5,
          },
        },
        orderBy: { human_handling_since: 'asc' },
      });

      return reply.status(200).send({
        success: true,
        count: activeHumanHandling.length,
        data: activeHumanHandling,
      });
    } catch (error) {
      return reply.status(200).send({
        success: true,
        count: 0,
        data: [],
        note: 'Fallback in-memory mode',
      });
    }
  });

  /**
   * GET /api/admin/live-chat/conversations
   * Monitor Live Chat: daftar percakapan terbaru + preview pesan (termasuk sender_type/sender_name).
   */
  fastify.get(
    '/api/admin/live-chat/conversations',
    async (
      request: FastifyRequest<{
        Querystring: { limit?: string; offset?: string };
      }>,
      reply
    ) => {
      try {
        const limit = Math.min(Math.max(parseInt(request.query.limit || '50', 10) || 50, 1), 200);
        const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
        const { items, hasMore } = await liveChatService.getConversationList(DEFAULT_TENANT_ID, limit, offset);
        return reply.status(200).send({ success: true, count: items.length, hasMore, data: items });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/live-chat/conversations/:id/messages
   * Thread pesan sebuah percakapan (kronologis).
   */
  fastify.get(
    '/api/admin/live-chat/conversations/:id/messages',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      try {
        const messages = await liveChatService.getConversationMessages(id, DEFAULT_TENANT_ID);
        return reply.status(200).send({ success: true, count: messages.length, data: messages });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/live-chat/conversations/:id/reply
   * Admin membalas percakapan dari dashboard (disimpan sebagai sender_type=ADMIN).
   */
  fastify.post(
    '/api/admin/live-chat/conversations/:id/reply',
    {
      bodyLimit: 12 * 1024 * 1024, // izinkan upload gambar via base64 (maks ~8MB gambar)
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          text?: string;
          imageB64?: string;
          thumbB64?: string;
          mimeType?: string;
          fileName?: string;
          adminName?: string;
          acknowledgeOutsideWindow?: boolean;
        };
      }>,
      reply
    ) => {
      const { id } = request.params;
      const { text, imageB64, thumbB64, mimeType, fileName, adminName, acknowledgeOutsideWindow } = request.body || {};

      const result = await liveChatService.sendAdminReply({
        conversationId: id,
        text: text || '',
        imageB64,
        thumbB64,
        mimeType,
        fileName,
        tenantId: DEFAULT_TENANT_ID,
        adminName,
        acknowledgeOutsideWindow,
      });

      if (!result.success) {
        const code = result.error?.code || 'REPLY_FAILED';
        const status =
          code === 'WABA_OUTSIDE_WINDOW'
            ? 409
            : code === 'CONVERSATION_NOT_FOUND' || code === 'CUSTOMER_NOT_FOUND'
            ? 404
            : 400;
        return reply.status(status).send({ success: false, error: result.error, data: result });
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'LIVE_CHAT_ADMIN_REPLY',
        targetId: id,
        payload: { adminName, messageId: result.messageId, provider: result.provider },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, message: 'Balasan admin berhasil dikirim.', data: result });
    }
  );

  /**
   * GET /api/admin/live-chat/events
   * Server-Sent Events: stream real-time Live Chat (message.created & conversation.updated).
   */
  fastify.get('/api/admin/live-chat/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = DEFAULT_TENANT_ID;

    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    let closed = false;
    let unsubscribe: (() => void) | null = null;

    const sendEvent = (event: any) => {
      if (closed) return;
      try {
        const data = JSON.stringify(event.payload || {});
        reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
      } catch (err: any) {
        console.error('[LIVE CHAT SSE] Failed to serialize event:', err.message);
      }
    };

    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(': ping\n\n');
      } catch (err) {}
    }, 15000);
    if ((heartbeat as any).unref) (heartbeat as any).unref();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    };
    request.raw.once('close', cleanup);
    reply.raw.once('close', cleanup);

    try {
      unsubscribe = await getLiveChatHub().subscribe(tenantId, sendEvent);
      if (closed) cleanup();
    } catch (err: any) {
      console.error('[LIVE CHAT SSE] Subscribe hub gagal:', err.message);
      cleanup();
    }
  });

  /**
   * PATCH /api/admin/conversation/:id/release
   * Endpoint manual release untuk mengembalikan thread dari HUMAN_HANDLING ke state aktif bot.
   */
  fastify.patch(
    '/api/admin/conversation/:id/release',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      let restoredState = 'INITIAL';
      try {
        let existing: any = null;
        try {
          existing = await prisma.conversation.findUnique({ where: { id } });
        } catch {
          existing = null;
        }
        if (!existing) {
          existing = await conversationService.getConversationById(id, DEFAULT_TENANT_ID);
        }
        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Conversation tidak ditemukan.' });
        }
        if (!existing.is_human_handling) {
          return reply
            .status(409)
            .send({ success: false, error: 'Conversation sedang ditangani bot — tidak perlu di-release.' });
        }
        restoredState = existing.previous_state || 'INITIAL';

        const updated = await prisma.conversation.update({
          where: { id },
          data: {
            is_human_handling: false,
            human_handling_since: null,
            escalation_reason: null,
            current_state: restoredState as any,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CONVERSATION_MANUAL_RELEASE',
          targetId: id,
          payload: { releasedAt: new Date(), restoredState },
          ipAddress: request.ip,
        });

        const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL !== 'false';
        if (enableHoldLabel) {
          try {
            const { wahaClient } = await import('../../integrations/waha/client');
            const customer = await prisma.customer.findUnique({ where: { id: updated.customer_id } });
            if (customer) {
              await wahaClient.removeLabel(`${customer.phone}@c.us`, 'hold');
            }
          } catch (err: any) {
            console.warn(`[LABEL ERROR] Failed to auto-remove hold label during manual admin release:`, err.message);
          }
        }

        getLiveChatHub()
          .publish({
            type: 'conversation.updated',
            tenantId: DEFAULT_TENANT_ID,
            payload: buildConversationUpdatedPayload(updated),
          })
          .catch(() => {});

        return reply.status(200).send({
          success: true,
          message: `Percakapan berhasil di-release kembali ke bot (Restored state: ${restoredState}).`,
          data: updated,
        });
      } catch (err: any) {
        try {
          await conversationService.updateConversationState(
            id,
            {
              currentState: restoredState as ConversationState,
              isHumanHandling: false,
              humanHandlingSince: null,
              escalationReason: null,
            },
            DEFAULT_TENANT_ID
          );
        } catch (memErr: any) {
          console.warn('[ADMIN RELEASE] Failed to update in-memory conversation:', memErr.message);
        }
        return reply.status(200).send({
          success: true,
          message: `Percakapan berhasil di-release (Fallback Mode - Restored state: ${restoredState}).`,
        });
      }
    }
  );
}

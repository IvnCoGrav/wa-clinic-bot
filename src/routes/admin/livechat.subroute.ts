import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { liveChatService } from '../../services/live-chat.service';
import { getLiveChatHub } from '../../services/live-chat-hub.service';
import { conversationService, buildConversationUpdatedPayload } from '../../services/conversation.service';
import { customerService } from '../../services/customer.service';
import { messageService } from '../../services/message.service';
import { responseCacheService } from '../../services/response-cache.service';
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
   * Query `mode`: all (default) | real (WhatsApp asli) | sandbox (chat test/simulasi QA).
   */
  fastify.get(
    '/api/admin/live-chat/conversations',
    async (
      request: FastifyRequest<{
        Querystring: { limit?: string; offset?: string; mode?: string; search?: string };
      }>,
      reply
    ) => {
      try {
        const limit = Math.min(Math.max(parseInt(request.query.limit || '50', 10) || 50, 1), 200);
        const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
        const modeRaw = request.query.mode || 'all';
        const mode: 'all' | 'real' | 'sandbox' =
          modeRaw === 'real' || modeRaw === 'sandbox' ? modeRaw : 'all';
        const search = request.query.search?.trim();

        // Check server-side cache (hanya untuk list tanpa pencarian teks spesifik)
        const cacheKey = !search ? `livechat:list:${DEFAULT_TENANT_ID}:${mode}:${limit}:${offset}` : null;
        if (cacheKey) {
          const cached = responseCacheService.get(cacheKey);
          if (cached) {
            return reply
              .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
              .status(200)
              .send(cached);
          }
        }

        const { items, hasMore } = await liveChatService.getConversationList(DEFAULT_TENANT_ID, limit, offset, mode, search);
        const payload = { success: true, count: items.length, hasMore, mode, data: items };
        if (cacheKey) {
          responseCacheService.set(cacheKey, payload, 5); // 5s TTL
        }
        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send(payload);
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/live-chat/unread-count
   * Endpoint cepat & sangat ringan untuk menghitung total pesan unread badge di sidebar.
   */
  fastify.get('/api/admin/live-chat/unread-count', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    try {
      const cacheKey = `livechat:unread:${tenantId}`;
      const cached = responseCacheService.get<number>(cacheKey);
      if (cached !== null && cached !== undefined) {
        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send({ success: true, count: cached });
      }

      const count = await messageService.getTotalUnreadCount(tenantId);
      responseCacheService.set(cacheKey, count, 5);
      return reply
        .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
        .status(200)
        .send({ success: true, count });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message || 'Gagal menghitung unread count' });
    }
  });

  /**
   * POST /api/admin/live-chat/sync-history
   * Backfill history chat dari WAHA ke DB bot (batch per `limit`, idempoten by wa_message_id).
   * Response berisi nextOffset + hasMore untuk "Load More" lanjutan.
   */
  fastify.post(
    '/api/admin/live-chat/sync-history',
    async (
      request: FastifyRequest<{
        Body: { limit?: number; offset?: number; messagesPerChat?: number };
      }>,
      reply
    ) => {
      const body = request.body || {};
      const limit = Math.min(Math.max(parseInt(String(body.limit || '50'), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(String(body.offset || '0'), 10) || 0, 0);
      const messagesPerChat = Math.min(Math.max(parseInt(String(body.messagesPerChat || '100'), 10) || 100, 1), 500);

      const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
      const result = await wahaHistorySyncService.syncChats(limit, offset, messagesPerChat, DEFAULT_TENANT_ID);

      if (!result.success) {
        return reply.status(500).send({ success: false, error: result.error || 'Sync history gagal.' });
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'LIVE_CHAT_SYNC_HISTORY',
        targetId: DEFAULT_TENANT_ID,
        payload: { limit, offset, messagesPerChat, syncedChats: result.syncedChats, syncedMessages: result.syncedMessages, totalChats: result.totalChats },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, data: result });
    }
  );

  /**
   * POST /api/admin/live-chat/sync-full
   * Memulai proses sinkronisasi seluruh riwayat chat WhatsApp di latar belakang (background sync).
   */
  fastify.post(
    '/api/admin/live-chat/sync-full',
    async (
      request: FastifyRequest<{
        Body: { messagesPerChat?: number };
      }>,
      reply
    ) => {
      const body = request.body || {};
      const messagesPerChat = Math.min(Math.max(parseInt(String(body.messagesPerChat || '100'), 10) || 100, 1), 500);

      const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
      const result = await wahaHistorySyncService.startBackgroundFullSync(messagesPerChat, DEFAULT_TENANT_ID);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'LIVE_CHAT_SYNC_FULL_START',
        targetId: DEFAULT_TENANT_ID,
        payload: { messagesPerChat, started: result.started },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, ...result });
    }
  );

  /**
   * GET /api/admin/live-chat/sync-status
   * Memeriksa status & progres sinkronisasi riwayat chat di latar belakang.
   */
  fastify.get('/api/admin/live-chat/sync-status', async (request, reply) => {
    const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
    const status = wahaHistorySyncService.getBackgroundSyncStatus(DEFAULT_TENANT_ID);
    return reply.status(200).send({ success: true, data: status });
  });

  /**
   * POST /api/admin/live-chat/sync-cancel
   * Membatalkan proses sinkronisasi latar belakang yang sedang berjalan.
   */
  fastify.post('/api/admin/live-chat/sync-cancel', async (request, reply) => {
    const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
    const cancelled = wahaHistorySyncService.stopBackgroundSync(DEFAULT_TENANT_ID);
    return reply.status(200).send({ success: true, cancelled });
  });

  /**
   * GET /api/admin/live-chat/conversations/:id
   * Detail satu percakapan untuk live chat monitor.
   */
  fastify.get(
    '/api/admin/live-chat/conversations/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      try {
        const item = await liveChatService.getConversationDetail(id, tenantId);
        if (!item) {
          return reply.status(404).send({ success: false, error: 'Conversation tidak ditemukan' });
        }
        return reply.status(200).send({ success: true, data: item });
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
          replyToMessageId?: string;
        };
      }>,
      reply
    ) => {
      const { id } = request.params;
      const { text, imageB64, thumbB64, mimeType, fileName, adminName, acknowledgeOutsideWindow, replyToMessageId } = request.body || {};

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
        replyToMessageId,
      });

      if (!result.success) {
        const code = result.error?.code || 'REPLY_FAILED';
        const status =
          code === 'WABA_OUTSIDE_WINDOW'
            ? 409
            : code === 'SANDBOX_REPLY_BLOCKED'
            ? 403
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
   * POST /api/admin/conversations/:id/typing & POST /api/admin/live-chat/conversations/:id/typing
   * Indikator status mengetik admin ("sedang mengetik...") & read receipt (sendSeen) ke WhatsApp.
   */
  const typingHandler = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { isTyping?: boolean };
    }>,
    reply: FastifyReply
  ) => {
    const { id } = request.params;
    const { isTyping } = request.body || {};
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;

    try {
      const conversation = await conversationService.getConversationById(id, tenantId);
      if (!conversation) {
        return reply.status(404).send({ success: false, error: 'Percakapan tidak ditemukan.' });
      }

      // Ambil customer jika belum ada di objek conversation
      let customer = conversation.customer;
      if (!customer && conversation.customer_id) {
        customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
      }
      if (!customer || !customer.phone) {
        return reply.status(404).send({ success: false, error: 'Customer dari percakapan tidak ditemukan.' });
      }

      // Jangan kirim sinyal typing/seen untuk sandbox test chat
      if (customer.is_sandbox_test) {
        return reply.status(200).send({ success: true, sandbox: true });
      }

      const phone = customer.phone;
      const { getGateway } = await import('../../integrations/whatsapp');
      const gateway = await getGateway(tenantId);

      if (isTyping) {
        console.log(`[LIVE CHAT TYPING] Admin started typing -> conversation: ${id}, phone: ${phone}`);
        // 1. Kirim sinyal markAsRead (sendSeen / centang biru)
        if (typeof gateway.markAsRead === 'function') {
          await gateway.markAsRead(phone).catch((err: any) => console.warn('[TYPING ERROR] markAsRead failed:', err.message));
        }
        // 2. Mulai status typing ("sedang mengetik...")
        if (gateway.providerType === 'WAHA') {
          const { wahaClient } = await import('../../integrations/waha/client');
          await wahaClient.startTyping(phone).catch((err: any) => console.warn('[TYPING ERROR] startTyping failed:', err.message));
        } else if (typeof gateway.sendTypingIndicator === 'function') {
          await gateway.sendTypingIndicator(phone, undefined, 4000).catch(() => {});
        }
      } else {
        console.log(`[LIVE CHAT TYPING] Admin stopped typing -> conversation: ${id}, phone: ${phone}`);
        // Hentikan status typing
        if (gateway.providerType === 'WAHA') {
          const { wahaClient } = await import('../../integrations/waha/client');
          await wahaClient.stopTyping(phone).catch((err: any) => console.warn('[TYPING ERROR] stopTyping failed:', err.message));
        }
      }

      return reply.status(200).send({ success: true, isTyping: !!isTyping });
    } catch (err: any) {
      console.warn(`[LIVE CHAT TYPING ERROR] Handler error:`, err.message);
      return reply.status(200).send({ success: false, error: err.message });
    }
  };

  fastify.post('/api/admin/conversations/:id/typing', typingHandler);
  fastify.post('/api/admin/live-chat/conversations/:id/typing', typingHandler);

  /**
   * GET /api/admin/gateway-capability
   * Mengambil informasi provider gateway WhatsApp aktif dan kapabilitasnya (seperti kemampuan revoke/hapus pesan).
   */
  fastify.get('/api/admin/gateway-capability', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    const capability = await liveChatService.getGatewayCapability(tenantId);
    return reply.status(200).send({ success: true, data: capability });
  });

  /**
   * DELETE /api/admin/conversations/:id/messages/:messageId
   * Menarik / menghapus pesan WhatsApp untuk semua orang (Delete for Everyone / Revoke).
   */
  fastify.delete(
    '/api/admin/conversations/:id/messages/:messageId',
    async (
      request: FastifyRequest<{
        Params: { id: string; messageId: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id, messageId } = request.params;
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const adminName = (request as any).adminIdentity || 'Admin';

      const result = await liveChatService.revokeMessage({
        conversationId: id,
        messageId,
        tenantId,
        adminName,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({ success: true, message: 'Pesan berhasil ditarik dari WhatsApp.' });
    }
  );

  /**
   * PUT /api/admin/conversations/:id/messages/:messageId/edit
   * Mengedit teks pesan WhatsApp yang sudah terkirim (maksimal 15 menit).
   */
  fastify.put(
    '/api/admin/conversations/:id/messages/:messageId/edit',
    async (
      request: FastifyRequest<{
        Params: { id: string; messageId: string };
        Body: { text: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id, messageId } = request.params;
      const { text } = request.body || {};
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const adminName = (request as any).adminIdentity || 'Admin';

      if (!text || !text.trim()) {
        return reply.status(400).send({ success: false, error: 'Teks pesan baru tidak boleh kosong.' });
      }

      const result = await liveChatService.editMessage({
        conversationId: id,
        messageId,
        newContent: text.trim(),
        tenantId,
        adminName,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({ success: true, message: 'Pesan berhasil diperbarui di WhatsApp.' });
    }
  );

  /**
   * POST /api/admin/live-chat/conversations/:id/messages/:messageId/reaction & POST /api/admin/conversations/:id/messages/:messageId/reaction
   * Memberikan, mengganti, atau menghapus reaksi emotikon pada pesan WhatsApp.
   */
  const reactionHandler = async (
    request: FastifyRequest<{
      Params: { id: string; messageId: string };
      Body: { emoji?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { id, messageId } = request.params;
    const { emoji = '' } = request.body || {};
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    const adminName = (request as any).adminIdentity || 'Admin';

    const result = await liveChatService.sendReaction({
      conversationId: id,
      messageId,
      emoji: typeof emoji === 'string' ? emoji.trim() : '',
      tenantId,
      adminName,
    });

    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    return reply.status(200).send({
      success: true,
      message: emoji ? 'Reaksi emotikon berhasil dikirim.' : 'Reaksi emotikon berhasil dihapus.',
      reactions: result.reactions,
    });
  };

  fastify.post('/api/admin/live-chat/conversations/:id/messages/:messageId/reaction', reactionHandler);
  fastify.post('/api/admin/conversations/:id/messages/:messageId/reaction', reactionHandler);

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

        // Auto cleanup Hold label and flag in database
        try {
          const customer = await prisma.customer.findUnique({ where: { id: updated.customer_id } });
          if (customer) {
            await prisma.customer.update({
              where: { id: customer.id },
              data: { is_hold_labeled: false },
            });
            const holdLabel = await prisma.label.findFirst({
              where: { tenant_id: DEFAULT_TENANT_ID, name: { equals: 'Hold', mode: 'insensitive' } },
            });
            if (holdLabel) {
              await prisma.customerLabel.deleteMany({
                where: { customer_id: customer.id, label_id: holdLabel.id },
              });
            }
          }
        } catch (err: any) {
          console.warn(`[LABEL ERROR] Failed to auto-clear hold label during manual admin release:`, err.message);
        }

        const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true';
        if (enableHoldLabel) {
          try {
            const { wahaClient } = await import('../../integrations/waha/client');
            const customer = await prisma.customer.findUnique({ where: { id: updated.customer_id } });
            if (customer) {
              await wahaClient.removeLabel(`${customer.phone}@c.us`, 'hold');
            }
          } catch (err: any) {
            console.warn(`[LABEL ERROR] Failed to auto-remove WAHA hold label during manual admin release:`, err.message);
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

  /**
   * POST /api/admin/live-chat/customers/:id/refresh-profile-picture
   * Memperbarui foto profil WhatsApp customer dari gateway secara langsung.
   */
  fastify.post(
    '/api/admin/live-chat/customers/:id/refresh-profile-picture',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const customer = await customerService.getCustomerById(id, DEFAULT_TENANT_ID);
        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        const { resolveGatewayForTenant } = await import('../../integrations/whatsapp/factory');
        const gateway = await resolveGatewayForTenant(DEFAULT_TENANT_ID);
        let profilePictureUrl: string | null = null;
        if (gateway && typeof gateway.getProfilePicture === 'function') {
          profilePictureUrl = await gateway.getProfilePicture(customer.phone);
          await customerService.updateProfilePicture(customer.id, customer.phone, profilePictureUrl);
        }

        return reply.status(200).send({
          success: true,
          data: {
            customerId: customer.id,
            profilePictureUrl,
            updatedAt: new Date(),
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message || 'Gagal merefresh foto profil' });
      }
    }
  );

  /**
   * POST /api/admin/live-chat/conversations/:id/suggest-reply
   * AI Copilot: Menggenerasi draf balasan profesional untuk Bidan/CS berdasarkan percakapan.
   */
  fastify.post(
    '/api/admin/live-chat/conversations/:id/suggest-reply',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const draftText = await liveChatService.generateAiSuggestion(id, DEFAULT_TENANT_ID);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'admin',
          adminIdentity: (request as any).adminIdentity || 'Bidan / CS',
          action: 'AI_COPILOT_GENERATE_DRAFT',
          targetId: id,
          payload: { conversationId: id },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({
          success: true,
          data: { draftText },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message || 'Gagal menggenerasi draf balasan AI' });
      }
    }
  );

  /**
   * POST /api/admin/live-chat/mark-all-read
   * Menandai SEMUA percakapan dari seluruh pelanggan sebagai telah dibaca.
   */
  fastify.post('/api/admin/live-chat/mark-all-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    try {
      const count = await messageService.markAllMessagesAsRead(tenantId);

      // Broadcast update via LiveChatHub
      try {
        const hub = getLiveChatHub();
        await hub.publish({
          type: 'conversation.updated',
          tenantId,
          payload: {
            allRead: true,
          },
        });
      } catch {}

      return reply.status(200).send({
        success: true,
        count,
        message: 'Semua percakapan berhasil ditandai telah dibaca.',
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message || 'Gagal menandai semua telah dibaca' });
    }
  });

  /**
   * PATCH /api/admin/conversations/:id/read
   * Menandai semua pesan inbound pada percakapan sebagai telah dibaca.
   */
  fastify.patch(
    '/api/admin/conversations/:id/read',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      try {
        await messageService.markConversationMessagesAsRead(id, tenantId);
        const conv = await conversationService.getConversationById(id, tenantId);

        // Broadcast update via LiveChatHub
        try {
          const hub = getLiveChatHub();
          await hub.publish({
            type: 'conversation.updated',
            tenantId,
            payload: {
              conversationId: id,
              unreadCount: 0,
              isManualUnread: false,
              ...(conv ? buildConversationUpdatedPayload(conv) : {}),
            },
          });
        } catch {}

        return reply.status(200).send({ success: true, message: 'Percakapan ditandai telah dibaca.' });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message || 'Gagal menandai telah dibaca' });
      }
    }
  );

  /**
   * PATCH /api/admin/conversations/:id/unread
   * Menandai percakapan sebagai belum dibaca (Manual Mark as Unread — Hijau Tua).
   */
  fastify.patch(
    '/api/admin/conversations/:id/unread',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      try {
        await messageService.markConversationAsUnread(id, tenantId);
        const conv = await conversationService.getConversationById(id, tenantId);

        // Broadcast update via LiveChatHub
        try {
          const hub = getLiveChatHub();
          await hub.publish({
            type: 'conversation.updated',
            tenantId,
            payload: {
              conversationId: id,
              unreadCount: 1,
              isManualUnread: true,
              ...(conv ? buildConversationUpdatedPayload(conv) : {}),
            },
          });
        } catch {}

        return reply.status(200).send({ success: true, message: 'Percakapan ditandai belum dibaca.' });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message || 'Gagal menandai belum dibaca' });
      }
    }
  );

  /**
   * PATCH /api/admin/conversations/:id/pin
   * Menyematkan / melepas sematan percakapan (Pin/Unpin).
   */
  fastify.patch(
    '/api/admin/conversations/:id/pin',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { isPinned?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { isPinned } = request.body || {};
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      try {
        const updated = await conversationService.togglePinConversation(id, tenantId, isPinned);
        if (!updated) {
          return reply.status(404).send({ success: false, error: 'Percakapan tidak ditemukan.' });
        }

        // Broadcast update via LiveChatHub
        try {
          const hub = getLiveChatHub();
          await hub.publish({
            type: 'conversation.updated',
            tenantId,
            payload: buildConversationUpdatedPayload(updated),
          });
        } catch {}

        return reply.status(200).send({
          success: true,
          isPinned: updated.is_pinned,
          message: updated.is_pinned ? 'Percakapan berhasil disematkan.' : 'Sematan percakapan dilepas.',
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message || 'Gagal mengubah status sematan' });
      }
    }
  );
}


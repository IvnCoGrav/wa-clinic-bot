import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { knowledgeBaseService } from '../../services/knowledge.service';
import { auditService } from '../../services/audit.service';

export async function knowledgeAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/knowledge/chunks
   * Get all knowledge base chunks for the tenant
   */
  fastify.get(
    '/api/admin/knowledge/chunks',
    async (
      request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const page = Math.max(1, parseInt(request.query?.page || '1', 10) || 1);
        const pageSize = Math.min(500, Math.max(1, parseInt(request.query?.pageSize || '200', 10) || 200));
        const where = { tenant_id: DEFAULT_TENANT_ID };
        const [rows, total] = await Promise.all([
          prisma.knowledgeChunk.findMany({
            where,
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.knowledgeChunk.count({ where }),
        ]);
        return reply.status(200).send({
          success: true,
          data: rows,
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        });
      } catch (err: any) {
        return reply.status(200).send({ success: true, data: [], total: 0, page: 1, pageSize: 200, totalPages: 1 });
      }
    }
  );

  /**
   * GET /api/admin/knowledge/unanswered
   * Fetch all active human-handling conversations with unresolved_faq reason
   */
  fastify.get('/api/admin/knowledge/unanswered', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const unanswered = await prisma.conversation.findMany({
        where: {
          tenant_id: DEFAULT_TENANT_ID,
          is_human_handling: true,
          escalation_reason: 'unresolved_faq',
        },
        include: {
          customer: true,
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
        orderBy: { last_message_at: 'desc' },
      });

      const data = unanswered.map((c) => ({
        id: c.id,
        phone: c.customer.phone,
        name: c.customer.name || 'Bunda',
        question: c.messages[0]?.content || 'Pertanyaan tidak ditemukan',
        createdAt: c.messages[0]?.created_at || c.updated_at,
      }));

      return reply.status(200).send({ success: true, data });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [] });
    }
  });

  /**
   * POST /api/admin/knowledge/unanswered/:id/resolve
   * Resolve an unanswered question by answering it, saving to live FAQ, and replying to the customer.
   */
  fastify.post(
    '/api/admin/knowledge/unanswered/:id/resolve',
    {
      config: {
        rateLimit: {
          max: 100,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { answer: string; category?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { answer, category = 'general' } = request.body || {};

      if (!answer) {
        return reply.status(400).send({ success: false, error: 'Answer is required' });
      }

      try {
        const conversation = await prisma.conversation.findUnique({
          where: { id },
          include: { customer: true, messages: { orderBy: { created_at: 'desc' }, take: 1 } },
        });

        if (!conversation) {
          return reply.status(404).send({ success: false, error: 'Conversation not found' });
        }

        const rawQuestion = conversation.messages[0]?.content || 'Pertanyaan';

        await knowledgeBaseService.addFaqItem({
          tenantId: DEFAULT_TENANT_ID,
          category,
          question: rawQuestion,
          answer,
          status: 'APPROVED',
        });

        await prisma.conversation.update({
          where: { id },
          data: {
            is_human_handling: false,
            human_handling_since: null,
            escalation_reason: null,
          },
        });

        const { resolveGatewayForTenant } = await import('../../integrations/whatsapp/factory');
        const gateway = await resolveGatewayForTenant(DEFAULT_TENANT_ID);
        await gateway.sendTextMessage(conversation.customer.phone, answer);

        const { messageService } = await import('../../services/message.service');
        await messageService.logMessage({
          conversationId: id,
          direction: 'OUTBOUND',
          content: answer,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({ success: true, message: 'Pertanyaan berhasil dijawab dan disimpan ke FAQ.' });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PUT /api/admin/knowledge/chunks/:id
   * REST Endpoint to edit a single knowledge base chunk
   */
  fastify.put(
    '/api/admin/knowledge/chunks/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { title: string; content: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { title, content } = request.body || {};

      if (!title || !content) {
        return reply.status(400).send({ error: 'Title and content are required' });
      }

      try {
        const updated = await prisma.knowledgeChunk.update({
          where: { id },
          data: {
            title,
            content,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'EDIT_KNOWLEDGE_CHUNK',
          targetId: id,
          payload: { title },
          ipAddress: request.ip,
        });

        try {
          const { faqCacheService } = await import('../../services/faq-cache.service');
          await faqCacheService.invalidateAll(updated?.tenant_id || DEFAULT_TENANT_ID).catch(() => {});
        } catch (_) {}

        return reply.status(200).send({
          success: true,
          message: 'Knowledge chunk updated successfully',
          data: updated,
        });
      } catch (err: any) {
        const updatedInMemory = knowledgeBaseService.updateInMemoryChunk(id, title, content);

        if (updatedInMemory) {
          try {
            const { faqCacheService } = await import('../../services/faq-cache.service');
            await faqCacheService.invalidateAll(DEFAULT_TENANT_ID).catch(() => {});
          } catch (_) {}

          return reply.status(200).send({
            success: true,
            message: 'Knowledge chunk updated in memory fallback',
            data: { id, title, content },
          });
        }

        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * DELETE /api/admin/knowledge/chunks/:id
   * REST Endpoint to delete a single knowledge base chunk
   */
  fastify.delete(
    '/api/admin/knowledge/chunks/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        await prisma.knowledgeChunk.delete({ where: { id } });
        try {
          const { faqCacheService } = await import('../../services/faq-cache.service');
          await faqCacheService.invalidateAll(DEFAULT_TENANT_ID).catch(() => {});
        } catch (_) {}

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'DELETE_KNOWLEDGE_CHUNK',
          targetId: id,
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, message: 'Knowledge chunk deleted successfully' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/knowledge/faq
   * REST Endpoint untuk bulk import FAQ (JSON Array of { question, answer }).
   */
  fastify.post(
    '/api/admin/knowledge/faq',
    async (
      request: FastifyRequest<{ Body: { faqs: Array<{ question: string; answer: string }> } }>,
      reply: FastifyReply
    ) => {
      const { faqs } = request.body || {};
      if (!faqs || !Array.isArray(faqs) || faqs.length === 0) {
        return reply.status(400).send({ error: 'Body must contain non-empty faqs array [{question, answer}]' });
      }

      const importedCount = await knowledgeBaseService.importFaqs(faqs, DEFAULT_TENANT_ID);
      try {
        const { faqCacheService } = await import('../../services/faq-cache.service');
        await faqCacheService.invalidateAll(DEFAULT_TENANT_ID).catch(() => {});
      } catch (_) {}

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'IMPORT_FAQS',
        payload: { count: faqs.length },
        ipAddress: request.ip,
      });
      return reply.status(200).send({
        success: true,
        message: `Successfully imported ${importedCount} FAQ pairs into Knowledge Base`,
      });
    }
  );

  /**
   * POST /api/admin/knowledge/document
   * REST Endpoint untuk upload/import file dokumen (auto-extract & chunk per ~500-800 char).
   */
  fastify.post(
    '/api/admin/knowledge/document',
    async (
      request: FastifyRequest<{ Body: { documentName: string; textContent: string } }>,
      reply: FastifyReply
    ) => {
      const { documentName, textContent } = request.body || {};
      if (!documentName || !textContent) {
        return reply.status(400).send({ error: 'documentName and textContent are required' });
      }

      const chunkCount = await knowledgeBaseService.importDocument(documentName, textContent, DEFAULT_TENANT_ID);
      try {
        const { faqCacheService } = await import('../../services/faq-cache.service');
        await faqCacheService.invalidateAll(DEFAULT_TENANT_ID).catch(() => {});
      } catch (_) {}

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'IMPORT_DOCUMENT',
        targetId: documentName,
        payload: { length: textContent.length },
        ipAddress: request.ip,
      });
      return reply.status(200).send({
        success: true,
        message: `Successfully imported document "${documentName}" into ${chunkCount} knowledge chunks`,
      });
    }
  );
}

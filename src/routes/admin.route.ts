import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { knowledgeBaseService } from '../services/knowledge.service';

export async function adminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/human-handling-conversations
   * REST Endpoint untuk melihat daftar percakapan yang aktif diserahkan ke Human Agent.
   */
  fastify.get('/api/admin/human-handling-conversations', async (request, reply) => {
    try {
      const activeHumanHandling = await prisma.conversation.findMany({
        where: { is_human_handling: true },
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
   * POST /api/admin/knowledge/faq
   * REST Endpoint untuk bulk import FAQ (JSON Array of { question, answer }).
   */
  fastify.post('/api/admin/knowledge/faq', async (request: FastifyRequest<{ Body: { faqs: Array<{ question: string; answer: string }> } }>, reply: FastifyReply) => {
    const { faqs } = request.body || {};
    if (!faqs || !Array.isArray(faqs) || faqs.length === 0) {
      return reply.status(400).send({ error: 'Body must contain non-empty faqs array [{question, answer}]' });
    }

    const importedCount = await knowledgeBaseService.importFaqs(faqs);
    return reply.status(200).send({
      success: true,
      message: `Successfully imported ${importedCount} FAQ pairs into Knowledge Base`,
    });
  });

  /**
   * POST /api/admin/knowledge/document
   * REST Endpoint untuk upload/import file dokumen (auto-extract & chunk per ~500-800 char).
   */
  fastify.post('/api/admin/knowledge/document', async (request: FastifyRequest<{ Body: { documentName: string; textContent: string } }>, reply: FastifyReply) => {
    const { documentName, textContent } = request.body || {};
    if (!documentName || !textContent) {
      return reply.status(400).send({ error: 'documentName and textContent are required' });
    }

    const chunkCount = await knowledgeBaseService.importDocument(documentName, textContent);
    return reply.status(200).send({
      success: true,
      message: `Successfully imported document "${documentName}" into ${chunkCount} knowledge chunks`,
    });
  });
}

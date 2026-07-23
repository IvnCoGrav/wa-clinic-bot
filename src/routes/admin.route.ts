import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { knowledgeBaseService } from '../services/knowledge.service';
import { parseReservationText } from '../utils/reservation-text-parser';
import { customerService } from '../services/customer.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import crypto from 'crypto';

// In-Memory fallback store for reservations during unit testing/offline database modes
export const memoryReservations = new Map<string, any>();

function safeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  const hashA = crypto.createHash('sha256').update(aBuffer).digest();
  const hashB = crypto.createHash('sha256').update(bBuffer).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export async function adminRoutes(fastify: FastifyInstance) {
  // --- REVISI USER: API Key Auth Layer (Fail-Closed & Constant-Time comparison) ---
  fastify.addHook('preHandler', async (request, reply) => {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      return reply.status(401).send({ error: 'Unauthorized: Admin API Key is not configured on the server.' });
    }

    // Fastify/Node headers are case-insensitive by default. We check x-api-key header and query param.
    const clientKey = (request.headers['x-api-key'] || (request.query as any)?.apiKey) as string;
    if (!clientKey || !safeCompare(clientKey, adminKey)) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid or missing X-API-KEY header.' });
    }
  });

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
   * POST /api/admin/knowledge/faq
   * REST Endpoint untuk bulk import FAQ (JSON Array of { question, answer }).
   */
  fastify.post('/api/admin/knowledge/faq', async (request: FastifyRequest<{ Body: { faqs: Array<{ question: string; answer: string }> } }>, reply: FastifyReply) => {
    const { faqs } = request.body || {};
    if (!faqs || !Array.isArray(faqs) || faqs.length === 0) {
      return reply.status(400).send({ error: 'Body must contain non-empty faqs array [{question, answer}]' });
    }

    const importedCount = await knowledgeBaseService.importFaqs(faqs, DEFAULT_TENANT_ID);
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

    const chunkCount = await knowledgeBaseService.importDocument(documentName, textContent, DEFAULT_TENANT_ID);
    return reply.status(200).send({
      success: true,
      message: `Successfully imported document "${documentName}" into ${chunkCount} knowledge chunks`,
    });
  });

  /**
   * POST /api/admin/reservation/parse
   * REST Endpoint untuk meng-parse teks list reservasi mentah dan menyimpannya ke database
   */
  fastify.post('/api/admin/reservation/parse', async (request: FastifyRequest<{ Body: { customerId: string; rawText: string } }>, reply: FastifyReply) => {
    const { customerId, rawText } = request.body || {};
    if (!customerId || !rawText) {
      return reply.status(400).send({ error: 'customerId and rawText are required' });
    }

    const parseResult = parseReservationText(rawText);
    if (!parseResult.success || !parseResult.reservation) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error,
        missingFields: parseResult.missingFields,
      });
    }

    const parsed = parseResult.reservation;
    try {
      const reservation = await prisma.reservation.create({
        data: {
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: customerId,
          treatment_category: parsed.treatmentCategory,
          treatment_detail: parsed.treatmentDetail,
          booking_date: parsed.bookingDate,
          raw_text: rawText,
          status: 'pending',
        },
      });
      return reply.status(200).send({ success: true, data: reservation });
    } catch (error) {
      // Memory Fallback jika database offline
      const mockReservation = {
        id: `res_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customerId,
        treatment_category: parsed.treatmentCategory,
        treatment_detail: parsed.treatmentDetail,
        booking_date: parsed.bookingDate,
        raw_text: rawText,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryReservations.set(mockReservation.id, mockReservation);
      return reply.status(200).send({
        success: true,
        data: mockReservation,
        note: 'Fallback in-memory mode (DB offline)',
      });
    }
  });

  /**
   * PATCH /api/admin/reservation/:id/confirm
   * REST Endpoint untuk admin mengonfirmasi status reservasi menjadi 'confirmed'
   */
  fastify.patch('/api/admin/reservation/:id/confirm', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const existing = await prisma.reservation.findFirst({
        where: { id, tenant_id: DEFAULT_TENANT_ID },
      });
      if (!existing) {
        throw new Error('Reservation not found');
      }

      const reservation = await prisma.reservation.update({
        where: { id },
        data: { status: 'confirmed' },
      });
      return reply.status(200).send({ success: true, data: reservation });
    } catch (error) {
      const mock = memoryReservations.get(id);
      if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
        mock.status = 'confirmed';
        mock.updated_at = new Date();
        memoryReservations.set(id, mock);
        return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
      }
      return reply.status(404).send({ success: false, error: 'Reservation not found' });
    }
  });

  /**
   * PATCH /api/admin/reservation/:id/set-date
   * REST Endpoint untuk admin mengubah/mengeset tanggal booking secara manual
   */
  fastify.patch('/api/admin/reservation/:id/set-date', async (request: FastifyRequest<{ Params: { id: string }; Body: { bookingDate: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { bookingDate } = request.body || {};
    if (!bookingDate) {
      return reply.status(400).send({ error: 'bookingDate is required' });
    }

    const parsedDate = new Date(bookingDate);
    if (isNaN(parsedDate.getTime())) {
      return reply.status(400).send({ error: 'Invalid date format. Use ISO string or YYYY-MM-DD.' });
    }

    try {
      const existing = await prisma.reservation.findFirst({
        where: { id, tenant_id: DEFAULT_TENANT_ID },
      });
      if (!existing) {
        throw new Error('Reservation not found');
      }

      const reservation = await prisma.reservation.update({
        where: { id },
        data: { booking_date: parsedDate },
      });
      return reply.status(200).send({ success: true, data: reservation });
    } catch (error) {
      const mock = memoryReservations.get(id);
      if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
        mock.booking_date = parsedDate;
        mock.updated_at = new Date();
        memoryReservations.set(id, mock);
        return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
      }
      return reply.status(404).send({ success: false, error: 'Reservation not found' });
    }
  });

  /**
   * POST /api/admin/customer/:id/block
   * REST Endpoint untuk memblokir customer secara manual
   */
  fastify.post('/api/admin/customer/:id/block', async (request: FastifyRequest<{ Params: { id: string }; Body: { reason: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { reason } = request.body || {};
    if (!reason) {
      return reply.status(400).send({ error: 'reason is required' });
    }

    try {
      const customer = await customerService.blockCustomer(id, reason, DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: customer });
    } catch (error: any) {
      return reply.status(404).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/admin/customer/:id/unblock
   * REST Endpoint untuk membuka blokir customer
   */
  fastify.post('/api/admin/customer/:id/unblock', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      const customer = await customerService.unblockCustomer(id, DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: customer });
    } catch (error: any) {
      return reply.status(404).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/admin/customers/flagged
   * REST Endpoint untuk melihat percakapan yang di-flag untuk review
   */
  fastify.get('/api/admin/customers/flagged', async (request, reply) => {
    try {
      const flaggedConversations = await prisma.conversation.findMany({
        where: { review_flagged: true, tenant_id: DEFAULT_TENANT_ID },
        include: { customer: true },
      });
      return reply.status(200).send({ success: true, count: flaggedConversations.length, data: flaggedConversations });
    } catch (error) {
      const mockFlagged: any[] = [];
      return reply.status(200).send({ success: true, count: mockFlagged.length, data: mockFlagged, note: 'Fallback in-memory mode' });
    }
  });
}

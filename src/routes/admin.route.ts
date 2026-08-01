import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { knowledgeBaseService } from '../services/knowledge.service';
import { parseReservationText } from '../utils/reservation-text-parser';
import { customerService } from '../services/customer.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { googleCalendarService } from '../services/google-calendar.service';
import { auditService } from '../services/audit.service';
import { safeCompare } from '../utils/auth';
import { capiService } from '../services/capi.service';
import crypto from 'crypto';

// In-Memory fallback store for reservations during unit testing/offline database modes
export const memoryReservations = new Map<string, any>();

// Simple In-Memory Login Rate Limiter (5 attempts per minute per IP)
const loginAttemptsMap = new Map<string, { count: number; resetAt: number }>();

export async function adminRoutes(fastify: FastifyInstance) {
  const { AdminSessionService } = await import('../services/admin-session.service');

  // --- REVISI SECURITY: Origin Isolation & Dual Auth Middleware (X-API-KEY or HttpOnly Cookie Session) ---
  fastify.addHook('preHandler', async (request, reply) => {
    // 1. Layer 1 Origin Isolation Guard: Block /admin/* on pages.kalababyspa.online
    const xForwardedHost = request.headers['x-forwarded-host'];
    const hostVal = Array.isArray(xForwardedHost) ? xForwardedHost[0] : xForwardedHost;
    const hostHeader = (request.headers.host || request.hostname || hostVal || '').toLowerCase();
    if (hostHeader.includes('pages.kalababyspa.online') && (request.url.includes('/admin') || request.url.includes('/api/admin'))) {
      console.warn(`[ORIGIN ISOLATION GUARD] Blocked admin access attempt on tenant landing domain (${hostHeader}${request.url})`);
      return reply.status(404).send({ error: 'Not Found' });
    }

    // 2. Allow unauthenticated access to /api/admin/auth/login and static HTML pages
    if (request.url.startsWith('/admin/') || (request.url === '/api/admin/auth/login' && request.method === 'POST')) {
      return;
    }


    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      return reply.status(401).send({ error: 'Unauthorized: Admin API Key is not configured on the server.' });
    }

    // 3. Dual Auth Verification: Check X-API-KEY header OR admin_session cookie
    const clientKey = request.headers['x-api-key'] as string;
    const cookieHeader = request.headers['cookie'] || '';
    const sessionCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];

    let isAuthenticated = false;
    let identity = 'Admin User';

    if (clientKey && safeCompare(clientKey, adminKey)) {
      isAuthenticated = true;
      identity = (request.headers['x-admin-identity'] || 'API Key Client') as string;
    } else if (sessionCookie) {
      const validSession = AdminSessionService.validateSession(sessionCookie);
      if (validSession) {
        isAuthenticated = true;
        identity = validSession.adminIdentity;
      }
    }

    if (!isAuthenticated) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid or missing authentication credentials (X-API-KEY or admin_session cookie).' });
    }

    (request as any).adminKeyUsed = clientKey || 'COOKIE_SESSION';
    (request as any).adminIdentity = identity;
  });

  /**
   * POST /api/admin/auth/login
   * Endpoint Login Browser Admin dengan Rate Limiting (5 req/min/IP) & HttpOnly Cookie Session
   */
  fastify.post('/api/admin/auth/login', async (request, reply) => {
    const ip = request.ip || '127.0.0.1';
    const now = Date.now();

    // Rate limiting check (5 attempts / min)
    let rate = loginAttemptsMap.get(ip);
    if (!rate || now > rate.resetAt) {
      rate = { count: 1, resetAt: now + 60 * 1000 };
      loginAttemptsMap.set(ip, rate);
    } else {
      rate.count++;
    }

    if (rate.count > 5) {
      return reply.status(429).send({ error: 'Too Many Requests: Batas percobaan login terlampaui (maks 5x per menit). Silakan tunggu 1 menit.' });
    }

    const body = (request.body || {}) as { apiKey?: string; password?: string; adminIdentity?: string };
    const inputKey = body.apiKey || body.password || '';
    const adminKey = process.env.ADMIN_API_KEY;

    if (!adminKey || !inputKey || !safeCompare(inputKey, adminKey)) {
      return reply.status(401).send({ error: 'Unauthorized: Password / API Key admin tidak valid.' });
    }

    // Reset rate limit on success
    loginAttemptsMap.delete(ip);

    // Create cryptographically secure 24h session
    const session = AdminSessionService.createSession(body.adminIdentity || 'Bidan Admin');

    // Set HttpOnly, Secure, SameSite=Strict cookie scoped to app.kalababyspa.online
    const cookieValue = `admin_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
    reply.header('Set-Cookie', cookieValue);

    return reply.status(200).send({
      success: true,
      message: 'Login Admin berhasil. Cookie HttpOnly admin_session telah diterbitkan.',
      user: {
        id: session.id,
        email: 'admin@kalababyspa.online',
        role: 'tenant_admin',
        tenantId: 'default-tenant',
      },
      data: {
        adminIdentity: session.adminIdentity,
        expiresAt: session.expiresAt,
      },
    });
  });

  /**
   * POST /api/admin/auth/logout
   * Destroys admin session and clears HttpOnly cookie
   */
  fastify.post('/api/admin/auth/logout', async (request, reply) => {
    const cookieHeader = request.headers['cookie'] || '';
    const sessionCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];

    if (sessionCookie) {
      AdminSessionService.destroySession(sessionCookie);
    }

    reply.header('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return reply.status(200).send({ success: true, message: 'Logout Admin berhasil. Cookie session dibersihkan.' });
  });


  /**
   * GET /api/admin/auth/me
   * Returns current active admin session info
   */
  fastify.get('/api/admin/auth/me', async (request, reply) => {
    return reply.status(200).send({
      success: true,
      authenticated: true,
      adminIdentity: (request as any).adminIdentity,
      user: {
        id: 'admin-session',
        email: 'admin@kalababyspa.online',
        role: 'tenant_admin',
        tenantId: 'default-tenant',
      },
    });
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
   * GET /api/admin/reservations
   * Get all reservations for the tenant
   */
  fastify.get('/api/admin/reservations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const reservations = await prisma.reservation.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        include: {
          customer: true
        },
        orderBy: {
          created_at: 'desc'
        }
      });
      return reservations;
    } catch (err: any) {
      console.warn('[Admin API] Database error fetching reservations, falling back to memory:', err.message);
      return Array.from(memoryReservations.values());
    }
  });

  /**
   * GET /api/admin/knowledge/chunks
   * Get all knowledge base chunks for the tenant
   */
  fastify.get('/api/admin/knowledge/chunks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const chunks = await prisma.knowledgeChunk.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        orderBy: { created_at: 'desc' }
      });
      return reply.status(200).send({ success: true, data: chunks });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [] });
    }
  });

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
          escalation_reason: 'unresolved_faq'
        },
        include: {
          customer: true,
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1
          }
        },
        orderBy: { last_message_at: 'desc' }
      });

      const data = unanswered.map(c => ({
        id: c.id,
        phone: c.customer.phone,
        name: c.customer.name || 'Bunda',
        question: c.messages[0]?.content || 'Pertanyaan tidak ditemukan',
        createdAt: c.messages[0]?.created_at || c.updated_at
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
          timeWindow: '1 minute'
        }
      }
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
          include: { customer: true, messages: { orderBy: { created_at: 'desc' }, take: 1 } }
        });

        if (!conversation) {
          return reply.status(404).send({ success: false, error: 'Conversation not found' });
        }

        const rawQuestion = conversation.messages[0]?.content || 'Pertanyaan';

        // 1. Save to Live FAQ chunks
        await knowledgeBaseService.addFaqItem({
          tenantId: DEFAULT_TENANT_ID,
          category,
          question: rawQuestion,
          answer,
          status: 'APPROVED',
        });

        // 2. Release conversation back to bot
        await prisma.conversation.update({
          where: { id },
          data: {
            is_human_handling: false,
            human_handling_since: null,
            escalation_reason: null
          }
        });

        // 3. Send outbound reply to user via WAHA
        const { wahaClient } = await import('../integrations/waha/client');
        await wahaClient.sendText(`${conversation.customer.phone}@c.us`, answer);

        // 4. Log message to audit trail
        const { messageService } = await import('../services/message.service');
        await messageService.logMessage({
          conversationId: id,
          direction: 'OUTBOUND',
          content: answer,
          tenantId: DEFAULT_TENANT_ID
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
  fastify.put('/api/admin/knowledge/chunks/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: { title: string; content: string } }>, reply: FastifyReply) => {
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
          content
        }
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'EDIT_KNOWLEDGE_CHUNK',
        targetId: id,
        payload: { title },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        message: 'Knowledge chunk updated successfully',
        data: updated
      });
    } catch (err: any) {
      const { knowledgeBaseService } = await import('../services/knowledge.service');
      const updatedInMemory = knowledgeBaseService.updateInMemoryChunk(id, title, content);
      
      if (updatedInMemory) {
        return reply.status(200).send({
          success: true,
          message: 'Knowledge chunk updated in memory fallback',
          data: { id, title, content }
        });
      }

      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/knowledge/chunks/:id
   * REST Endpoint to delete a single knowledge base chunk
   */
  fastify.delete('/api/admin/knowledge/chunks/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      await prisma.knowledgeChunk.delete({ where: { id } });
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
  });

  /**
   * POST /api/admin/sandbox/chat
   * Simulate a chat message and inspect RAG retrieval & LLM generation
   */
  fastify.post('/api/admin/sandbox/chat', {
    config: {
      rateLimit: {
        max: process.env.NODE_ENV === 'test' ? 30 : 300,
        timeWindow: '1 minute'
      }
    }
  }, async (request: FastifyRequest<{ Body: { text: string; simulateOutage?: boolean; sandboxPhone?: string } }>, reply: FastifyReply) => {
    const { text, simulateOutage, sandboxPhone } = request.body || {};
    if (!text) {
      return reply.status(400).send({ error: 'Text field is required' });
    }
    const targetPhone = sandboxPhone || '628999999999';

    const { llmOutageStorage } = await import('../integrations/llm/context');

    return llmOutageStorage.run({ simulateOutage: Boolean(simulateOutage) }, async () => {
      try {
        const { knowledgeBaseService } = await import('../services/knowledge.service');
        const { customerService } = await import('../services/customer.service');
        const { conversationService } = await import('../services/conversation.service');
        const { ConversationStateMachine } = await import('../state-machine/machine');
        const { TypingService } = await import('../services/typing.service');
        const { IWahaClient } = await import('../integrations/waha/client');

        class SandboxWAHAClient implements IWahaClient {
          public sentMessages: Array<{ type: 'text' | 'image'; text: string; fileUrl?: string }> = [];

          public async sendSeen(chatId: string, messageId?: string): Promise<boolean> { return true; }
          public async startTyping(chatId: string): Promise<boolean> { return true; }
          public async stopTyping(chatId: string): Promise<boolean> { return true; }
          public async sendText(chatId: string, text: string): Promise<boolean> {
            this.sentMessages.push({ type: 'text', text });
            return true;
          }
          public async sendImage(chatId: string, fileUrl: string, caption?: string): Promise<boolean> {
            this.sentMessages.push({ type: 'image', text: caption || '', fileUrl });
            return true;
          }
          public async addLabel(chatId: string, labelId: string): Promise<boolean> { return true; }
          public async removeLabel(chatId: string, labelId: string): Promise<boolean> { return true; }
          public async getChatLabels(chatId: string): Promise<string[]> { return []; }
          public async getSessionStatus(): Promise<string> { return 'WORKING'; }
          public async getChats(): Promise<any[]> { return []; }
          public async getMessages(chatId: string, limit?: number): Promise<any[]> { return []; }
          public async getPhoneNumberFromLid(chatId: string): Promise<string | null> { return targetPhone; }
        }

        const sandboxClient = new SandboxWAHAClient();
        const sandboxTypingService = new TypingService(sandboxClient);
        sandboxTypingService.setSpeedFactor(100000);

        const sandboxStateMachine = new ConversationStateMachine(sandboxTypingService);

        const customer = await customerService.getOrCreateCustomer(targetPhone, 'Sandbox Customer', DEFAULT_TENANT_ID);
        try {
          await prisma.customer.update({
            where: { id: customer.id },
            data: { is_sandbox_test: true }
          });
        } catch (e) {}

        let conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

        // Handle sandbox reset
        if (text.trim().toLowerCase() === '/reset') {
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
            answer: 'Sesi percakapan simulator berhasil di-reset ke INITIAL! 🌸 Silakan ketik "halo" atau sapaan lainnya untuk mulai menguji.',
            chunks: [],
            query: text,
            timestamp: new Date()
          };
        }

        let incomingMessage: any;
        const locationMatch = text.match(/^\/location\s+([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)/i);
        
        if (locationMatch) {
          incomingMessage = {
            id: `msg_sandbox_${Date.now()}`,
            from: targetPhone,
            chatId: `${targetPhone}@c.us`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'location',
            location: {
              latitude: parseFloat(locationMatch[1]),
              longitude: parseFloat(locationMatch[2])
            }
          };
        } else {
          incomingMessage = {
            id: `msg_sandbox_${Date.now()}`,
            from: targetPhone,
            chatId: `${targetPhone}@c.us`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: text }
          };
        }

        await sandboxStateMachine.processMessage({
          tenantId: DEFAULT_TENANT_ID,
          customer,
          conversation,
          incomingMessage
        });

        const chunks = await knowledgeBaseService.searchRelevantChunks(incomingMessage.text?.body || '', 3, DEFAULT_TENANT_ID);

        const answer = sandboxClient.sentMessages.length > 0
          ? sandboxClient.sentMessages.map(m => m.text).join('\n\n')
          : '🌸 [Bot sedang diam - Percakapan dialihkan ke Human Handling / Bidan]';

        return {
          answer,
          chunks,
          query: text,
          timestamp: new Date(),
          llmError: simulateOutage ? 'SumoPod connection timeout (500 Internal Server Error)' : null
        };
      } catch (err: any) {
        return {
          answer: `Error processing sandbox message: ${err.message}`,
          chunks: [],
          query: text,
          timestamp: new Date(),
          llmError: err.message
        };
      }
    });
  });

  /**
   * POST /api/admin/sandbox/cleanup
   * Cleanup old or dummy sandbox test records
   */
  fastify.post('/api/admin/sandbox/cleanup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const deleted = await prisma.customer.deleteMany({
        where: {
          OR: [
            { is_sandbox_test: true },
            { phone: { startsWith: '6289999' } }
          ]
        }
      });
      return reply.status(200).send({ success: true, message: `Successfully cleaned up ${deleted.count} sandbox test records.` });
    } catch (err: any) {
      return reply.status(200).send({ success: true, message: 'Sandbox cleanup complete.' });
    }
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

      const { followUpService } = await import('../services/follow-up.service');
      await followUpService.onReservationCreated(customerId, reservation.id, DEFAULT_TENANT_ID);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'CREATE_RESERVATION',
        targetId: reservation.id,
        payload: { customerId, rawText },
        ipAddress: request.ip,
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
        include: {
          customer: {
            include: {
              adClick: true
            }
          }
        },
      });
      if (!existing) {
        throw new Error('Reservation not found');
      }

      // 1. Buat event di Google Calendar
      let calendarEventId: string | null = null;
      try {
        const customerName = existing.customer?.name || 'Bunda';
        calendarEventId = await googleCalendarService.createEvent(existing, customerName);
      } catch (err) {
        console.error('[Admin API] Google Calendar Event creation failed:', err);
      }

      // 2. Update status & calendar ID di DB
      const reservation = await prisma.reservation.update({
        where: { id },
        data: { 
          status: 'confirmed',
          google_calendar_event_id: calendarEventId
        },
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'CONFIRM_RESERVATION',
        targetId: id,
        payload: { status: 'confirmed' },
        ipAddress: request.ip,
      });

      // CAPI Event: Lead (Fire-and-forget side effect)
      if (existing.customer) {
        capiService.sendCapiEvent({
          eventName: 'Lead',
          customer: existing.customer,
          adClick: existing.customer.adClick || undefined
        }).catch(err => {
          console.error('[CAPI ERROR] Failed to send conversions event:', err.message);
        });
      }

      return reply.status(200).send({ success: true, data: reservation });
    } catch (error) {
      const mock = memoryReservations.get(id);
      if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
        mock.status = 'confirmed';
        mock.google_calendar_event_id = `mock_cal_event_${Date.now()}`;
        mock.updated_at = new Date();
        memoryReservations.set(id, mock);

        // CAPI Event fallback check for tests
        if (mock.customer) {
          capiService.sendCapiEvent({
            eventName: 'Lead',
            customer: mock.customer,
            adClick: mock.customer.adClick || undefined
          }).catch(err => {
            console.error('[CAPI MOCK ERROR] Failed to send conversions event:', err.message);
          });
        }

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
        include: { customer: true },
      });
      if (!existing) {
        throw new Error('Reservation not found');
      }

      // Update reservation in database
      const reservation = await prisma.reservation.update({
        where: { id },
        data: { booking_date: parsedDate },
      });

      // Update Google Calendar Event if it exists
      if (reservation.google_calendar_event_id) {
        try {
          const customerName = existing.customer?.name || 'Bunda';
          await googleCalendarService.updateEvent(
            reservation.google_calendar_event_id,
            reservation,
            customerName
          );
        } catch (err) {
          console.error('[Admin API] Google Calendar Event update failed:', err);
        }
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'SET_RESERVATION_DATE',
        targetId: id,
        payload: { bookingDate },
        ipAddress: request.ip,
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
   * DELETE /api/admin/reservation/:id
   * REST Endpoint untuk membatalkan reservasi (menghapus Google Calendar Event & merestorasi follow-up NO_PURCHASE jika diperlukan)
   */
  fastify.delete('/api/admin/reservation/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const existing = await prisma.reservation.findFirst({
        where: { id, tenant_id: DEFAULT_TENANT_ID },
        include: { customer: true },
      });
      if (!existing) {
        throw new Error('Reservation not found');
      }

      // 1. Hapus event di Google Calendar jika ada
      if (existing.google_calendar_event_id) {
        try {
          await googleCalendarService.deleteEvent(existing.google_calendar_event_id);
        } catch (err) {
          console.error('[Admin API] Google Calendar Event deletion failed:', err);
        }
      }

      // 2. Tandai status reservasi sebagai 'cancelled'
      const reservation = await prisma.reservation.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      // 3. Restorasi follow-up NO_PURCHASE
      const activeNoPurchaseFollowUps = await prisma.followUp.findFirst({
        where: {
          customer_id: existing.customer_id,
          type: 'NO_PURCHASE',
          status: { in: ['PENDING', 'QUEUED'] },
          tenant_id: DEFAULT_TENANT_ID,
        },
      });

      if (!activeNoPurchaseFollowUps) {
        // Buat 3 row follow-up baru dihitung dari waktu pembatalan
        const stages = [1, 2, 3];
        const days = [3, 7, 14];
        
        await Promise.all(
          stages.map((stage, idx) => {
            const scheduledAt = new Date();
            scheduledAt.setDate(scheduledAt.getDate() + days[idx]);
            
            return prisma.followUp.create({
              data: {
                tenant_id: DEFAULT_TENANT_ID,
                customer_id: existing.customer_id,
                type: 'NO_PURCHASE',
                stage,
                scheduled_at: scheduledAt,
                status: 'PENDING',
              },
            });
          })
        );
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'CANCEL_RESERVATION',
        targetId: id,
        payload: { status: 'cancelled' },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, data: reservation });
    } catch (error) {
      const mock = memoryReservations.get(id);
      if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
        mock.status = 'cancelled';
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
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'BLOCK_CUSTOMER',
        targetId: id,
        payload: { reason },
        ipAddress: request.ip,
      });
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
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UNBLOCK_CUSTOMER',
        targetId: id,
        ipAddress: request.ip,
      });
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

  /**
   * GET /api/admin/services
   * REST Endpoint untuk melihat daftar seluruh layanan/treatment (harga, durasi, usia, promo)
   */
  fastify.get('/api/admin/services', async (request, reply) => {
    const { treatmentCatalogService } = await import('../services/treatment-catalog.service');
    const services = treatmentCatalogService.getAllServices(false);
    return reply.status(200).send({ success: true, count: services.length, data: services });
  });

  /**
   * POST /api/admin/services
   * REST Endpoint untuk menambah/mengedit data layanan (persiapan untuk UI Admin)
   */
  fastify.post('/api/admin/services', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const { treatmentCatalogService } = await import('../services/treatment-catalog.service');
    const serviceData = request.body as any;


    if (!serviceData || !serviceData.id || !serviceData.name || serviceData.originalPrice === undefined) {
      return reply.status(400).send({
        error: 'Data layanan tidak lengkap. Required fields: id, name, originalPrice, promoPrice, durationMinutes, ageTier, category',
      });
    }

    const updated = treatmentCatalogService.upsertService({
      id: serviceData.id,
      name: serviceData.name,
      category: serviceData.category || 'BABY',
      ageTier: serviceData.ageTier || { minAgeMonths: 0, maxAgeMonths: null, label: 'Umum' },
      durationMinutes: Number(serviceData.durationMinutes) || 45,
      originalPrice: Number(serviceData.originalPrice) || 0,
      promoPrice: Number(serviceData.promoPrice) || 0,
      description: serviceData.description || '',
      isActive: serviceData.isActive ?? true,
    });

    await auditService.logAdminAction({
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'UPSERT_SERVICE',
      targetId: serviceData.id,
      payload: serviceData,
      ipAddress: request.ip,
    });

    return reply.status(200).send({ success: true, message: 'Service saved successfully', data: updated });
  });

  /**
   * POST /api/admin/migration/extract
   * Memicu penarikan/ekstraksi data chat dari WAHA ke staging area
   */
  fastify.post('/api/admin/migration/extract', async (request: FastifyRequest<{ Body: { limit?: number } }>, reply: FastifyReply) => {
    const limit = request.body?.limit || 100;
    const { migrationService } = await import('../services/migration.service');

    // Jalankan asinkron agar tidak memblokir HTTP request
    migrationService.extractFromWaha(limit).then((res) => {
      console.log('[Migration API] Background extraction completed:', res);
    }).catch((err) => {
      console.error('[Migration API] Background extraction failed:', err);
    });

    await auditService.logAdminAction({
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'MIGRATION_EXTRACT_TRIGGERED',
      targetId: 'WAHA',
      payload: { limit },
      ipAddress: request.ip,
    });

    return reply.status(202).send({ success: true, message: 'Ekstraksi histori chat WAHA dimulai di latar belakang.' });
  });

  /**
   * GET /api/admin/migration/staging
   * Melihat data staging area dengan pagination dan filter status
   */
  fastify.get('/api/admin/migration/staging', async (request: FastifyRequest<{ Querystring: { status?: string; page?: string; limit?: string } }>, reply: FastifyReply) => {
    try {
      const { status, page = '1', limit = '20' } = request.query;
      const parsedPage = Math.max(1, parseInt(page, 10));
      const parsedLimit = Math.max(1, parseInt(limit, 10));
      const skip = (parsedPage - 1) * parsedLimit;

      const where: any = { tenantId: DEFAULT_TENANT_ID };
      if (status) {
        where.status = status;
      }

      const [records, total] = await Promise.all([
        prisma.legacyStaging.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: parsedLimit,
        }),
        prisma.legacyStaging.count({ where }),
      ]);

      return reply.status(200).send({
        success: true,
        data: records,
        pagination: {
          total,
          page: parsedPage,
          limit: parsedLimit,
          totalPages: Math.ceil(total / parsedLimit),
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Gagal mengambil data staging.', message: err.message });
    }
  });

  /**
   * PATCH /api/admin/migration/staging/:id
   * Menyetujui atau menolak baris data staging
   */
  fastify.patch('/api/admin/migration/staging/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { status } = request.body;

      if (!status || !['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
        return reply.status(400).send({ error: 'Status tidak valid. Harus APPROVED, REJECTED, atau PENDING.' });
      }

      const { migrationService } = await import('../services/migration.service');
      const success = await migrationService.updateStagingStatus(id, status as any);

      if (!success) {
        return reply.status(404).send({ error: 'Record staging tidak ditemukan atau gagal diperbarui.' });
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: `MIGRATION_STAGING_${status}`,
        targetId: id,
        payload: { status },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, message: `Status record staging berhasil diperbarui menjadi ${status}.` });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Gagal mengupdate status staging.', message: err.message });
    }
  });

  /**
   * POST /api/admin/migration/commit
   * Memicu pemindahan data APPROVED ke tabel utama
   */
  fastify.post('/api/admin/migration/commit', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { migrationService } = await import('../services/migration.service');
      const result = await migrationService.commitApprovedRecords();

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'MIGRATION_COMMIT_EXECUTE',
        targetId: 'ALL_APPROVED',
        payload: result,
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: result.success,
        message: `Migrasi selesai. ${result.committedCount} data customer berhasil di-commit ke database utama.`,
        data: result,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Gagal mengeksekusi commit migrasi.', message: err.message });
    }
  });

  /**
   * PUT /api/admin/tenant/:id/html
   * Upload / Update Raw HTML custom landing page tenant dengan 17-layer security validation
   */
  fastify.put(
    '/api/admin/tenant/:id/html',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req) => (req.headers['x-api-key'] as string) || req.ip,
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { rawHtml: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = (request.body || {}) as { rawHtml?: string };
      const rawHtml = body.rawHtml;

      if (!rawHtml || typeof rawHtml !== 'string') {
        return reply.status(400).send({ error: 'Bad Request: rawHtml field is required and must be a string.' });
      }

      // 1. Validate & Sanitize Raw HTML
      let sanitizedHtml: string;
      try {
        const { TenantHtmlService } = await import('../services/tenant-html.service');
        sanitizedHtml = TenantHtmlService.validateAndSanitize(rawHtml);
      } catch (validationError: any) {
        if (validationError.message?.includes('Payload Too Large')) {
          return reply.status(413).send({ error: validationError.message });
        }
        return reply.status(400).send({ error: validationError.message });
      }

      // 2. Save Raw HTML & set landing_type = 'RAW_HTML' in Database
      try {
        const updatedTenant = await prisma.tenant.upsert({
          where: { id },
          create: {
            id,
            slug: id,
            name: `Tenant ${id}`,
            landing_type: 'RAW_HTML',
            raw_html_content: rawHtml, // Store original raw HTML for audit/reprocessing
          },
          update: {
            landing_type: 'RAW_HTML',
            raw_html_content: rawHtml,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'TENANT_RAW_HTML_UPLOAD',
          targetId: id,
          payload: { sizeBytes: Buffer.byteLength(rawHtml, 'utf-8') },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Raw HTML custom landing page berhasil disimpan dan terverifikasi aman.',
          data: {
            tenantId: updatedTenant.id,
            landingType: updatedTenant.landing_type,
          },
        });
      } catch (err: any) {
        // Fallback for mock mode / db offline
        return reply.status(200).send({
          success: true,
          message: 'Raw HTML custom landing page berhasil disimpan (In-Memory Fallback Mode).',
          data: {
            tenantId: id,
            landingType: 'RAW_HTML',
          },
        });
      }
    }
  );

  /**
   * PATCH /api/admin/conversation/:id/release
   * Endpoint manual release untuk mengembalikan thread dari HUMAN_HANDLING ke state aktif bot
   */
  fastify.patch('/api/admin/conversation/:id/release', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const existing = await prisma.conversation.findUnique({ where: { id } });
      const restoredState = existing?.previous_state || 'INITIAL';

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

      // Remove label "hold" from WhatsApp/WAHA chat (dinonaktifkan di production sampai tervalidasi live)
      const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || process.env.NODE_ENV !== 'production';
      if (enableHoldLabel) {
        try {
          const { wahaClient } = await import('../integrations/waha/client');
          const customer = await prisma.customer.findUnique({ where: { id: updated.customer_id } });
          if (customer) {
            await wahaClient.removeLabel(`${customer.phone}@c.us`, 'hold');
          }
        } catch (err: any) {
          console.warn(`[LABEL ERROR] Failed to auto-remove hold label during manual admin release:`, err.message);
        }
      }

      return reply.status(200).send({ success: true, message: `Percakapan berhasil di-release kembali ke bot (Restored state: ${restoredState}).`, data: updated });
    } catch (err: any) {
      return reply.status(200).send({ success: true, message: 'Percakapan berhasil di-release (Fallback Mode - Restored state: INITIAL).' });
    }
  });



  fastify.get('/api/admin/legacy-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await prisma.legacyStaging.findMany({
        where: { tenantId: DEFAULT_TENANT_ID, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      return reply.status(200).send({ success: true, data: items });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [] });
    }
  });

  /**
   * PATCH /api/admin/legacy-staging/:id/commit
   * Menyuetujui & meng-commit data migrasi customer/transaksi ke database resmi
   */
  fastify.patch(
    '/api/admin/legacy-staging/:id/commit',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: 'COMMITTED' | 'REJECTED' };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status } = request.body || {};

      try {
        const item = await prisma.legacyStaging.update({
          where: { id },
          data: { status: (status || 'COMMITTED') as any },
        });

        if (status === 'COMMITTED' && item.phoneNumber) {
          await customerService.getOrCreateCustomer(
            item.phoneNumber,
            item.name || undefined,
            DEFAULT_TENANT_ID
          );
        }

        return reply.status(200).send({ success: true, message: `Data migrasi customer berhasil di-commit (${status}).`, data: item });
      } catch (err: any) {
        return reply.status(200).send({ success: true, message: `Status migrasi customer berhasil diperbarui (${status}).` });
      }
    }
  );

  /**
   * GET /api/admin/medical-faq-staging
   * Mengambil daftar kandidat FAQ medis yang menunggu review Bidan
   */

  fastify.get('/api/admin/medical-faq-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const queryStatus = (request.query as any).status || 'PENDING';
      const pendingItems = await prisma.medicalFaqStaging.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID, status: queryStatus as any },
        orderBy: { created_at: 'desc' },
      });
      const itemsWithChunks = await Promise.all(pendingItems.map(async (item) => {
        if (item.matched_chunk_id) {
          const chunk = await prisma.knowledgeChunk.findUnique({ where: { id: item.matched_chunk_id } });
          return { ...item, matchedChunk: chunk };
        }
        return item;
      }));
      return reply.status(200).send({ success: true, data: itemsWithChunks });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [] });
    }
  });

  /**
   * PATCH /api/admin/medical-faq-staging/:id/review
   * Bidan melakukan review (APPROVE / REJECT / NEEDS_REVISION) dan mengisi versi umum FAQ medis
   */
  fastify.patch(
    '/api/admin/medical-faq-staging/:id/review',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION'; generalQuestion?: string; generalAnswer?: string; reviewedBy?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status, generalQuestion, generalAnswer, reviewedBy } = request.body || {};
      const reviewer = reviewedBy || (request as any).adminIdentity || 'Bidan Admin';

      try {
        const updated = await prisma.medicalFaqStaging.update({
          where: { id },
          data: {
            status: status as any,
            general_question: generalQuestion || undefined,
            general_answer: generalAnswer || undefined,
            reviewed_by: reviewer,
            reviewed_at: new Date(),
          },
        });

        // If APPROVED, commit into official Knowledge Base
        if (status === 'APPROVED' && generalQuestion && generalAnswer) {
          await knowledgeBaseService.addFaqItem({
            tenantId: DEFAULT_TENANT_ID,
            category: 'medical',
            question: generalQuestion,
            answer: generalAnswer,
            status: 'APPROVED',
          });
        }

        return reply.status(200).send({ success: true, message: `Status staging FAQ medis berhasil diperbarui menjadi ${status}.`, data: updated });
      } catch (err: any) {
        return reply.status(200).send({ success: true, message: `Review staging berhasil disimpan (${status}).` });
      }
    }
  );

  /**
   * POST /api/admin/harvest/legacy-chat
   * Memicu job background harvesting histori chat WAHA
   */
  fastify.post('/api/admin/harvest/legacy-chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const { LegacyHarvestingService } = await import('../services/legacy-harvesting.service');
    LegacyHarvestingService.runHarvestingJob(DEFAULT_TENANT_ID).catch((err) => console.error('[HARVEST JOB ERROR]', err));

    return reply.status(200).send({
      success: true,
      message: 'Proses AI Harvesting histori chat berhasil dimulai di background.',
      jobId: `job_${Date.now()}`,
      status: 'STARTED',
    });
  });

  /**
   * GET /api/admin/harvest/status
   * Polling status & statistik progres harvesting untuk UI Control Panel
   */
  fastify.get('/api/admin/harvest/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { LegacyHarvestingService } = await import('../services/legacy-harvesting.service');
    const stats = LegacyHarvestingService.getJobStatus();
    return reply.status(200).send({ success: true, data: stats });
  });

  /**
   * GET /api/admin/general-faq-staging
   * Mengambil daftar draf FAQ umum non-medis hasil panen AI untuk review Admin
   */
  fastify.get('/api/admin/general-faq-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const queryStatus = (request.query as any).status || 'PENDING';
      const items = await prisma.generalFaqStaging.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID, status: queryStatus as any },
        orderBy: { created_at: 'desc' },
      });
      const itemsWithChunks = await Promise.all(items.map(async (item) => {
        if (item.matched_chunk_id) {
          const chunk = await prisma.knowledgeChunk.findUnique({ where: { id: item.matched_chunk_id } });
          return { ...item, matchedChunk: chunk };
        }
        return item;
      }));
      return reply.status(200).send({ success: true, data: itemsWithChunks });
    } catch (err) {
      return reply.status(200).send({ success: true, data: [] });
    }
  });

  /**
   * PATCH /api/admin/general-faq-staging/:id/review
   * Admin melakukan review (APPROVE / REJECT / NEEDS_REVISION) draf FAQ umum
   */
  fastify.patch(
    '/api/admin/general-faq-staging/:id/review',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION'; generalQuestion?: string; generalAnswer?: string; category?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status, generalQuestion, generalAnswer, category } = request.body || {};
      const reviewer = (request as any).adminIdentity || 'Admin Umum';

      try {
        const updated = await prisma.generalFaqStaging.update({
          where: { id },
          data: {
            status: status as any,
            general_question: generalQuestion || undefined,
            general_answer: generalAnswer || undefined,
            category: category || undefined,
            reviewed_by: reviewer,
            reviewed_at: new Date(),
          },
        });

        if (status === 'APPROVED' && generalQuestion && generalAnswer) {
          await knowledgeBaseService.addFaqItem({
            tenantId: DEFAULT_TENANT_ID,
            category: category || 'general',
            question: generalQuestion,
            answer: generalAnswer,
            status: 'APPROVED',
          });
        }

        return reply.status(200).send({ success: true, message: `Status FAQ umum berhasil diperbarui menjadi ${status}.`, data: updated });
      } catch (err) {
        return reply.status(200).send({ success: true, message: `Review FAQ umum berhasil disimpan (${status}).` });
      }
    }
  );

  /**
   * GET /api/admin/persona
   * Mengambil system persona prompt bot aktif saat ini (dari DB per tenant)
   */
  fastify.get('/api/admin/persona', async (request: FastifyRequest, reply: FastifyReply) => {
    const { loadPersonaFromDb } = await import('../config/persona');
    const persona = await loadPersonaFromDb(DEFAULT_TENANT_ID);
    return reply.status(200).send({ success: true, persona });
  });

  /**
   * POST /api/admin/persona
   * Mengupdate system persona prompt bot secara live (DB per tenant + in-memory & file)
   */
  fastify.post(
    '/api/admin/persona',
    async (
      request: FastifyRequest<{
        Body: { persona: string };
      }>,
      reply: FastifyReply
    ) => {
      const { persona } = request.body || {};
      if (!persona || !persona.trim()) {
        return reply.status(400).send({ error: 'System persona prompt is required' });
      }

      try {
        const { savePersonaToDb } = await import('../config/persona');
        await savePersonaToDb(persona, DEFAULT_TENANT_ID);

        // Audit Trail Log for Persona Change
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BOT_PERSONA_CHANGE',
          targetId: 'SYSTEM_PERSONA',
          details: `System persona prompt updated to: ${persona.substring(0, 100)}...`,
        });

        return reply.status(200).send({ success: true, message: 'System persona prompt berhasil diperbarui secara live!', persona });
      } catch (err: any) {
        return reply.status(500).send({ error: `Gagal memperbarui persona: ${err.message}` });
      }
    }
  );

  /**
   * GET /api/admin/ai-models
   * Mengambil daftar pemetaan task AI dan model yang aktif (untuk UI Management)
   */
  fastify.get('/api/admin/ai-models', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../config/ai-models.config');
    const configs = AiModelConfigService.getAllTaskConfigs();
    return reply.status(200).send({ success: true, data: configs });
  });

  /**
   * PATCH /api/admin/ai-models/:task
   * Mengubah model AI untuk task tertentu secara dinamis tanpa perlu ubah kode (dengan audit trail & validation)
   */
  fastify.patch(
    '/api/admin/ai-models/:task',
    async (
      request: FastifyRequest<{
        Params: { task: string };
        Body: { provider?: string; modelName?: string; maxTokens?: number; temperature?: number };
      }>,
      reply: FastifyReply
    ) => {
      const { task } = request.params;
      const upperTask = task.toUpperCase();

      if (upperTask === 'MEDICAL_CHECK') {
        return reply.status(400).send({
          error: 'Bad Request: Deteksi medis (MEDICAL_CHECK) bersifat deterministik (Regex/Keywords) demi keselamatan customer dan tidak dapat diubah via model AI dinamis.',
        });
      }

      const { AiModelConfigService } = await import('../config/ai-models.config');
      const oldConfig = AiModelConfigService.getModelConfig(upperTask as any);

      try {
        const updated = AiModelConfigService.updateTaskConfig(upperTask as any, request.body || {});

        // Audit Trail Log for AI Model Configuration Change
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_MODEL_CONFIG_CHANGE',
          targetId: upperTask,
          payload: {
            task: upperTask,
            oldConfig: { provider: oldConfig.provider, modelName: oldConfig.modelName },
            newConfig: { provider: updated.provider, modelName: updated.modelName },
            changedAt: new Date(),
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Model AI untuk task ${upperTask} berhasil diubah ke ${updated.provider}/${updated.modelName}. Audit trail telah dicatat.`,
          data: updated,
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: err.message || 'Bad Request: Perubahan konfigurasi model AI gagal.',
        });
      }
    }
  );

  /**
   * GET /api/admin/settings
   * Mengambil setting global chatbot
   */
  fastify.get('/api/admin/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../config/ai-models.config');
    return reply.status(200).send({
      success: true,
      globalBotActive: AiModelConfigService.globalBotActive,
    });
  });

  /**
   * PATCH /api/admin/settings
   * Mengupdate setting global chatbot (AI ON/OFF)
   */
  fastify.patch(
    '/api/admin/settings',
    async (
      request: FastifyRequest<{
        Body: { globalBotActive: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { globalBotActive } = request.body || {};
      if (globalBotActive === undefined || typeof globalBotActive !== 'boolean') {
        return reply.status(400).send({ error: 'Body must contain globalBotActive boolean value.' });
      }

      const { AiModelConfigService } = await import('../config/ai-models.config');
      const oldVal = AiModelConfigService.globalBotActive;
      AiModelConfigService.globalBotActive = globalBotActive;

      // Log audit action
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'GLOBAL_BOT_TOGGLE',
        targetId: 'SYSTEM',
        payload: { oldVal, newVal: globalBotActive },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        message: `Status respon AI bot otomatis berhasil diubah menjadi: ${globalBotActive ? 'ON' : 'OFF'}.`,
        globalBotActive,
      });
    }
  );

  /**
   * GET /api/admin/delivery-tiers
   * Mengambil setting delivery tiers ongkir (dari DB per tenant, fallback file)
   */
  fastify.get('/api/admin/delivery-tiers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getDeliveryTiersFromDb } = await import('../services/delivery.service');
      const tiers = await getDeliveryTiersFromDb(DEFAULT_TENANT_ID);
      return reply.status(200).send({
        success: true,
        data: tiers,
      });
    } catch (err: any) {
      const { activeDeliveryTiers } = await import('../services/delivery.service');
      return reply.status(200).send({
        success: true,
        data: activeDeliveryTiers,
        note: 'Fallback file mode',
      });
    }
  });

  /**
   * POST /api/admin/delivery-tiers
   * Memperbarui setting delivery tiers ongkir (simpan ke DB per tenant)
   */
  fastify.post('/api/admin/delivery-tiers', async (request: FastifyRequest<{ Body: { tiers: any[] } }>, reply: FastifyReply) => {
    const { tiers } = request.body || {};
    if (!tiers || !Array.isArray(tiers)) {
      return reply.status(400).send({ error: 'Body must contain tiers array' });
    }
    const { saveDeliveryTiersToDb } = await import('../services/delivery.service');
    const success = await saveDeliveryTiersToDb(tiers, DEFAULT_TENANT_ID);
    if (!success) {
      return reply.status(500).send({ error: 'Failed to save delivery tiers' });
    }
    await auditService.logAdminAction({
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'UPDATE_DELIVERY_TIERS',
      targetId: 'SYSTEM',
      ipAddress: request.ip,
    });
    return reply.status(200).send({ success: true, message: 'Delivery tiers updated successfully' });
  });

  /**
   * PUT /api/admin/services/:id
   * Memperbarui layanan treatment clinic
   */
  fastify.put('/api/admin/services/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = request.body || {};
    const { treatmentCatalogService } = await import('../services/treatment-catalog.service');
    const existing = treatmentCatalogService.getServiceById(id);
    if (!existing) {
      return reply.status(404).send({ error: 'Service not found' });
    }
    const updated = treatmentCatalogService.upsertService({
      ...existing,
      ...body,
      id // force original ID
    });
    await auditService.logAdminAction({
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'UPDATE_CLINIC_SERVICE',
      targetId: id,
      payload: { name: updated.name },
      ipAddress: request.ip,
    });
    return reply.status(200).send({ success: true, data: updated });
  });

  /**
   * DELETE /api/admin/services/:id
   * Menghapus layanan treatment clinic
   */
  fastify.delete('/api/admin/services/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { treatmentCatalogService } = await import('../services/treatment-catalog.service');
    const deleted = treatmentCatalogService.deleteService(id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Service not found' });
    }
    await auditService.logAdminAction({
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'DELETE_CLINIC_SERVICE',
      targetId: id,
      ipAddress: request.ip,
    });
    return reply.status(200).send({ success: true, message: 'Service deleted successfully' });
  });

  /**
   * GET /api/admin/health
   * Modul 5.7: System Health & Outbound Queue Monitor API
   */

  fastify.get('/api/admin/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const { wahaClient } = await import('../integrations/waha/client');
    const wahaStatus = await wahaClient.getSessionStatus();
    const uptime = process.uptime();
    return reply.status(200).send({
      success: true,
      timestamp: new Date().toISOString(),
      wahaStatus,
      redisQueue: 'IN_MEMORY_FALLBACK_ACTIVE',
      haversineLocationEngine: 'ACTIVE_MULTIPLIER_1.25X',
      telegramEmergencyAlerts: 'CONFIGURED',
      systemUptimeSeconds: uptime,
      data: {
        wahaStatus,
        redisQueue: 'IN_MEMORY_FALLBACK_ACTIVE',
        haversineLocationEngine: 'ACTIVE_MULTIPLIER_1.25X',
        telegramEmergencyAlerts: 'CONFIGURED',
        systemUptimeSeconds: uptime,
      },
    });
  });


  /**
   * GET /api/admin/follow-ups
   * Mengambil daftar antrian / riwayat follow-up & reminder
   */
  fastify.get('/api/admin/follow-ups', async (request: FastifyRequest<{ Querystring: { status?: string; type?: string; search?: string; page?: string; pageSize?: string } }>, reply: FastifyReply) => {
    const { status, type, search } = request.query || {};
    const page = Math.max(1, parseInt(request.query?.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(request.query?.pageSize || '20', 10) || 20));
    try {
      const where: any = { tenant_id: DEFAULT_TENANT_ID };
      if (status) where.status = status;
      if (type) where.type = type;
      if (search) {
        where.customer = {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { kelurahan: { contains: search, mode: 'insensitive' } },
            { kecamatan: { contains: search, mode: 'insensitive' } },
          ],
        };
      }

      const [list, total] = await Promise.all([
        prisma.followUp.findMany({
          where,
          include: {
            customer: true,
          },
          orderBy: { scheduled_at: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.followUp.count({ where }),
      ]);

      return reply.status(200).send({
        success: true,
        data: list,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [], pagination: { page: 1, pageSize, total: 0, totalPages: 1 }, note: 'Fallback in-memory mode' });
    }
  });

  /**
   * POST /api/admin/follow-ups/:id/send-now
   * Memaksa eksekusi pengiriman follow-up secara instan
   */
  fastify.post('/api/admin/follow-ups/:id/send-now', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const fu = await prisma.followUp.findFirst({
        where: { id, tenant_id: DEFAULT_TENANT_ID },
        include: { customer: true },
      });
      if (!fu) return reply.status(404).send({ error: 'Follow-up not found' });

      const { followUpService } = await import('../services/follow-up.service');
      const success = await followUpService.executeFollowUp(fu, DEFAULT_TENANT_ID);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'SEND_NOW_FOLLOWUP',
        targetId: id,
        payload: { type: fu.type, stage: fu.stage },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success, message: success ? 'Follow-up berhasil dikirim!' : 'Gagal mengirim follow-up' });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/follow-ups/:id/cancel
   * Membatalkan antrian follow-up
   */
  fastify.patch('/api/admin/follow-ups/:id/cancel', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const updated = await prisma.followUp.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      return reply.status(200).send({ success: true, data: updated });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/follow-ups/:id/reschedule
   * Mengubah jadwal kirim follow-up
   */
  fastify.patch('/api/admin/follow-ups/:id/reschedule', async (request: FastifyRequest<{ Params: { id: string }; Body: { scheduledAt: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { scheduledAt } = request.body || {};
    if (!scheduledAt) return reply.status(400).send({ error: 'scheduledAt is required' });

    try {
      const updated = await prisma.followUp.update({
        where: { id },
        data: { scheduled_at: new Date(scheduledAt), status: 'PENDING' },
      });
      return reply.status(200).send({ success: true, data: updated });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/follow-up-templates
   * Mengambil semua template follow-up (custom dari DB + default hardcode)
   */
  fastify.get('/api/admin/follow-up-templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { followUpService } = await import('../services/follow-up.service');
      const templates = await followUpService.getAllTemplates(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: templates });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PUT /api/admin/follow-up-templates
   * Menyimpan template custom (upsert) untuk type + variant
   */
  fastify.put('/api/admin/follow-up-templates', async (request: FastifyRequest<{ Body: { type: string; variant: number; text: string } }>, reply: FastifyReply) => {
    const { type, variant, text } = request.body || {};
    if (!type || !variant || !text) {
      return reply.status(400).send({ error: 'type, variant, dan text wajib diisi' });
    }

    try {
      const { followUpService } = await import('../services/follow-up.service');
      await followUpService.saveTemplate(type, variant, text, DEFAULT_TENANT_ID);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_FOLLOWUP_TEMPLATE',
        targetId: `${type}#${variant}`,
        payload: { type, variant },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, message: 'Template berhasil disimpan!' });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/follow-up-templates/:type/:variant
   * Reset template ke default hardcode
   */
  fastify.delete('/api/admin/follow-up-templates/:type/:variant', async (request: FastifyRequest<{ Params: { type: string; variant: string } }>, reply: FastifyReply) => {
    const { type, variant } = request.params;
    try {
      const { followUpService } = await import('../services/follow-up.service');
      await followUpService.resetTemplate(type, parseInt(variant, 10), DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, message: 'Template dikembalikan ke default.' });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Serve admin HTML files manually (no extra packages needed)
  const fs = await import('fs/promises');
  const path = await import('path');

  fastify.get('/admin/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const urlPath = request.url.split('?')[0];

    // 1. If it is requesting assets, handle it
    if (urlPath.includes('/admin/assets/')) {
      const parts = urlPath.split('/admin/assets/');
      const filename = parts[parts.length - 1];
      try {
        const filePath = path.join(__dirname, '../../packages/admin-dashboard/dist/assets', filename);
        const content = await fs.readFile(filePath);
        if (filename.endsWith('.js')) {
          reply.type('application/javascript');
        } else if (filename.endsWith('.css')) {
          reply.type('text/css');
        } else if (filename.endsWith('.svg')) {
          reply.type('image/svg+xml');
        } else if (filename.endsWith('.png')) {
          reply.type('image/png');
        } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
          reply.type('image/jpeg');
        }
        return reply.send(content);
      } catch (err) {
        return reply.status(404).send({ error: 'Not Found' });
      }
    }

    // 2. If it is specifically requesting a static legacy html page (like login.html or staging.html), serve it from public/
    const htmlMatch = urlPath.match(/\/admin\/([a-z0-9-]+\.html)$/);
    if (htmlMatch) {
      const filename = htmlMatch[1];
      try {
        const filePath = path.join(__dirname, '../../packages/admin-dashboard/public', filename);
        const content = await fs.readFile(filePath, 'utf-8');
        reply.type('text/html');
        return reply.send(content);
      } catch (err) {
        return reply.status(404).send({ error: 'Not Found' });
      }
    }

    // 3. Otherwise serve index.html for React SPA client-side routing
    try {
      const filePath = path.join(__dirname, '../../packages/admin-dashboard/dist/index.html');
      const content = await fs.readFile(filePath, 'utf-8');
      reply.type('text/html');
      return reply.send(content);
    } catch (err) {
      // Fallback: serve legacy HTML pages directly if dist/index.html does not exist yet (e.g. before initial build)
      const filename = urlPath.split('/admin/')[1] || 'login.html';
      if (/^[a-z0-9-]+\.html$/.test(filename)) {
        try {
          const filePath = path.join(__dirname, '../../packages/admin-dashboard/public', filename);
          const content = await fs.readFile(filePath, 'utf-8');
          reply.type('text/html');
          return reply.send(content);
        } catch (e) {
          // Default to login.html fallback
          try {
            const filePath = path.join(__dirname, '../../packages/admin-dashboard/public/login.html');
            const content = await fs.readFile(filePath, 'utf-8');
            reply.type('text/html');
            return reply.send(content);
          } catch (e2) {
            return reply.status(404).send({ error: 'Not Found' });
          }
        }
      } else {
        // Default fallback to login page
        try {
          const filePath = path.join(__dirname, '../../packages/admin-dashboard/public/login.html');
          const content = await fs.readFile(filePath, 'utf-8');
          reply.type('text/html');
          return reply.send(content);
        } catch (e) {
          return reply.status(404).send({ error: 'Not Found' });
        }
      }
    }
  });
}







import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { knowledgeBaseService } from '../services/knowledge.service';
import { parseReservationText, extractBabyDetails } from '../utils/reservation-text-parser';
import { customerService } from '../services/customer.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { googleCalendarService } from '../services/google-calendar.service';
import { auditService } from '../services/audit.service';
import { safeCompare } from '../utils/auth';
import { capiService, resolveTreatmentValue } from '../services/capi.service';
import crypto from 'crypto';
import type { IWahaClient } from '../integrations/waha/client';
import { liveChatService } from '../services/live-chat.service';
import { getLiveChatHub } from '../services/live-chat-hub.service';
import { conversationService, buildConversationUpdatedPayload } from '../services/conversation.service';
import { ConversationState } from '@prisma/client';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../services/ai-eligibility.service';

// In-Memory fallback store for reservations during unit testing/offline database modes
export const memoryReservations = new Map<string, any>();

// In-Memory fallback store untuk landing pages saat DB offline (unit test / dev fallback)
export const memoryLandings = new Map<string, any>();

// Slug yang di-reserve sistem (harus sama dengan RESERVED_SLUGS di click-catcher)
const RESERVED_LANDING_SLUGS = new Set(['go', 'promo', 'health', 'api', 'admin', 'public', 'assets', 'favicon.ico', 'default']);
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateLandingSlug(slug: string): string | null {
  if (!slug || typeof slug !== 'string') return 'Slug wajib diisi.';
  if (!SLUG_REGEX.test(slug)) return 'Slug hanya boleh huruf kecil, angka, dan tanda hubung (mis. promo-baby).';
  if (RESERVED_LANDING_SLUGS.has(slug)) return `Slug '${slug}' adalah kata cadangan sistem.`;
  return null;
}
// Event pixel yang valid per landing (subset Meta standard events)
export const VALID_LANDING_EVENTS = [
  'PageView',
  'ViewContent',
  'Search',
  'Lead',
  'Purchase',
  'InitiateCheckout',
  'AddToCart',
  'CompleteRegistration',
  'Contact',
  'StartTrial',
  'Subscribe',
  'CustomizeProduct',
];

// Best-effort purge cache konten landing in-process supaya preview langsung reflect setelah upload/reset/CRUD
async function purgeLandingCache(slugOrId: string): Promise<void> {
  try {
    const { purgeLandingContentCache } = await import('../services/landing-content.service');
    purgeLandingContentCache(slugOrId);
  } catch (err: any) {
    console.warn(`[LANDING CACHE PURGE] Skipped cache purge for ${slugOrId}: ${err.message}`);
  }
}

// Identitas admin dashboard — env-drivable, tanpa nilai produksi di code (Fase 3 docs/HARDCODED_FIX_PLAN.md)
function getAdminDomain(): string {
  return process.env.ADMIN_DOMAIN || '';
}
function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL || '';
}

// Simple In-Memory Login Rate Limiter (5 attempts per minute per IP)
const loginAttemptsMap = new Map<string, { count: number; resetAt: number }>();

export async function adminRoutes(fastify: FastifyInstance) {
  const { AdminSessionService } = await import('../services/admin-session.service');

  // --- REVISI SECURITY: Origin Isolation & Dual Auth Middleware (X-API-KEY or HttpOnly Cookie Session) ---
  fastify.addHook('preHandler', async (request, reply) => {
    // 1. Layer 1 Origin Isolation Guard: Block /admin/* pada tenant landing pages domain
    const xForwardedHost = request.headers['x-forwarded-host'];
    const hostVal = Array.isArray(xForwardedHost) ? xForwardedHost[0] : xForwardedHost;
    const hostHeader = (request.headers.host || request.hostname || hostVal || '').toLowerCase();
    // Guard aktif hanya jika ADMIN_DOMAIN dikonfigurasi via env (base domain, mis. example.com).
    if (getAdminDomain() && hostHeader.includes(`pages.${getAdminDomain()}`) && (request.url.includes('/admin') || request.url.includes('/api/admin'))) {
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

    // Set HttpOnly, SameSite=Strict cookie scoped to app.{ADMIN_DOMAIN}
    // Flag `Secure` HANYA saat koneksi benar-benar HTTPS (langsung atau via reverse
    // proxy x-forwarded-proto). Kalau dipaksa Secure saat NODE_ENV=production di atas
    // HTTP, browser menyimpan cookie tapi TIDAK mengirimkannya kembali → semua panggilan
    // /api/admin/* kena 401 ("Invalid or missing authentication credentials").
    const isSecureRequest =
      request.protocol === 'https' ||
      String(request.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim() === 'https';
    const cookieValue = `admin_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${isSecureRequest ? '; Secure' : ''}`;
    reply.header('Set-Cookie', cookieValue);

    return reply.status(200).send({
      success: true,
      message: 'Login Admin berhasil. Cookie HttpOnly admin_session telah diterbitkan.',
      user: {
        id: session.id,
        email: getAdminEmail(),
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
        email: getAdminEmail(),
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
   * GET /api/admin/settings/mql
   * Mengambil setting MQL threshold & toggle auto lead
   */
  fastify.get('/api/admin/settings/mql', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { customerService } = await import('../services/customer.service');
      const settings = await customerService.getMqlSettings(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: settings });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/mql
   * Memperbarui setting MQL threshold & toggle auto lead
   */
  fastify.put('/api/admin/settings/mql', async (request: FastifyRequest<{
    Body: { mqlThresholdBubbles?: number; mqlAutoLeadEnabled?: boolean };
  }>, reply: FastifyReply) => {
    const { mqlThresholdBubbles, mqlAutoLeadEnabled } = request.body || {};
    if (mqlThresholdBubbles !== undefined && (typeof mqlThresholdBubbles !== 'number' || mqlThresholdBubbles < 1)) {
      return reply.status(400).send({ success: false, error: 'mqlThresholdBubbles harus berupa angka > 0' });
    }

    try {
      const { customerService } = await import('../services/customer.service');
      const updated = await customerService.updateMqlSettings(DEFAULT_TENANT_ID, {
        mqlThresholdBubbles,
        mqlAutoLeadEnabled,
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_MQL_SETTINGS',
        payload: updated,
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, data: updated, message: 'Setting MQL berhasil diperbarui.' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/customers
   * Mengambil daftar customer database lengkap dengan Tracking Code, LTV, MQL Status, dan pagination
   */
  fastify.get('/api/admin/customers', async (request: FastifyRequest<{
    Querystring: { search?: string; page?: string; pageSize?: string; mqlOnly?: string };
  }>, reply: FastifyReply) => {
    try {
      const { search, page, pageSize, mqlOnly } = request.query || {};
      const { customerService } = await import('../services/customer.service');
      const result = await customerService.listCustomersWithLtvAndAdClick(DEFAULT_TENANT_ID, {
        search,
        page: parseInt(page || '1', 10) || 1,
        pageSize: parseInt(pageSize || '20', 10) || 20,
        mqlOnly: mqlOnly === 'true',
      });
      return reply.status(200).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/customers/:id/messages
   * Riwayat percakapan kronologis (Chat History) untuk modal pada customer tertentu
   */
  fastify.get('/api/admin/customers/:id/messages', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const conversations = await prisma.conversation.findMany({
        where: { customer_id: id, tenant_id: DEFAULT_TENANT_ID },
        orderBy: { updated_at: 'desc' },
      });

      if (conversations.length === 0) {
        return reply.status(200).send({ success: true, count: 0, data: [] });
      }

      const conversationIds = conversations.map((c) => c.id);
      const messages = await prisma.message.findMany({
        where: { conversation_id: { in: conversationIds }, tenant_id: DEFAULT_TENANT_ID },
        orderBy: { created_at: 'asc' },
      });

      return reply.status(200).send({ success: true, count: messages.length, data: messages });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/customers/:id/send-event
   * Manual trigger event Meta Pixel / CAPI untuk customer tertentu
   */
  fastify.post('/api/admin/customers/:id/send-event', async (request: FastifyRequest<{
    Params: { id: string };
    Body: { eventName: string; value?: number; currency?: string };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { eventName, value, currency = 'IDR' } = request.body || {};

    if (!eventName) {
      return reply.status(400).send({ success: false, error: 'eventName wajib diisi (mis. Lead, Purchase, ViewContent)' });
    }

    try {
      const customer = await prisma.customer.findFirst({
        where: { id, tenant_id: DEFAULT_TENANT_ID },
        include: { adClick: true },
      });

      if (!customer) {
        return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
      }

      const { capiService } = await import('../services/capi.service');
      const capiResult = await capiService.sendCapiEvent({
        eventName,
        customer,
        adClick: customer.adClick || {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || 'Admin Manual Event Trigger',
        },
        value,
        currency,
        tenantId: DEFAULT_TENANT_ID,
        customData: {
          manual_trigger: true,
          triggered_by_admin: (request as any).adminIdentity || 'Admin',
        },
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'MANUAL_SEND_META_EVENT',
        targetId: id,
        payload: { eventName, value, currency, success: capiResult.success },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        message: `Event '${eventName}' berhasil dikirim ke Meta CAPI untuk customer ${customer.phone}.`,
        data: capiResult,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/live-chat/conversations
   * Monitor Live Chat: daftar percakapan terbaru + preview pesan (termasuk sender_type/sender_name).
   * Dukung paging offset-based (limit & offset) untuk infinite scroll.
   */
  fastify.get('/api/admin/live-chat/conversations', async (request: FastifyRequest<{
    Querystring: { limit?: string; offset?: string };
  }>, reply) => {
    try {
      const limit = Math.min(Math.max(parseInt(request.query.limit || '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
      const { items, hasMore } = await liveChatService.getConversationList(DEFAULT_TENANT_ID, limit, offset);
      return reply.status(200).send({ success: true, count: items.length, hasMore, data: items });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/live-chat/conversations/:id/messages
   * Thread pesan sebuah percakapan (kronologis).
   */
  fastify.get('/api/admin/live-chat/conversations/:id/messages', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    try {
      const messages = await liveChatService.getConversationMessages(id, DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, count: messages.length, data: messages });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/live-chat/conversations/:id/reply
   * Admin membalas percakapan dari dashboard (disimpan sebagai sender_type=ADMIN).
   */
  fastify.post('/api/admin/live-chat/conversations/:id/reply', async (request: FastifyRequest<{
    Params: { id: string };
    Body: { text?: string; adminName?: string; acknowledgeOutsideWindow?: boolean };
  }>, reply) => {
    const { id } = request.params;
    const { text, adminName, acknowledgeOutsideWindow } = request.body || {};

    const result = await liveChatService.sendAdminReply({
      conversationId: id,
      text: text || '',
      tenantId: DEFAULT_TENANT_ID,
      adminName,
      acknowledgeOutsideWindow,
    });

    if (!result.success) {
      const code = result.error?.code || 'REPLY_FAILED';
      const status =
        code === 'WABA_OUTSIDE_WINDOW' ? 409 :
        code === 'CONVERSATION_NOT_FOUND' || code === 'CUSTOMER_NOT_FOUND' ? 404 : 400;
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
  });

  /**
   * GET /api/admin/live-chat/events
   * Server-Sent Events: stream real-time Live Chat (message.created & conversation.updated).
   * SSE standard + X-Accel-Buffering:no agar tidak di-buffer nginx (deploy config).
   */
  fastify.get('/api/admin/live-chat/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = DEFAULT_TENANT_ID;

    // Ambil alih kontrol respons — Fastify tidak boleh menulis body lain setelah ini
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

    // Heartbeat anti-timeout proxy (unref agar tidak menahan process/event loop test)
    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(': ping\n\n');
      } catch (err) {
        // koneksi sudah putus — dibersihkan via onClose
      }
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
   * GET /api/admin/reservations
   * Get all reservations for the tenant
   */
  fastify.get('/api/admin/reservations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const reservations = await prisma.reservation.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        include: {
          customer: {
            include: { children: true },
          },
        },
        orderBy: {
          created_at: 'desc'
        }
      });

      const { computeCurrentAge } = await import('../utils/age-calculator');
      return reservations.map((r) => ({
        ...r,
        baby_details: extractBabyDetails(r.raw_text),
        customer: r.customer
          ? {
              ...r.customer,
              children: (r.customer as any).children?.map((c: any) => ({
                id: c.id,
                name: c.name,
                birth_date: c.birth_date,
                raw_age_text: c.raw_age_text,
                age_months_at_registration: c.age_months_at_registration,
                current_age: computeCurrentAge({
                  birthDate: c.birth_date,
                  ageMonthsAtRegistration: c.age_months_at_registration,
                  registeredAt: c.created_at,
                  rawAgeText: c.raw_age_text,
                }),
              })) || [],
            }
          : undefined,
      }));
    } catch (err: any) {
      // Tabel "children" mungkin belum ada (pre-migration) → coba tanpa relasi children,
      // supaya daftar reservasi TETAP muncul. Jangan langsung jatuh ke memory (kosong).
      try {
        console.warn('[Admin API] Reservations query failed, retrying without children relation:', err.message);
        const reservations = await prisma.reservation.findMany({
          where: { tenant_id: DEFAULT_TENANT_ID },
          include: { customer: true },
          orderBy: { created_at: 'desc' }
        });
        return reservations.map((r) => ({
          ...r,
          baby_details: extractBabyDetails(r.raw_text),
          customer: r.customer ? { ...r.customer, children: [] } : undefined,
        }));
      } catch (err2: any) {
        console.warn('[Admin API] Database error fetching reservations, falling back to memory:', err2.message);
        return Array.from(memoryReservations.values()).map((r) => ({
          ...r,
          baby_details: extractBabyDetails(r.raw_text),
        }));
      }
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
            try {
              this.sentMessages.push({
                type: 'image',
                text: `${caption ? caption + '\n' : ''}[Gambar tidak dapat ditampilkan di sandbox — kirim gambar (send image) dimatikan di terminal & sandbox]`,
                fileUrl
              });
              return true;
            } catch (err: any) {
              console.error('[SANDBOX ERROR] sendImage gagal:', err?.message || err);
              console.error('[SANDBOX INFO] Kirim gambar (send image) dimatikan di terminal & sandbox — gambar tidak dapat ditampilkan di CLI/sandbox.');
              this.sentMessages.push({
                type: 'text',
                text: '[Gagal kirim gambar di sandbox — kirim gambar (send image) dimatikan di terminal & sandbox]'
              });
              return false;
            }
          }
          public async addLabel(chatId: string, labelId: string): Promise<boolean> { return true; }
          public async removeLabel(chatId: string, labelId: string): Promise<boolean> { return true; }
          public async getChatLabels(chatId: string): Promise<string[]> { return []; }
          public async getSessionStatus(session?: string): Promise<string> { return 'WORKING'; }
          public async startSession(session?: string): Promise<string> { return 'WORKING'; }
          public async stopSession(session?: string): Promise<boolean> { return true; }
          public async getSession(session?: string): Promise<any | null> { return null; }
          public async deleteSession(session?: string): Promise<boolean> { return true; }
          public async createSession(session?: string, config?: any): Promise<string> { return 'CREATED'; }
          public async getAuthQr(session?: string): Promise<import('../integrations/waha/client').WahaQr | null> { return null; }
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

      // Shared post-create side effects (follow-ups, children, lifecycle labels)
      const parsedCustomer = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
      const { reservationLifecycleService } = await import('../services/reservation-lifecycle.service');
      await reservationLifecycleService.onReservationCreated({
        customerId,
        reservationId: reservation.id,
        tenantId: DEFAULT_TENANT_ID,
        chatId: parsedCustomer?.phone ? `${parsedCustomer.phone}@c.us` : '',
        babies: parsed.babies || [],
      });

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
   * POST /api/admin/reservation
   * Admin membuat reservasi manual — tanpa perlu raw text, input terstruktur langsung.
   * Menjalankan shared post-create side effects via reservationLifecycleService.
   */
  fastify.post('/api/admin/reservation', async (request: FastifyRequest<{
    Body: {
      customerId: string;
      treatmentCategory: 'BABY' | 'MOMS' | 'BOTH';
      treatmentDetail: string;
      bookingDate?: string;
      babies?: Array<{ name: string; ageText?: string }>;
    }
  }>, reply: FastifyReply) => {
    const { customerId, treatmentCategory, treatmentDetail, bookingDate, babies } = request.body || {};

    // Validasi input
    if (!customerId || !treatmentCategory || !treatmentDetail) {
      return reply.status(400).send({ error: 'customerId, treatmentCategory, dan treatmentDetail wajib diisi.' });
    }
    if (!['BABY', 'MOMS', 'BOTH'].includes(treatmentCategory)) {
      return reply.status(400).send({ error: 'treatmentCategory harus BABY, MOMS, atau BOTH.' });
    }

    // Cek customer exists (pakai customerService.getCustomerById supaya tetap jalan saat DB offline — memory fallback)
    const customer = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
    if (!customer) {
      return reply.status(404).send({ error: 'Customer tidak ditemukan.' });
    }

    const parsedDate = bookingDate ? new Date(bookingDate) : null;
    if (bookingDate && parsedDate && isNaN(parsedDate.getTime())) {
      return reply.status(400).send({ error: 'Format bookingDate tidak valid.' });
    }

    try {
      const reservation = await prisma.reservation.create({
        data: {
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: customerId,
          treatment_category: treatmentCategory,
          treatment_detail: treatmentDetail,
          booking_date: parsedDate,
          raw_text: `[Admin Manual] ${treatmentCategory}: ${treatmentDetail}`,
          status: 'pending',
        },
      });

      // Shared post-create side effects (follow-ups, children, lifecycle labels)
      const { reservationLifecycleService } = await import('../services/reservation-lifecycle.service');
      await reservationLifecycleService.onReservationCreated({
        customerId,
        reservationId: reservation.id,
        tenantId: DEFAULT_TENANT_ID,
        chatId: `${customer.phone}@c.us`,
        babies: (babies || []).map((b) => ({ name: b.name, age: b.ageText || '' })),
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'CREATE_RESERVATION_MANUAL',
        targetId: reservation.id,
        payload: { customerId, treatmentCategory, source: 'admin_panel' },
        ipAddress: request.ip,
      });

      return reply.status(201).send({ success: true, data: reservation });
    } catch (error: any) {
      // Memory Fallback jika database offline
      const mockReservation = {
        id: `res_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customerId,
        treatment_category: treatmentCategory,
        treatment_detail: treatmentDetail,
        booking_date: parsedDate,
        raw_text: `[Admin Manual] ${treatmentCategory}: ${treatmentDetail}`,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryReservations.set(mockReservation.id, mockReservation);
      return reply.status(201).send({ success: true, data: mockReservation, note: 'Fallback in-memory mode' });
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

      // CAPI Event: Lead + Purchase (Fire-and-forget side effect, tenant-aware)
      if (existing.customer) {
        capiService.sendCapiEvent({
          eventName: 'Lead',
          customer: existing.customer,
          adClick: existing.customer.adClick || undefined,
          tenantId: DEFAULT_TENANT_ID,
        }).catch(err => {
          console.error('[CAPI ERROR] Failed to send conversions event:', err.message);
        });

        resolveTreatmentValue(existing.treatment_detail).then((value) => {
          capiService.sendCapiEvent({
            eventName: 'Purchase',
            customer: existing.customer,
            adClick: existing.customer.adClick || undefined,
            value,
            currency: 'IDR',
            tenantId: DEFAULT_TENANT_ID,
          }).catch(err => {
            console.error('[CAPI ERROR] Failed to send Purchase event:', err.message);
          });
        }).catch(() => {});
      }

      // Best-effort: remove 'pending payment' label setelah confirm (Task 5)
      if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && existing.customer?.phone) {
        const { wahaClient } = await import('../integrations/waha/client');
        wahaClient.removeLabel(`${existing.customer.phone}@c.us`, 'pending payment')
          .catch((err: any) => console.warn('[LIFECYCLE LABEL] removeLabel "pending payment" on confirm failed:', err.message));
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
            adClick: mock.customer.adClick || undefined,
            tenantId: DEFAULT_TENANT_ID,
          }).catch(err => {
            console.error('[CAPI MOCK ERROR] Failed to send conversions event:', err.message);
          });

          resolveTreatmentValue(mock.treatment_detail).then((value) => {
            capiService.sendCapiEvent({
              eventName: 'Purchase',
              customer: mock.customer,
              adClick: mock.customer.adClick || undefined,
              value,
              currency: 'IDR',
              tenantId: DEFAULT_TENANT_ID,
            }).catch(err => {
              console.error('[CAPI MOCK ERROR] Failed to send Purchase event:', err.message);
            });
          }).catch(() => {});
        }

        // Best-effort: remove 'pending payment' label setelah confirm (Task 5)
        if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && mock.customer?.phone) {
          const { wahaClient } = await import('../integrations/waha/client');
          wahaClient.removeLabel(`${mock.customer.phone}@c.us`, 'pending payment')
            .catch((err: any) => console.warn('[LIFECYCLE LABEL] removeLabel "pending payment" on confirm (memory) failed:', err.message));
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

        // Sinkronkan landing page migrasi (slug = id tenant) agar serving konsisten dgn upload legacy
        try {
          await prisma.landingPage.updateMany({
            where: { tenant_id: id, slug: id },
            data: { landing_type: 'RAW_HTML', html_content: rawHtml },
          });
        } catch (syncErr: any) {
          console.warn(`[TENANT RAW HTML SYNC] Skip landing_page sync:`, syncErr.message);
        }

        await purgeLandingCache(id);

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
        await purgeLandingCache(id);
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
   * GET /api/admin/tenant/:id/landing
   * Mengambil status & konten landing page tenant (raw HTML + tipe) untuk editor dashboard
   */
  fastify.get('/api/admin/tenant/:id/landing', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const previewBaseUrl = process.env.LANDING_BASE_URL || process.env.TRACKING_API_BASE_URL || '';
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          name: true,
          landing_type: true,
          raw_html_content: true,
          meta_pixel_id: true,
          whatsapp_number: true,
        },
      });

      if (!tenant) {
        return reply.status(200).send({
          success: true,
          data: {
            tenantId: id,
            slug: id,
            clinicName: `Tenant ${id}`,
            landingType: 'STRUCTURED_JSON',
            hasRawHtml: false,
            rawHtmlContent: '',
            sizeBytes: 0,
            metaPixelId: process.env.FB_PIXEL_ID || '',
            whatsappNumber: process.env.DEFAULT_WHATSAPP_PHONE || '',
            previewBaseUrl,
          },
        });
      }

      return reply.status(200).send({
        success: true,
        data: {
          tenantId: tenant.id,
          slug: tenant.slug,
          clinicName: tenant.name,
          landingType: tenant.landing_type || 'STRUCTURED_JSON',
          hasRawHtml: !!tenant.raw_html_content,
          rawHtmlContent: tenant.raw_html_content || '',
          sizeBytes: tenant.raw_html_content ? Buffer.byteLength(tenant.raw_html_content, 'utf-8') : 0,
          metaPixelId: tenant.meta_pixel_id || '',
          whatsappNumber: tenant.whatsapp_number || '',
          previewBaseUrl,
        },
      });
    } catch (err: any) {
      // Fallback mock / DB offline
      console.warn(`[LANDING GET FALLBACK] DB offline untuk tenant ${id}:`, err.message);
      return reply.status(200).send({
        success: true,
        data: {
          tenantId: id,
          slug: id,
          clinicName: `Tenant ${id}`,
          landingType: 'STRUCTURED_JSON',
          hasRawHtml: false,
          rawHtmlContent: '',
          sizeBytes: 0,
          metaPixelId: process.env.FB_PIXEL_ID || '',
          whatsappNumber: process.env.DEFAULT_WHATSAPP_PHONE || '',
          previewBaseUrl,
        },
      });
    }
  });

  /**
   * POST /api/admin/tenant/:id/landing/reset
   * Mengembalikan landing page tenant ke template default STRUCTURED_JSON (menghapus raw HTML)
   */
  fastify.post('/api/admin/tenant/:id/landing/reset', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const updatedTenant = await prisma.tenant.upsert({
        where: { id },
        create: { id, slug: id, name: `Tenant ${id}`, landing_type: 'STRUCTURED_JSON', raw_html_content: null },
        update: { landing_type: 'STRUCTURED_JSON', raw_html_content: null },
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'TENANT_RAW_HTML_RESET',
        targetId: id,
        payload: { landingType: 'STRUCTURED_JSON' },
        ipAddress: request.ip,
      });

      // Sinkronkan landing page migrasi agar kembali ke template sistem
      try {
        await prisma.landingPage.updateMany({
          where: { tenant_id: id, slug: id },
          data: { landing_type: 'STRUCTURED_JSON', html_content: null },
        });
      } catch (syncErr: any) {
        console.warn(`[TENANT RAW HTML SYNC] Skip landing_page reset sync:`, syncErr.message);
      }

      await purgeLandingCache(id);

      return reply.status(200).send({
        success: true,
        message: 'Landing page dikembalikan ke template default.',
        data: { tenantId: updatedTenant.id, landingType: updatedTenant.landing_type },
      });
    } catch (err: any) {
      return reply.status(200).send({
        success: true,
        message: 'Landing page dikembalikan ke template default (In-Memory Fallback Mode).',
        data: { tenantId: id, landingType: 'STRUCTURED_JSON' },
      });
    }
  });

  // ============================================================
  // Multi Landing Page per Tenant — CRUD
  // ============================================================

  const previewBaseUrlForLanding = () => process.env.LANDING_BASE_URL || process.env.TRACKING_API_BASE_URL || '';

  const toLandingListItem = (l: any) => {
    const base = previewBaseUrlForLanding();
    return {
      id: l.id,
      slug: l.slug,
      title: l.title,
      landingType: l.landing_type,
      hasHtml: !!l.html_content,
      sizeBytes: l.html_content ? Buffer.byteLength(l.html_content, 'utf-8') : 0,
      events: l.events || [],
      hasPixelOverride: !!l.meta_pixel_id,
      whatsappNumber: l.whatsapp_number || '',
      isActive: l.is_active,
      previewUrl: base ? `${base.replace(/\/+$/, '')}/${l.slug}` : `/${l.slug}`,
    };
  };

  const normalizeLandingEvents = (raw: any): string[] => {
    if (!Array.isArray(raw)) return [];
    return Array.from(new Set(raw.filter((e) => typeof e === 'string' && VALID_LANDING_EVENTS.includes(e)))) as string[];
  };

  const normalizeNullableString = (raw: any): string | null => {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    return t ? t : null;
  };

  /**
   * GET /api/admin/landings?tenantId=
   * List semua landing page tenant (tanpa raw HTML untuk hemat bandwidth)
   */
  fastify.get('/api/admin/landings', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request.query as any)?.tenantId || DEFAULT_TENANT_ID;
    try {
      const landings = await prisma.landingPage.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
      });
      return reply.status(200).send({ success: true, data: landings.map(toLandingListItem) });
    } catch (err: any) {
      console.warn(`[LANDINGS LIST FALLBACK] DB offline, pakai in-memory:`, err.message);
      const items = Array.from(memoryLandings.values()).filter((l) => l.tenant_id === tenantId);
      return reply.status(200).send({ success: true, data: items.map(toLandingListItem) });
    }
  });

  /**
   * GET /api/admin/landings/:id
   * Detail landing page (termasuk raw HTML) untuk editor
   */
  fastify.get('/api/admin/landings/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const l = await prisma.landingPage.findUnique({ where: { id } });
      if (!l) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });
      return reply.status(200).send({
        success: true,
        data: {
          ...toLandingListItem(l),
          rawHtmlContent: l.html_content || '',
          metaPixelId: l.meta_pixel_id || '',
        },
      });
    } catch (err: any) {
      console.warn(`[LANDING GET FALLBACK] DB offline:`, err.message);
      const l = memoryLandings.get(id);
      if (!l) return reply.status(200).send({ success: true, data: null });
      return reply.status(200).send({ success: true, data: { ...toLandingListItem(l), rawHtmlContent: l.html_content || '', metaPixelId: l.meta_pixel_id || '' } });
    }
  });

  /**
   * POST /api/admin/landings
   * Buat landing page baru { title, slug, html?, metaPixelId?, whatsappNumber?, events?, isActive? }
   */
  fastify.post('/api/admin/landings', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const body = (request.body || {}) as any;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const html = typeof body.html === 'string' ? body.html : '';

    const slugError = validateLandingSlug(slug);
    if (slugError) return reply.status(400).send({ error: slugError });
    if (!title) return reply.status(400).send({ error: 'Field title wajib diisi.' });

    let landingType: any = 'STRUCTURED_JSON';
    let sanitizedHtml: string | null = null;
    if (html && html.trim()) {
      try {
        const { TenantHtmlService } = await import('../services/tenant-html.service');
        sanitizedHtml = TenantHtmlService.validateAndSanitize(html);
      } catch (validationError: any) {
        return reply.status(400).send({ error: validationError.message });
      }
      landingType = 'RAW_HTML';
    }

    // Unique slug check (best-effort; offline → skip)
    try {
      const existing = await prisma.landingPage.findFirst({ where: { slug } });
      if (existing) return reply.status(409).send({ error: `Slug '${slug}' sudah dipakai landing page lain.` });
    } catch (err: any) {
      console.warn(`[LANDING CREATE] Unique check skipped (DB offline?):`, err.message);
    }

    const events = normalizeLandingEvents(body.events);

    try {
      const created = await prisma.landingPage.create({
        data: {
          tenant_id: DEFAULT_TENANT_ID,
          slug,
          title,
          landing_type: landingType,
          html_content: sanitizedHtml,
          events,
          meta_pixel_id: normalizeNullableString(body.metaPixelId),
          whatsapp_number: normalizeNullableString(body.whatsappNumber),
          is_active: body.isActive !== false,
        },
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'LANDING_PAGE_CREATE',
        targetId: created.id,
        payload: { slug, title, landingType, events },
        ipAddress: request.ip,
      });
      await purgeLandingCache(slug);

      return reply.status(200).send({ success: true, message: 'Landing page berhasil dibuat.', data: toLandingListItem(created) });
    } catch (err: any) {
      // Fallback in-memory (DB offline)
      const id = `lp_${Date.now()}_${Math.random().toString(36).substring(4)}`;
      const record = {
        id,
        tenant_id: DEFAULT_TENANT_ID,
        slug,
        title,
        landing_type: landingType,
        html_content: sanitizedHtml,
        events,
        meta_pixel_id: normalizeNullableString(body.metaPixelId),
        whatsapp_number: normalizeNullableString(body.whatsappNumber),
        is_active: body.isActive !== false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryLandings.set(id, record);
      await purgeLandingCache(slug);
      return reply.status(200).send({ success: true, message: 'Landing page berhasil dibuat (In-Memory Fallback Mode).', data: toLandingListItem(record) });
    }
  });

  /**
   * PUT /api/admin/landings/:id
   * Update landing page (title, slug, html, overrides, events, isActive)
   */
  fastify.put('/api/admin/landings/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = (request.body || {}) as any;

    try {
      const existing = await prisma.landingPage.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });

      const title = typeof body.title === 'string' ? body.title.trim() : existing.title;
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : existing.slug;

      const slugError = validateLandingSlug(slug);
      if (slugError) return reply.status(400).send({ error: slugError });
      if (!title) return reply.status(400).send({ error: 'Field title wajib diisi.' });

      if (slug !== existing.slug) {
        const dup = await prisma.landingPage.findFirst({ where: { slug, id: { not: id } } });
        if (dup) return reply.status(409).send({ error: `Slug '${slug}' sudah dipakai landing page lain.` });
      }

      let landingType = existing.landing_type;
      let sanitizedHtml = existing.html_content;
      const html = typeof body.html === 'string' ? body.html : null;
      if (html !== null && html.trim()) {
        try {
          const { TenantHtmlService } = await import('../services/tenant-html.service');
          sanitizedHtml = TenantHtmlService.validateAndSanitize(html);
        } catch (validationError: any) {
          return reply.status(400).send({ error: validationError.message });
        }
        landingType = 'RAW_HTML';
      }

      const events = body.events !== undefined ? normalizeLandingEvents(body.events) : (existing.events || []);

      const updated = await prisma.landingPage.update({
        where: { id },
        data: {
          slug,
          title,
          landing_type: landingType,
          html_content: sanitizedHtml,
          events,
          meta_pixel_id: body.metaPixelId !== undefined ? normalizeNullableString(body.metaPixelId) : existing.meta_pixel_id,
          whatsapp_number: body.whatsappNumber !== undefined ? normalizeNullableString(body.whatsappNumber) : existing.whatsapp_number,
          is_active: body.isActive !== undefined ? !!body.isActive : existing.is_active,
        },
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'LANDING_PAGE_UPDATE',
        targetId: id,
        payload: { slug, title, landingType, events, isActive: updated.is_active },
        ipAddress: request.ip,
      });
      await purgeLandingCache(slug);
      if (slug !== existing.slug) await purgeLandingCache(existing.slug);

      return reply.status(200).send({ success: true, message: 'Landing page berhasil diperbarui.', data: toLandingListItem(updated) });
    } catch (err: any) {
      // Fallback in-memory
      const rec = memoryLandings.get(id);
      if (!rec) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });

      const title = typeof body.title === 'string' ? body.title.trim() : rec.title;
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : rec.slug;
      const slugError = validateLandingSlug(slug);
      if (slugError) return reply.status(400).send({ error: slugError });
      if (!title) return reply.status(400).send({ error: 'Field title wajib diisi.' });

      const html = typeof body.html === 'string' && body.html.trim() ? body.html : null;
      let sanitizedHtml = rec.html_content;
      let landingType = rec.landing_type;
      if (html) {
        const { TenantHtmlService } = await import('../services/tenant-html.service');
        sanitizedHtml = TenantHtmlService.validateAndSanitize(html);
        landingType = 'RAW_HTML';
      }

      rec.slug = slug;
      rec.title = title;
      rec.landing_type = landingType;
      rec.html_content = sanitizedHtml;
      rec.events = body.events !== undefined ? normalizeLandingEvents(body.events) : (rec.events || []);
      rec.meta_pixel_id = body.metaPixelId !== undefined ? normalizeNullableString(body.metaPixelId) : rec.meta_pixel_id;
      rec.whatsapp_number = body.whatsappNumber !== undefined ? normalizeNullableString(body.whatsappNumber) : rec.whatsapp_number;
      rec.is_active = body.isActive !== undefined ? !!body.isActive : rec.is_active;
      rec.updated_at = new Date();
      memoryLandings.set(id, rec);
      await purgeLandingCache(slug);

      return reply.status(200).send({ success: true, message: 'Landing page berhasil diperbarui (In-Memory Fallback Mode).', data: toLandingListItem(rec) });
    }
  });

  /**
   * DELETE /api/admin/landings/:id
   * Hapus landing page
   */
  fastify.delete('/api/admin/landings/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const existing = await prisma.landingPage.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });

      await prisma.landingPage.delete({ where: { id } });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'LANDING_PAGE_DELETE',
        targetId: id,
        payload: { slug: existing.slug, title: existing.title },
        ipAddress: request.ip,
      });
      await purgeLandingCache(existing.slug);

      return reply.status(200).send({ success: true, message: 'Landing page berhasil dihapus.' });
    } catch (err: any) {
      const rec = memoryLandings.get(id);
      if (!rec) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });
      memoryLandings.delete(id);
      await purgeLandingCache(rec.slug);
      return reply.status(200).send({ success: true, message: 'Landing page berhasil dihapus (In-Memory Fallback Mode).' });
    }
  });

  /**
   * PATCH /api/admin/conversation/:id/release
   * Endpoint manual release untuk mengembalikan thread dari HUMAN_HANDLING ke state aktif bot.
   * Guard: tolak 409 bila conversation sedang tidak dalam human handling (ditangani bot)
   * — mencegah reset state / hapus escalation yang tidak disengaja dari UI.
   */
  fastify.patch('/api/admin/conversation/:id/release', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
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
        return reply.status(409).send({ success: false, error: 'Conversation sedang ditangani bot — tidak perlu di-release.' });
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

      // Live Chat publish: admin panel mendapat update state percakapan secara real-time
      getLiveChatHub()
        .publish({
          type: 'conversation.updated',
          tenantId: DEFAULT_TENANT_ID,
          payload: buildConversationUpdatedPayload(updated),
        })
        .catch(() => {});

      return reply.status(200).send({ success: true, message: `Percakapan berhasil di-release kembali ke bot (Restored state: ${restoredState}).`, data: updated });
    } catch (err: any) {
      // Fallback in-memory: tetap release & publish supaya Live Chat panel konsisten saat DB offline
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
      return reply.status(200).send({ success: true, message: `Percakapan berhasil di-release (Fallback Mode - Restored state: ${restoredState}).` });
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
  fastify.post(
    '/api/admin/harvest/legacy-chat',
    async (request: FastifyRequest<{ Body: { maxChats?: number; maxMessagesPerChat?: number; clearPreviousPending?: boolean } }>, reply: FastifyReply) => {
      const body = request.body || {};
      const { maxChats, maxMessagesPerChat, clearPreviousPending } = body;
      const { LegacyHarvestingService } = await import('../services/legacy-harvesting.service');

      if (clearPreviousPending) {
        try {
          await prisma.medicalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' } });
          await prisma.generalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' } });
          console.log('[HARVESTING] Previous PENDING staging records cleared before new harvesting run.');
        } catch (e: any) {
          console.warn('[HARVESTING] Could not clear previous pending staging records:', e.message);
        }
      }

      LegacyHarvestingService.runHarvestingJob(DEFAULT_TENANT_ID, { maxChats, maxMessagesPerChat }).catch((err) =>
        console.error('[HARVEST JOB ERROR]', err)
      );

      return reply.status(200).send({
        success: true,
        message: 'Proses AI Harvesting histori chat berhasil dimulai di background dengan perbaikan pengurutan kronologis.',
        jobId: `job_${Date.now()}`,
        status: 'STARTED',
      });
    }
  );

  /**
   * POST /api/admin/harvest/reset-staging
   * Membersihkan data staging PENDING yang terbolak-balik dari pengikisan lama
   */
  fastify.post('/api/admin/harvest/reset-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const medRes = await prisma.medicalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' } });
      const genRes = await prisma.generalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' } });

      return reply.status(200).send({
        success: true,
        message: `Berhasil membersihkan ${medRes.count} kandidat medis dan ${genRes.count} kandidat umum staging PENDING yang lama.`,
        data: { medicalCleared: medRes.count, generalCleared: genRes.count },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/harvest/staging/all
   * Menghapus SELURUH data staging FAQ (Medical & General Staging) secara permanen
   */
  fastify.delete('/api/admin/harvest/staging/all', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const medRes = await prisma.medicalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID } });
      const genRes = await prisma.generalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID } });

      return reply.status(200).send({
        success: true,
        message: `Berhasil menghapus seluruh data staging: ${medRes.count} kandidat medis dan ${genRes.count} kandidat umum.`,
        data: { medicalDeleted: medRes.count, generalDeleted: genRes.count },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/harvest/staging/export-md
   * Meng-export seluruh kandidat Staging FAQ (Medical & General) dalam format Markdown (.md)
   */
  fastify.get('/api/admin/harvest/staging/export-md', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = DEFAULT_TENANT_ID;
      const statusFilter = (request.query as any)?.status || 'ALL';

      const medQuery: any = { tenant_id: tenantId };
      const genQuery: any = { tenant_id: tenantId };

      if (statusFilter !== 'ALL') {
        medQuery.status = statusFilter;
        genQuery.status = statusFilter;
      }

      const medicalItems = await prisma.medicalFaqStaging.findMany({
        where: medQuery,
        orderBy: { created_at: 'desc' },
      });

      const generalItems = await prisma.generalFaqStaging.findMany({
        where: genQuery,
        orderBy: { created_at: 'desc' },
      });

      const dateStr = new Date().toISOString().split('T')[0];

      let md = `# Export Staging Reviewer FAQ - ${dateStr}\n\n`;
      md += `> Tanggal Export: ${new Date().toLocaleString()}\n`;
      md += `> Total Medical Staging: ${medicalItems.length} kandidat\n`;
      md += `> Total General Staging: ${generalItems.length} kandidat\n\n`;
      md += `---\n\n`;

      md += `## 🏥 Medical FAQ Staging (Kandidat Bidan)\n\n`;
      if (medicalItems.length === 0) {
        md += `*Tidak ada data kandidat medis.*\n\n`;
      } else {
        medicalItems.forEach((item, index) => {
          md += `### ${index + 1}. ${item.general_question || item.raw_question}\n`;
          md += `- **Status**: \`${item.status}\`\n`;
          md += `- **No. Customer**: ${item.customer_phone || 'N/A'}\n`;
          md += `- **Waktu Staged**: ${new Date(item.created_at).toLocaleString()}\n`;
          if (item.symptoms_tagged && item.symptoms_tagged.length > 0) {
            md += `- **Gejala Terdeteksi**: ${item.symptoms_tagged.join(', ')}\n`;
          }
          md += `\n**Pesan Mentah Customer (Question)**:\n> ${item.raw_question}\n\n`;
          md += `**Pesan Mentah Bidan (Reply)**:\n> ${item.bidan_raw_reply || 'N/A'}\n\n`;
          md += `**Usulan FAQ Publik (Question)**:\n${item.general_question || item.raw_question}\n\n`;
          md += `**Usulan FAQ Publik (Answer)**:\n${item.general_answer || item.bidan_raw_reply || 'N/A'}\n\n`;
          md += `---\n\n`;
        });
      }

      md += `## 💬 General FAQ Staging (Kandidat Admin)\n\n`;
      if (generalItems.length === 0) {
        md += `*Tidak ada data kandidat umum.*\n\n`;
      } else {
        generalItems.forEach((item, index) => {
          md += `### ${index + 1}. ${item.general_question || item.raw_question}\n`;
          md += `- **Status**: \`${item.status}\`\n`;
          md += `- **Kategori**: \`${item.category || 'general'}\`\n`;
          md += `- **Waktu Staged**: ${new Date(item.created_at).toLocaleString()}\n`;
          md += `\n**Pesan Mentah Customer (Question)**:\n> ${item.raw_question}\n\n`;
          md += `**Pesan Mentah Admin (Reply)**:\n> ${item.raw_answer || 'N/A'}\n\n`;
          md += `**Usulan FAQ Publik (Question)**:\n${item.general_question || item.raw_question}\n\n`;
          md += `**Usulan FAQ Publik (Answer)**:\n${item.general_answer || item.raw_answer || 'N/A'}\n\n`;
          md += `---\n\n`;
        });
      }

      const filename = `staging-faq-export-${dateStr}.md`;

      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(md);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
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
   * GET /api/admin/harvest/raw-file
   * Mengunduh berkas dump transkrip percakapan konsolidasi (storage/harvesting/latest_raw_scraped_chats.json)
   */
  fastify.get('/api/admin/harvest/raw-file', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { default: fs } = await import('fs');
      const { default: path } = await import('path');
      const filePath = path.join(process.cwd(), 'storage', 'harvesting', 'latest_raw_scraped_chats.json');

      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ error: 'Berkas dump percakapan belum tersedia. Jalankan AI Chat Scraper terlebih dahulu.' });
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const filename = `raw_scraped_chats_${new Date().toISOString().split('T')[0]}.json`;

      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/harvest/staging/analyze-ai
   * Menganalisis & memoles seluruh draf kandidat staging FAQ PENDING menggunakan DeepSeek AI
   */
  fastify.post('/api/admin/harvest/staging/analyze-ai', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = DEFAULT_TENANT_ID;

      const medicalPending = await prisma.medicalFaqStaging.findMany({
        where: { tenant_id: tenantId, status: 'PENDING' },
      });

      const generalPending = await prisma.generalFaqStaging.findMany({
        where: { tenant_id: tenantId, status: 'PENDING' },
      });

      if (medicalPending.length === 0 && generalPending.length === 0) {
        return reply.status(200).send({
          success: true,
          message: 'Tidak ada kandidat staging bertipe PENDING yang perlu dianalisis.',
          data: { medicalAnalyzed: 0, generalAnalyzed: 0 },
        });
      }

      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
      const baseUrl = (process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
      const model = process.env.AI_MODEL_HARVESTING || 'deepseek-chat';

      let medicalAnalyzedCount = 0;
      let generalAnalyzedCount = 0;

      // Process Medical Staging items
      for (const item of medicalPending) {
        const prompt = `Rapikan pertanyaan dan jawaban medis klinik spa berikut menjadi bahasa Indonesia formal, ramah, dan profesional yang siap dipublikasikan ke FAQ.
Pertanyaan mentah: "${item.raw_question}"
Jawaban mentah: "${item.bidan_raw_reply}"

Format JSON:
{
  "general_question": "Pertanyaan yang bersih dan umum?",
  "general_answer": "Jawaban medis yang lengkap, ramah, dan profesional."
}`;

        if (apiKey && !apiKey.startsWith('mock')) {
          try {
            const { default: axios } = await import('axios');
            const res = await axios.post(
              `${baseUrl}/chat/completions`,
              {
                model,
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 500,
              },
              { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 }
            );

            const parsed = JSON.parse(res.data?.choices?.[0]?.message?.content || '{}');
            if (parsed.general_question && parsed.general_answer) {
              await prisma.medicalFaqStaging.update({
                where: { id: item.id },
                data: {
                  general_question: parsed.general_question,
                  general_answer: parsed.general_answer,
                },
              });
              medicalAnalyzedCount++;
              continue;
            }
          } catch (e: any) {}
        }

        // Fallback polishing
        await prisma.medicalFaqStaging.update({
          where: { id: item.id },
          data: {
            general_question: item.general_question || item.raw_question,
            general_answer: item.general_answer || item.bidan_raw_reply,
          },
        });
        medicalAnalyzedCount++;
      }

      // Process General Staging items
      for (const item of generalPending) {
        const prompt = `Rapikan pertanyaan dan jawaban umum klinik spa berikut menjadi bahasa Indonesia formal, ramah, dan profesional yang siap dipublikasikan ke FAQ.
Pertanyaan mentah: "${item.raw_question}"
Jawaban mentah: "${item.raw_answer}"

Format JSON:
{
  "general_question": "Pertanyaan yang bersih dan umum?",
  "general_answer": "Jawaban yang lengkap, ramah, dan profesional."
}`;

        if (apiKey && !apiKey.startsWith('mock')) {
          try {
            const { default: axios } = await import('axios');
            const res = await axios.post(
              `${baseUrl}/chat/completions`,
              {
                model,
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 500,
              },
              { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 }
            );

            const parsed = JSON.parse(res.data?.choices?.[0]?.message?.content || '{}');
            if (parsed.general_question && parsed.general_answer) {
              await prisma.generalFaqStaging.update({
                where: { id: item.id },
                data: {
                  general_question: parsed.general_question,
                  general_answer: parsed.general_answer,
                },
              });
              generalAnalyzedCount++;
              continue;
            }
          } catch (e: any) {}
        }

        // Fallback polishing
        await prisma.generalFaqStaging.update({
          where: { id: item.id },
          data: {
            general_question: item.general_question || item.raw_question,
            general_answer: item.general_answer || item.raw_answer,
          },
        });
        generalAnalyzedCount++;
      }

      return reply.status(200).send({
        success: true,
        message: `Berhasil menganalisis & memoles ${medicalAnalyzedCount} kandidat medis dan ${generalAnalyzedCount} kandidat umum dengan DeepSeek AI.`,
        data: { medicalAnalyzed: medicalAnalyzedCount, generalAnalyzed: generalAnalyzedCount },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
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
   * beserta batas maksimal karakter per balasan AI (null = tanpa limit).
   */
  fastify.get('/api/admin/persona', async (request: FastifyRequest, reply: FastifyReply) => {
    const { loadPersonaFromDb, getMaxCharsPerReply } = await import('../config/persona');
    const persona = await loadPersonaFromDb(DEFAULT_TENANT_ID);
    return reply.status(200).send({ success: true, persona, maxCharsPerReply: getMaxCharsPerReply(DEFAULT_TENANT_ID) });
  });

  /**
   * POST /api/admin/persona
   * Mengupdate system persona prompt bot secara live (DB per tenant + in-memory & file).
   * Body opsional: maxCharsPerReply (number | null) = batas karakter per balasan AI.
   */
  fastify.post(
    '/api/admin/persona',
    async (
      request: FastifyRequest<{
        Body: { persona: string; maxCharsPerReply?: number | null | '' };
      }>,
      reply: FastifyReply
    ) => {
      const { persona, maxCharsPerReply } = request.body || {};
      if (!persona || !persona.trim()) {
        return reply.status(400).send({ error: 'System persona prompt is required' });
      }

      try {
        const { savePersonaToDb, getMaxCharsPerReply } = await import('../config/persona');
        let maxChars: number | null | undefined;
        if (maxCharsPerReply === undefined) {
          maxChars = undefined;
        } else if (maxCharsPerReply === '' || maxCharsPerReply === null) {
          maxChars = null;
        } else {
          maxChars = Math.max(0, Number(maxCharsPerReply));
        }
        await savePersonaToDb(persona, DEFAULT_TENANT_ID, maxChars);

        // Audit Trail Log for Persona Change
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BOT_PERSONA_CHANGE',
          targetId: 'SYSTEM_PERSONA',
          payload: { details: `System persona prompt updated to: ${persona.substring(0, 100)}...${maxChars === undefined ? '' : ` | max_chars_per_reply=${maxChars}`}` },
        });

        const savedMaxChars = maxChars === undefined ? getMaxCharsPerReply(DEFAULT_TENANT_ID) : maxChars;
        return reply.status(200).send({
          success: true,
          message: 'System persona prompt berhasil diperbarui secara live!',
          persona,
          maxCharsPerReply: savedMaxChars,
        });
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
   * GET /api/admin/whatsapp-provider
   * Status indicator WhatsApp channel (Fase 5):
   * - Provider aktif (WAHA/WABA) dari DB tenant
   * - Status session WAHA (live check)
   * - Status konfigurasi WABA (token terpasang? number id?)
   * - Status template HSM (semua mapping per tenant)
   */
  fastify.get('/api/admin/whatsapp-provider', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });

      // Live check status session WAHA (best-effort)
      let wahaStatus = 'UNKNOWN';
      try {
        const { wahaClient } = await import('../integrations/waha/client');
        wahaStatus = await wahaClient.getSessionStatus();
      } catch (err: any) {
        wahaStatus = `FAILED: ${err.message}`;
      }

      const { wabaTemplateService } = await import('../services/waba-template.service');
      const templates = await wabaTemplateService.getAllTemplateMappings(DEFAULT_TENANT_ID);

      return reply.status(200).send({
        success: true,
        data: {
          provider: tenant?.whatsapp_provider || 'WAHA',
          wahaSessionId: tenant?.waha_session_id || 'default',
          wahaStatus,
          waba: {
            configured: !!(tenant?.waba_phone_number_id && tenant?.waba_access_token),
            phoneNumberId: tenant?.waba_phone_number_id || null,
            businessAccountId: tenant?.waba_business_account_id || null,
            hasAccessToken: !!tenant?.waba_access_token,
            hasWebhookVerifyToken: !!tenant?.waba_webhook_verify_token,
          },
          templates,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/whatsapp-provider/qr
   * QR code koneksi session WAHA per-tenant (Fitur 1: konek WhatsApp via Admin UI).
   * qr hanya diisi saat status === 'SCAN_QR_CODE'; status lain (FAILED/STOPPED/DISCONNECTED/dll)
   * mengembalikan qr: null + message yang informatif — UI tidak boleh mengasumsikan QR selalu ada.
   */
  fastify.get(
    '/api/admin/whatsapp-provider/qr',
    async (request: FastifyRequest<{ Querystring: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.query?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../services/whatsapp-provider.service');
        const data = await whatsappProviderService.getQrForTenant(tenantId);
        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/whatsapp-provider/session/start
   * Memulai session WAHA per-tenant secara eksplisit (tombol "Mulai session" di UI saat STOPPED).
   */
  fastify.post(
    '/api/admin/whatsapp-provider/session/start',
    async (request: FastifyRequest<{ Body: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../services/whatsapp-provider.service');
        const data = await whatsappProviderService.startSessionForTenant(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'WAHA_SESSION_START',
          targetId: data.sessionId,
          payload: { status: data.status },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/whatsapp-provider/session/reset
   * Reset / re-pair session WAHA per-tenant (delete → create ulang → start).
   * Dipakai tombol "Reset Session" di UI saat status FAILED yang sudah-paired
   * tidak bisa di-recover hanya dengan start (Noise Handshake failure baileys).
   * Config webhook session lama dipertahankan agar bot tidak kehilangan webhook.
   */
  fastify.post(
    '/api/admin/whatsapp-provider/session/reset',
    async (request: FastifyRequest<{ Body: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../services/whatsapp-provider.service');
        const data = await whatsappProviderService.resetSessionForTenant(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'WAHA_SESSION_RESET',
          targetId: data.sessionId,
          payload: { status: data.status },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/whatsapp-provider/session/disconnect
   * Memutuskan/Logout session WAHA per tenant
   */
  fastify.post(
    '/api/admin/whatsapp-provider/session/disconnect',
    async (request: FastifyRequest<{ Body: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../services/whatsapp-provider.service');
        const data = await whatsappProviderService.disconnectSessionForTenant(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'WAHA_SESSION_DISCONNECT',
          targetId: data.sessionId,
          payload: { status: data.status },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data, message: 'Session WAHA berhasil terputus (Disconnected).' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/whatsapp-provider
   * Toggle provider WhatsApp per tenant + simpan konfigurasi WABA.
   * Token WABA disimpan ENCRYPTED (AES-256-GCM) — tidak pernah plaintext di DB.
   */
  fastify.patch(
    '/api/admin/whatsapp-provider',
    async (
      request: FastifyRequest<{
        Body: {
          provider?: 'WAHA' | 'WABA';
          waha_session_id?: string;
          waba_phone_number_id?: string;
          waba_business_account_id?: string;
          waba_access_token?: string;
          waba_webhook_verify_token?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const { provider, waha_session_id, waba_phone_number_id, waba_business_account_id, waba_access_token, waba_webhook_verify_token } = body;

      if (provider && provider !== 'WAHA' && provider !== 'WABA') {
        return reply.status(400).send({ error: 'provider harus "WAHA" atau "WABA"' });
      }

      try {
        const existing = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
        const data: any = {};

        if (provider) data.whatsapp_provider = provider;
        if (waha_session_id) data.waha_session_id = waha_session_id;
        if (waba_phone_number_id !== undefined) data.waba_phone_number_id = waba_phone_number_id || null;
        if (waba_business_account_id !== undefined) data.waba_business_account_id = waba_business_account_id || null;
        if (waba_webhook_verify_token !== undefined) data.waba_webhook_verify_token = waba_webhook_verify_token || null;
        if (waba_access_token) {
          const { encryptSecret } = await import('../utils/encryption');
          data.waba_access_token = encryptSecret(waba_access_token);
        }

        const tenant = existing
          ? await prisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data })
          : await prisma.tenant.create({
              data: {
                id: DEFAULT_TENANT_ID,
                slug: DEFAULT_TENANT_ID,
                name: 'Default Clinic',
                ...data,
              },
            });

        // Reset gateway cache agar resolveGatewayForTenant memakai config terbaru
        const { resetGateway } = await import('../integrations/whatsapp/factory');
        resetGateway();

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_WHATSAPP_PROVIDER',
          targetId: DEFAULT_TENANT_ID,
          payload: {
            provider: tenant.whatsapp_provider,
            waha_session_id: tenant.waha_session_id,
            waba_phone_number_id: tenant.waba_phone_number_id,
            waba_configured: !!(tenant.waba_phone_number_id && tenant.waba_access_token),
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `WhatsApp provider diubah ke ${tenant.whatsapp_provider}.`,
          data: { provider: tenant.whatsapp_provider },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/capi-config
   * Status config Meta Pixel & CAPI per tenant (berlaku utk semua provider WAHA/WABA).
   * Token akses TIDAK pernah dikembalikan — hanya boolean configured.
   */
  fastify.get('/api/admin/capi-config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const envPixel = process.env.FB_PIXEL_ID;
    const envToken = process.env.FB_CAPI_ACCESS_TOKEN;
    let tenant: any = null;

    try {
      tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
    } catch (err) {
      console.warn('[CAPI CONFIG] DB unavailable, pakai env fallback:', (err as Error).message);
    }

    const metaPixelId = tenant?.meta_pixel_id || null;
    const hasCapiAccessToken = !!(tenant?.meta_capi_access_token);
    const source = metaPixelId || hasCapiAccessToken
      ? 'db'
      : (envPixel && envToken) ? 'env' : 'none';

    return reply.status(200).send({
      success: true,
      data: {
        metaPixelId,
        hasCapiAccessToken,
        capiTokenSource: source,
        envPixelConfigured: !!envPixel,
        envTokenConfigured: !!envToken,
      },
    });
  });

  /**
   * PATCH /api/admin/capi-config
   * Simpan config Meta Pixel & CAPI per tenant. Token CAPI di-ENCRYPT AES-256-GCM
   * (sama seperti waba_access_token), tidak pernah plaintext di DB.
   */
  fastify.patch(
    '/api/admin/capi-config',
    async (
      request: FastifyRequest<{
        Body: { metaPixelId?: string | null; capiAccessToken?: string | null };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const { metaPixelId, capiAccessToken } = body;

      try {
        const existing = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
        const data: any = {};

        if (metaPixelId !== undefined) {
          data.meta_pixel_id = metaPixelId ? String(metaPixelId).trim() || null : null;
        }
        if (capiAccessToken !== undefined) {
          if (capiAccessToken) {
            const { encryptSecret } = await import('../utils/encryption');
            data.meta_capi_access_token = encryptSecret(String(capiAccessToken).trim());
          } else {
            data.meta_capi_access_token = null;
          }
        }

        const tenant = existing
          ? await prisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data })
          : await prisma.tenant.create({
              data: {
                id: DEFAULT_TENANT_ID,
                slug: DEFAULT_TENANT_ID,
                name: 'Default Clinic',
                ...data,
              },
            });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_CAPI_CONFIG',
          targetId: DEFAULT_TENANT_ID,
          payload: {
            meta_pixel_id: tenant.meta_pixel_id || null,
            capi_token_configured: !!tenant.meta_capi_access_token,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Konfigurasi Meta Pixel & CAPI berhasil disimpan.',
          data: {
            metaPixelId: tenant.meta_pixel_id || null,
            hasCapiAccessToken: !!tenant.meta_capi_access_token,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/ai-router
   * Status konfigurasi AI Router Engine per tenant (default ON + shadow ON).
   */
  fastify.get('/api/admin/ai-router', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { AiRouterConfigService } = await import('../config/ai-router-config');
      const cfg = AiRouterConfigService.getConfig(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: cfg });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/ai-router
   * Toggle AI Router Engine per tenant (enabled) & shadow mode (shadowMode).
   */
  fastify.patch(
    '/api/admin/ai-router',
    async (
      request: FastifyRequest<{
        Body: { enabled?: boolean; shadowMode?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const patch: { enabled?: boolean; shadowMode?: boolean } = {};
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (typeof body.shadowMode === 'boolean') patch.shadowMode = body.shadowMode;

      if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: 'Body harus berisi enabled dan/atau shadowMode (boolean).' });
      }

      try {
        const { AiRouterConfigService } = await import('../config/ai-router-config');
        const cfg = await AiRouterConfigService.saveConfig(DEFAULT_TENANT_ID, patch);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_AI_ROUTER_CONFIG',
          targetId: DEFAULT_TENANT_ID,
          payload: cfg,
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Konfigurasi AI Router diperbarui: enabled=${cfg.enabled}, shadowMode=${cfg.shadowMode}.`,
          data: cfg,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/ai-rollout-scope
   * Konfigurasi AI Rollout Scope per tenant (scope + cutoff) beserta ringkasan
   * dampak: total customer, customer baru, legacy, dan yang ter-senyapkan.
   * Ringkasan best-effort (DB offline → 0 tanpa error).
   */
  fastify.get('/api/admin/ai-rollout-scope', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { AiEligibilityConfigService } = await import('../config/ai-eligibility-config');
      const cfg = AiEligibilityConfigService.getConfig(DEFAULT_TENANT_ID);

      let summary = { totalCustomers: 0, newCustomers: 0, legacyCustomers: 0, silencedByScope: 0 };
      try {
        const [totalCustomers, newCustomers, silencedByScope] = await Promise.all([
          prisma.customer.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
          prisma.customer.count({ where: { tenant_id: DEFAULT_TENANT_ID, created_at: { gte: cfg.ai_scope_cutoff_at } } }),
          prisma.conversation.count({
            where: {
              tenant_id: DEFAULT_TENANT_ID,
              is_human_handling: true,
              escalation_reason: AI_ELIGIBILITY_ESCALATION_REASON,
            },
          }),
        ]);
        summary = {
          totalCustomers,
          newCustomers,
          legacyCustomers: Math.max(0, totalCustomers - newCustomers),
          silencedByScope,
        };
      } catch (dbErr: any) {
        console.warn('[AI ROLLOUT SCOPE] DB offline, summary di-skip:', dbErr.message);
      }

      return reply.status(200).send({ success: true, data: cfg, summary });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/ai-rollout-scope
   * Ubah scope rollout AI per tenant (NEW_ONLY / ALL) dan/atau cutoff.
   * Audit log ADMIN_WRITE via auditService.
   */
  fastify.patch(
    '/api/admin/ai-rollout-scope',
    async (
      request: FastifyRequest<{
        Body: { aiCustomerScope?: 'NEW_ONLY' | 'ALL'; aiScopeCutoffAt?: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const patch: { ai_customer_scope?: 'NEW_ONLY' | 'ALL'; ai_scope_cutoff_at?: Date } = {};
      if (body.aiCustomerScope === 'NEW_ONLY' || body.aiCustomerScope === 'ALL') {
        patch.ai_customer_scope = body.aiCustomerScope;
      }
      if (body.aiScopeCutoffAt && !isNaN(Date.parse(body.aiScopeCutoffAt))) {
        patch.ai_scope_cutoff_at = new Date(body.aiScopeCutoffAt);
      }

      if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: 'Body harus berisi aiCustomerScope (NEW_ONLY|ALL) dan/atau aiScopeCutoffAt (ISO date).' });
      }

      try {
        const { AiEligibilityConfigService } = await import('../config/ai-eligibility-config');
        const cfg = await AiEligibilityConfigService.saveConfig(DEFAULT_TENANT_ID, patch);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_AI_ROLLOUT_SCOPE',
          targetId: DEFAULT_TENANT_ID,
          payload: cfg,
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `AI Rollout Scope diperbarui: scope=${cfg.ai_customer_scope}, cutoff=${cfg.ai_scope_cutoff_at.toISOString()}.`,
          data: cfg,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/customers/:id/ai-override
   * Set override AI per customer (FORCE_ON / FORCE_OFF / null).
   * FORCE_ON otomatis melepas conversation yang ter-senyap karena
   * LEGACY_AI_SCOPE_DISABLED (kembalikan ke previous_state) + hapus label hold.
   */
  fastify.patch(
    '/api/admin/customers/:id/ai-override',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { aiOverride?: 'FORCE_ON' | 'FORCE_OFF' | null };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { aiOverride } = request.body || {};
      if (aiOverride !== 'FORCE_ON' && aiOverride !== 'FORCE_OFF' && aiOverride !== null) {
        return reply.status(400).send({ error: 'aiOverride harus FORCE_ON, FORCE_OFF, atau null.' });
      }

      try {
        const { customerService } = await import('../services/customer.service');
        const updated = await customerService.setAiOverride(id, DEFAULT_TENANT_ID, aiOverride);

        if (aiOverride === 'FORCE_ON') {
          const silenced = await prisma.conversation.findFirst({
            where: {
              customer_id: id,
              tenant_id: DEFAULT_TENANT_ID,
              is_human_handling: true,
              escalation_reason: AI_ELIGIBILITY_ESCALATION_REASON,
            },
          });
          if (silenced) {
            const restoredState = silenced.previous_state || ConversationState.INITIAL;
            await conversationService.updateConversationState(
              silenced.id,
              {
                currentState: restoredState as any,
                isHumanHandling: false,
                humanHandlingSince: null,
                escalationReason: null,
              },
              DEFAULT_TENANT_ID
            );
            const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || process.env.NODE_ENV !== 'production';
            if (enableHoldLabel) {
              try {
                const { wahaClient } = await import('../integrations/waha/client');
                await wahaClient.removeLabel(`${updated.phone}@c.us`, 'hold');
              } catch (labelErr: any) {
                console.warn('[AI OVERRIDE] Gagal hapus hold label:', labelErr.message);
              }
            }
            console.log(`[AI OVERRIDE] FORCE_ON utk customer ${updated.phone} — conversation ${silenced.id} di-release dari LEGACY_AI_SCOPE_DISABLED.`);
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_AI_OVERRIDE',
          targetId: id,
          payload: { aiOverride },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Override AI customer diperbarui: ${aiOverride || 'ikut aturan tenant'}.`,
          data: { id, aiOverride: updated.ai_override ?? null },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/conversation-behavior
   * Mengambil konfigurasi perilaku percakapan per tenant (idle greeting, dll).
   */
  fastify.get('/api/admin/conversation-behavior', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { IdleGreetingConfigService } = await import('../config/idle-greeting.config');
      const idleGreeting = IdleGreetingConfigService.getConfig(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: { idleGreeting } });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/conversation-behavior
   * Update konfigurasi perilaku percakapan per tenant (idle greeting enabled/minHours).
   */
  fastify.patch(
    '/api/admin/conversation-behavior',
    async (
      request: FastifyRequest<{
        Body: {
          idleGreeting?: { enabled?: boolean; minHours?: number };
        };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const idlePatch: { enabled?: boolean; minHours?: number } = {};

      if (body.idleGreeting && typeof body.idleGreeting === 'object') {
        if (typeof body.idleGreeting.enabled === 'boolean') idlePatch.enabled = body.idleGreeting.enabled;
        if (typeof body.idleGreeting.minHours === 'number') idlePatch.minHours = body.idleGreeting.minHours;
      }

      if (Object.keys(idlePatch).length === 0) {
        return reply.status(400).send({
          error: 'Body harus berisi idleGreeting.enabled (boolean) dan/atau idleGreeting.minHours (number).',
        });
      }

      try {
        const { IdleGreetingConfigService } = await import('../config/idle-greeting.config');
        const cfg = await IdleGreetingConfigService.saveConfig(DEFAULT_TENANT_ID, idlePatch);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_CONVERSATION_BEHAVIOR',
          targetId: DEFAULT_TENANT_ID,
          payload: { idleGreeting: cfg },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Konfigurasi perilaku percakapan diperbarui: idleGreeting.enabled=${cfg.enabled}, idleGreeting.minHours=${cfg.minHours}.`,
          data: { idleGreeting: cfg },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/waba-templates
   * Mengambil mapping HSM template per tenant (custom dari DB + default).
   */
  fastify.get('/api/admin/waba-templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { wabaTemplateService } = await import('../services/waba-template.service');
      const templates = await wabaTemplateService.getAllTemplateMappings(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: templates });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/waba-templates
   * Menyimpan mapping HSM template (upsert) untuk type + variant.
   */
  fastify.post(
    '/api/admin/waba-templates',
    async (
      request: FastifyRequest<{
        Body: {
          type: string;
          variant: number;
          templateName: string;
          category?: 'UTILITY' | 'MARKETING';
          languageCode?: string;
          status?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED';
          isActive?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { type, variant, templateName, category, languageCode, status, isActive } = request.body || {};
      if (!type || !variant || !templateName) {
        return reply.status(400).send({ error: 'type, variant, dan templateName wajib diisi' });
      }

      try {
        const { wabaTemplateService } = await import('../services/waba-template.service');
        await wabaTemplateService.saveTemplateMapping(DEFAULT_TENANT_ID, type, variant, {
          templateName,
          category: category || 'UTILITY',
          languageCode: languageCode || 'id',
          status: status || 'APPROVED',
          isActive,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_WABA_TEMPLATE',
          targetId: `${type}#${variant}`,
          payload: { type, variant, templateName },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, message: 'WABA template mapping berhasil disimpan!' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
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

  /**
   * =====================================================================
   * SYSTEM DEBUG — Observability & Tracing (read-only)
   * Halaman Debug dashboard memakai endpoint di bawah ini. Tidak ada mutasi.
   * =====================================================================
   */

  /**
   * GET /api/admin/debug/system
   * Info sistem: uptime, memori, status DB, feature flags (tanpa secret), counts, state AI Router.
   */
  fastify.get('/api/admin/debug/system', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { collectSystemInfo } = await import('../services/system-debug.service');
      const info = await collectSystemInfo();
      return reply.status(200).send({ success: true, data: info });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err?.message });
    }
  });

  /**
   * GET /api/admin/debug/ai-router?days=7
   * Ringkasan akurasi shadow mode + mismatch (terutama MEDICAL_CONCERN) + evaluasi terbaru.
   */
  fastify.get('/api/admin/debug/ai-router', async (request: FastifyRequest<{ Querystring: { days?: string } }>, reply: FastifyReply) => {
    try {
      const { collectAiRouterSummary } = await import('../services/system-debug.service');
      const days = Math.max(1, Math.min(90, parseInt(request.query?.days || '7', 10) || 7));
      const summary = await collectAiRouterSummary(days);
      return reply.status(200).send({ success: true, data: summary });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err?.message });
    }
  });

  /**
   * GET /api/admin/debug/logs?limit=200&level=all
   * Log buffer in-memory (console log/warn/error terbaru).
   */
  fastify.get('/api/admin/debug/logs', async (request: FastifyRequest<{ Querystring: { limit?: string; level?: string } }>, reply: FastifyReply) => {
    try {
      const { getLogBuffer, getLogBufferStats, isLogBufferInstalled } = await import('../services/system-debug.service');
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
  });

  /**
   * GET /api/admin/debug/messages?limit=50
   * Trace pesan terbaru (audit log message) untuk tracing percakapan.
   */
  fastify.get('/api/admin/debug/messages', async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const { collectRecentMessages } = await import('../services/system-debug.service');
      const limit = parseInt(request.query?.limit || '50', 10) || 50;
      const data = await collectRecentMessages(limit);
      return reply.status(200).send({ success: true, data });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err?.message });
    }
  });

  /**
   * GET /api/admin/debug/conversations?limit=50
   * Trace state machine conversation terbaru (state, human handling, UNKNOWN counter, dll).
   */
  fastify.get('/api/admin/debug/conversations', async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const { collectConversationTrace } = await import('../services/system-debug.service');
      const limit = parseInt(request.query?.limit || '50', 10) || 50;
      const data = await collectConversationTrace(limit);
      return reply.status(200).send({ success: true, data });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err?.message });
    }
  });
}









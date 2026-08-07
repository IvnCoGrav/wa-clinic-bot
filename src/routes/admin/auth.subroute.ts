import { FastifyInstance } from 'fastify';
import { safeCompare } from '../../utils/auth';
import { getAdminEmail, loginAttemptsMap } from './stores';

export async function authAdminRoutes(fastify: FastifyInstance) {
  const { AdminSessionService } = await import('../../services/admin-session.service');

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
      return reply.status(429).send({
        error:
          'Too Many Requests: Batas percobaan login terlampaui (maks 5x per menit). Silakan tunggu 1 menit.',
      });
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

    const isSecureRequest =
      request.protocol === 'https' ||
      String(request.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim() === 'https';
    const cookieValue = `admin_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${
      isSecureRequest ? '; Secure' : ''
    }`;
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
}

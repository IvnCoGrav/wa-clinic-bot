import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { safeCompare } from '../utils/auth';

// Re-export stores and helpers for backwards compatibility with tests and external modules
export {
  memoryReservations,
  memoryLandings,
  validateLandingSlug,
  VALID_LANDING_EVENTS,
  purgeLandingCache,
  getAdminDomain,
  getAdminEmail,
  loginAttemptsMap,
} from './admin/stores';

import { getAdminDomain } from './admin/stores';
import { authAdminRoutes } from './admin/auth.subroute';
import { customerAdminRoutes } from './admin/customers.subroute';
import { livechatAdminRoutes } from './admin/livechat.subroute';
import { reservationAdminRoutes } from './admin/reservations.subroute';
import { knowledgeAdminRoutes } from './admin/knowledge.subroute';
import { landingAdminRoutes } from './admin/landings.subroute';
import { settingsAdminRoutes } from './admin/settings.subroute';
import { wabaAdminRoutes } from './admin/waba.subroute';
import { migrationAdminRoutes } from './admin/migration.subroute';
import { evaluationsAdminRoutes } from './admin/evaluations.subroute';
import { metaAttributionAdminRoutes } from './admin/meta-attribution.subroute';
import { exportAdminRoutes } from './admin/export.subroute';
import { staffManagementAdminRoutes } from './admin/staff-management.subroute';

export async function adminRoutes(fastify: FastifyInstance) {
  const { AdminSessionService } = await import('../services/admin-session.service');

  // --- REVISI SECURITY: Origin Isolation & Dual Auth Middleware (X-API-KEY or HttpOnly Cookie Session) ---
  fastify.addHook('preHandler', async (request, reply) => {
    // 1. Layer 1 Origin Isolation Guard: Block /admin/* pada tenant landing pages domain
    const xForwardedHost = request.headers['x-forwarded-host'];
    const hostVal = Array.isArray(xForwardedHost) ? xForwardedHost[0] : xForwardedHost;
    const hostHeader = (request.headers.host || request.hostname || hostVal || '').toLowerCase();
    if (
      getAdminDomain() &&
      hostHeader.includes(`pages.${getAdminDomain()}`) &&
      (request.url.includes('/admin') || request.url.includes('/api/admin'))
    ) {
      console.warn(
        `[ORIGIN ISOLATION GUARD] Blocked admin access attempt on tenant landing domain (${hostHeader}${request.url})`
      );
      return reply.status(404).send({ error: 'Not Found' });
    }

    // 2. Allow unauthenticated access to auth endpoints and static HTML pages
    if (
      request.url.startsWith('/admin/') ||
      request.url === '/api/admin/auth/login' ||
      request.url === '/api/admin/auth/logout' ||
      request.url === '/api/admin/auth/me' ||
      request.url === '/api/admin/auth/restore'
    ) {
      return;
    }

    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      return reply.status(401).send({ error: 'Unauthorized: Admin API Key is not configured on the server.' });
    }

    // 3. Multi-Auth Verification: Check X-API-KEY header, admin_session cookie, or staff_session cookie
    const clientKey = request.headers['x-api-key'] as string;
    const cookieHeader = request.headers['cookie'] || '';
    const sessionCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];
    const staffCookie = cookieHeader.match(/staff_session=([^;]+)/)?.[1];

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
    } else if (staffCookie) {
      const { StaffAuthService } = await import('../services/staff-auth.service');
      const staffSession = await StaffAuthService.validateSession(staffCookie);
      if (staffSession && staffSession.staff.role !== 'THERAPIST') {
        isAuthenticated = true;
        identity = staffSession.staff.name;
        (request as any).staffRole = staffSession.staff.role;
        (request as any).staffId = staffSession.staff.id;
      }
    }

    if (!isAuthenticated) {
      return reply
        .status(401)
        .send({ error: 'Unauthorized: Invalid or missing authentication credentials (X-API-KEY, admin_session, or staff_session cookie).' });
    }

    (request as any).adminKeyUsed = clientKey || 'COOKIE_SESSION';
    (request as any).adminIdentity = identity;
  });

  // Register all modular admin sub-routes
  fastify.register(authAdminRoutes);
  fastify.register(customerAdminRoutes);
  fastify.register(livechatAdminRoutes);
  fastify.register(reservationAdminRoutes);
  fastify.register(knowledgeAdminRoutes);
  fastify.register(landingAdminRoutes);
  fastify.register(settingsAdminRoutes);
  fastify.register(wabaAdminRoutes);
  fastify.register(migrationAdminRoutes);
  fastify.register(evaluationsAdminRoutes);
  fastify.register(metaAttributionAdminRoutes);
  fastify.register(exportAdminRoutes);
  fastify.register(staffManagementAdminRoutes);

  // Serve admin HTML files & SPA assets
  const fs = await import('fs/promises');
  const path = await import('path');

  fastify.get('/admin/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const urlPath = request.url.split('?')[0];

    // 1. If it is requesting assets, handle it
    if (urlPath.endsWith('/sw.js')) {
      try {
        const filePath = path.join(__dirname, '../../packages/admin-dashboard/dist/sw.js');
        const content = await fs.readFile(filePath);
        reply.type('application/javascript');
        reply.header('Service-Worker-Allowed', '/admin/');
        return reply.send(content);
      } catch {
        try {
          const filePath = path.join(__dirname, '../../packages/admin-dashboard/public/sw.js');
          const content = await fs.readFile(filePath);
          reply.type('application/javascript');
          reply.header('Service-Worker-Allowed', '/admin/');
          return reply.send(content);
        } catch {
          return reply.status(404).send({ error: 'Not Found' });
        }
      }
    }

    if (urlPath.endsWith('/pwa-icon.svg') || urlPath.endsWith('/favicon.ico')) {
      const filename = urlPath.split('/').pop() || '';
      try {
        const filePath = path.join(__dirname, '../../packages/admin-dashboard/dist', filename);
        const content = await fs.readFile(filePath);
        reply.type(filename.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon');
        return reply.send(content);
      } catch {
        try {
          const filePath = path.join(__dirname, '../../packages/admin-dashboard/public', filename);
          const content = await fs.readFile(filePath);
          reply.type(filename.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon');
          return reply.send(content);
        } catch {
          return reply.status(404).send({ error: 'Not Found' });
        }
      }
    }

    if (urlPath.endsWith('/manifest.json')) {
      try {
        const filePath = path.join(__dirname, '../../packages/admin-dashboard/dist/manifest.json');
        const content = await fs.readFile(filePath);
        reply.type('application/json');
        return reply.send(content);
      } catch {
        try {
          const filePath = path.join(__dirname, '../../packages/admin-dashboard/public/manifest.json');
          const content = await fs.readFile(filePath);
          reply.type('application/json');
          return reply.send(content);
        } catch {
          return reply.status(404).send({ error: 'Not Found' });
        }
      }
    }

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
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return reply.send(content);
      } catch (err) {
        return reply.status(404).send({ error: 'Not Found' });
      }
    }

    // 2. If it is specifically requesting a static legacy html page, serve it from public/
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
      reply.header('Cache-Control', 'no-cache');
      return reply.send(content);
    } catch (err) {
      const filename = urlPath.split('/admin/')[1] || 'login.html';
      if (/^[a-z0-9-]+\.html$/.test(filename)) {
        try {
          const filePath = path.join(__dirname, '../../packages/admin-dashboard/public', filename);
          const content = await fs.readFile(filePath, 'utf-8');
          reply.type('text/html');
          return reply.send(content);
        } catch (e) {
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

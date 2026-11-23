import { FastifyInstance } from 'fastify';
import { StaffAuthService } from '../services/staff-auth.service';
import { AdminSessionService, SessionStoreUnavailable } from '../services/admin-session.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { staffAuthRoutes } from './staff/auth.subroute';
import { staffTodayRoutes } from './staff/today.subroute';
import { staffQuickRepliesRoutes } from './staff/quick-replies.subroute';
import { staffScorecardRoutes } from './staff/scorecard.subroute';
import { staffDelayWatchdogRoutes } from './staff/delay-watchdog.subroute';

/**
 * Re-export kanonis: predikat peran tinggal di `src/domain/staff-role.ts` agar
 * subroute tidak mengimpor route (anti siklus). Import lama tetap kompatibel.
 */
export { isStaffSupervisorRole } from '../domain/staff-role';

export async function staffRoutes(fastify: FastifyInstance) {
  // Middleware otentikasi independen khusus rute staff
  fastify.addHook('preHandler', async (request, reply) => {
    const urlPath = request.url.split('?')[0];

    // Login & logout endpoint dapat diakses tanpa sesi
    if (
      urlPath === '/api/staff/auth/login' ||
      urlPath === '/api/staff/auth/logout' ||
      urlPath === '/api/staff/auth/restore'
    ) {
      return;
    }

    const cookieHeader = request.headers['cookie'] || '';
    const staffCookie = cookieHeader.match(/staff_session=([^;]+)/)?.[1];
    const adminCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];

    let session = null;
    if (staffCookie) {
      try {
        session = await StaffAuthService.validateSession(staffCookie);
      } catch (err) {
        // Kontrak sinyal: DB sesi staff tak tersedia → 503, jangan 401 ambigu
        // (401 memicu penghapusan token cadangan di frontend).
        if (err instanceof SessionStoreUnavailable) {
          return reply.status(503).send({
            error: 'Layanan sesi sedang tidak tersedia. Silakan coba lagi.',
            code: 'SESSION_STORE_UNAVAILABLE',
          });
        }
        throw err;
      }
    }

    if (!session && adminCookie) {
      let adminSession: Awaited<ReturnType<typeof AdminSessionService.validateSession>>;
      try {
        adminSession = await AdminSessionService.validateSession(adminCookie);
      } catch (err) {
        // Kontrak sinyal: DB sesi tak tersedia → 503, jangan jatuh ke 401
        // (401 ambigu memicu penghapusan token cadangan di frontend).
        if (err instanceof SessionStoreUnavailable) {
          return reply.status(503).send({
            error: 'Layanan sesi sedang tidak tersedia. Silakan coba lagi.',
            code: 'SESSION_STORE_UNAVAILABLE',
          });
        }
        throw err;
      }
      if (adminSession) {
        const impersonatedTenantId =
          (request as any).tenantId ||
          (request.headers['x-tenant-id'] as string) ||
          (request.query as any)?.tenant_id ||
          (adminSession as any)?.tenant_id ||
          DEFAULT_TENANT_ID;

        session = {
          token: adminCookie,
          staff: {
            id: adminSession.id || 'admin',
            name: adminSession.adminIdentity || 'Admin',
            role: 'SPV_CS',
            tenant_id: impersonatedTenantId,
          },
          createdAt: adminSession.createdAt,
          expiresAt: adminSession.expiresAt,
          isAdminImpersonation: true,
        } as any;
      }
    }

    if (!session) {
      return reply.status(401).send({
        error: 'Unauthorized: Sesi staff tidak valid atau kadaluarsa.',
      });
    }

    // Pasang konteks sesi & ID staff ke request untuk digunakan handler subroute
    (request as any).staffSession = session;
    (request as any).staffId = session.staff.id;
  });

  // Daftarkan subroute staff
  fastify.register(staffAuthRoutes);
  fastify.register(staffTodayRoutes);
  fastify.register(staffQuickRepliesRoutes);
  fastify.register(staffScorecardRoutes);
  fastify.register(staffDelayWatchdogRoutes);
}

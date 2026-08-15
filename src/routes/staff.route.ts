import { FastifyInstance } from 'fastify';
import { StaffAuthService } from '../services/staff-auth.service';
import { staffAuthRoutes } from './staff/auth.subroute';
import { staffTodayRoutes } from './staff/today.subroute';

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
    const cookie = cookieHeader.match(/staff_session=([^;]+)/)?.[1];
    const session = cookie ? await StaffAuthService.validateSession(cookie) : null;

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
}

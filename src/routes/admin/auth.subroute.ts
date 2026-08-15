import { FastifyInstance } from 'fastify';
import { safeCompare } from '../../utils/auth';
import { getAdminEmail, loginAttemptsMap } from './stores';
import { StaffAuthService } from '../../services/staff-auth.service';
import { verifyPassword } from '../../utils/bcrypt';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export async function authAdminRoutes(fastify: FastifyInstance) {
  const { AdminSessionService } = await import('../../services/admin-session.service');

  /**
   * POST /api/admin/auth/login
   * Unified Login Endpoint: Mendukung Admin (API Key / Password) dan Staff/Terapis (No. HP + Password).
   * Otomatis mengarahkan ke dashboard yang sesuai berdasarkan role.
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

    const body = (request.body || {}) as {
      identifier?: string;
      email?: string;
      phone?: string;
      apiKey?: string;
      password?: string;
      adminIdentity?: string;
    };
    const inputKey = body.password || body.apiKey || '';
    const identifier = (body.identifier || body.email || body.phone || '').trim();

    const isSecureRequest =
      request.protocol === 'https' ||
      String(request.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim() === 'https';

    // --- TAHAP A: Verifikasi Super Admin (Password / API Key cocok dengan ADMIN_API_KEY) ---
    const adminKey = process.env.ADMIN_API_KEY;
    if (adminKey && inputKey && safeCompare(inputKey, adminKey)) {
      loginAttemptsMap.delete(ip);

      const session = AdminSessionService.createSession(body.adminIdentity || identifier || 'Super Admin');
      const cookieValue = `admin_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${
        isSecureRequest ? '; Secure' : ''
      }`;
      reply.header('Set-Cookie', cookieValue);

      return reply.status(200).send({
        success: true,
        message: 'Login Super Admin berhasil.',
        role: 'super_admin',
        redirectTo: '/admin/overview',
        user: {
          id: session.id,
          email: getAdminEmail(),
          name: session.adminIdentity,
          role: 'super_admin',
          tenantId: DEFAULT_TENANT_ID,
        },
        data: {
          adminIdentity: session.adminIdentity,
          expiresAt: session.expiresAt,
        },
      });
    }

    // --- TAHAP B: Verifikasi Staff (Phone + Bcrypt Password di tabel Staff) ---
    if (identifier && inputKey) {
      const normalizedPhone = identifier.replace(/\D/g, '');
      try {
        const staff = await prisma.staff.findFirst({
          where: {
            phone: normalizedPhone.length > 0 ? normalizedPhone : identifier,
            tenant_id: DEFAULT_TENANT_ID,
            active: true,
          },
        });

        if (staff && (await verifyPassword(inputKey, staff.password_hash))) {
          loginAttemptsMap.delete(ip);

          const result = await StaffAuthService.login(staff.phone, inputKey, DEFAULT_TENANT_ID);
          if (result) {
            const cookieValue = `staff_session=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${
              isSecureRequest ? '; Secure' : ''
            }`;
            reply.header('Set-Cookie', cookieValue);

            const staffRole = staff.role; // 'THERAPIST' | 'ADMIN_CS' | 'ADVERTISER'
            const redirectTo = staffRole === 'THERAPIST' ? '/admin/staff/today' : '/admin/overview';
            const frontendRole =
              staffRole === 'THERAPIST' ? 'therapist' : staffRole === 'ADMIN_CS' ? 'admin_cs' : 'advertiser';

            return reply.status(200).send({
              success: true,
              message: `Login berhasil sebagai ${staff.name}.`,
              role: frontendRole,
              redirectTo,
              user: {
                id: staff.id,
                name: staff.name,
                phone: staff.phone,
                role: frontendRole,
                tenantId: DEFAULT_TENANT_ID,
              },
              data: {
                expiresAt: result.expiresAt,
              },
            });
          }
        }
      } catch (err: any) {
        console.error('[UNIFIED LOGIN] Staff lookup error:', err.message);
      }
    }

    // --- TAHAP C: Kredensial tidak valid ---
    return reply.status(401).send({ error: 'Email / Nomor WhatsApp atau password salah.' });
  });

  /**
   * POST /api/admin/auth/logout
   * Membersihkan sesi admin dan sesi staff serta cookies
   */
  fastify.post('/api/admin/auth/logout', async (request, reply) => {
    const cookieHeader = request.headers['cookie'] || '';
    const adminSessionCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];
    const staffSessionCookie = cookieHeader.match(/staff_session=([^;]+)/)?.[1];

    if (adminSessionCookie) {
      AdminSessionService.destroySession(adminSessionCookie);
    }
    if (staffSessionCookie) {
      await StaffAuthService.logout(staffSessionCookie);
    }

    reply.header('Set-Cookie', [
      'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      'staff_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    ]);
    return reply.status(200).send({ success: true, message: 'Logout berhasil. Sesi dibersihkan.' });
  });

  /**
   * GET /api/admin/auth/me
   * Mengembalikan info profil session aktif (Super Admin atau Staff RBAC)
   */
  fastify.get('/api/admin/auth/me', async (request, reply) => {
    const cookieHeader = request.headers['cookie'] || '';
    const adminSessionCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];
    const clientKey = request.headers['x-api-key'] as string;
    const adminKey = process.env.ADMIN_API_KEY;

    // 1a. Cek header X-API-KEY
    if (clientKey && adminKey && safeCompare(clientKey, adminKey)) {
      const identity = (request.headers['x-admin-identity'] || 'API Key Client') as string;
      return reply.status(200).send({
        success: true,
        authenticated: true,
        adminIdentity: identity,
        user: {
          id: 'admin-key',
          email: getAdminEmail(),
          name: identity,
          role: 'super_admin',
          tenantId: DEFAULT_TENANT_ID,
        },
      });
    }

    // 1b. Cek adminIdentity jika sudah dipasang oleh hook
    if ((request as any).adminIdentity) {
      return reply.status(200).send({
        success: true,
        authenticated: true,
        adminIdentity: (request as any).adminIdentity,
        user: {
          id: 'admin-session',
          email: getAdminEmail(),
          name: (request as any).adminIdentity || 'Super Admin',
          role: 'super_admin',
          tenantId: DEFAULT_TENANT_ID,
        },
      });
    }

    // 1c. Cek cookie admin_session
    if (adminSessionCookie) {
      const session = AdminSessionService.validateSession(adminSessionCookie);
      if (session) {
        return reply.status(200).send({
          success: true,
          authenticated: true,
          adminIdentity: session.adminIdentity,
          user: {
            id: session.id,
            email: getAdminEmail(),
            name: session.adminIdentity,
            role: 'super_admin',
            tenantId: DEFAULT_TENANT_ID,
          },
        });
      }
    }

    // 2. Cek sesi staff dari cookie
    const staffCookie = cookieHeader.match(/staff_session=([^;]+)/)?.[1];
    if (staffCookie) {
      const session = await StaffAuthService.validateSession(staffCookie);
      if (session) {
        const staffRole = session.staff.role;
        const role =
          staffRole === 'THERAPIST' ? 'therapist' : staffRole === 'ADMIN_CS' ? 'admin_cs' : 'advertiser';
        return reply.status(200).send({
          success: true,
          authenticated: true,
          adminIdentity: session.staff.name,
          user: {
            id: session.staff.id,
            name: session.staff.name,
            phone: session.staff.phone,
            role,
            tenantId: DEFAULT_TENANT_ID,
          },
        });
      }
    }

    return reply.status(401).send({ error: 'Not authenticated' });
  });
}

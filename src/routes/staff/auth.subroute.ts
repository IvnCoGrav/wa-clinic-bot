import { FastifyInstance } from 'fastify';
import { StaffAuthService } from '../../services/staff-auth.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { verifyPassword } from '../../utils/bcrypt';
import { prisma } from '../../db/client';

// Rate limiting khusus endpoint staff login (terpisah dari admin)
const staffLoginAttemptsMap = new Map<string, { count: number; resetAt: number }>();

export async function staffAuthRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/staff/auth/login
   * Endpoint Login Staff / Terapis dengan Rate Limiting (5 req/min/IP) & Cookie HttpOnly staff_session
   */
  fastify.post('/api/staff/auth/login', async (request, reply) => {
    const ip = request.ip || '127.0.0.1';
    const now = Date.now();

    let rate = staffLoginAttemptsMap.get(ip);
    if (!rate || now > rate.resetAt) {
      rate = { count: 1, resetAt: now + 60 * 1000 };
      staffLoginAttemptsMap.set(ip, rate);
    } else {
      rate.count++;
    }

    if (rate.count > 5) {
      return reply.status(429).send({
        error: 'Terlalu banyak percobaan login. Coba lagi dalam 1 menit.',
      });
    }

    const { phone, password, tenantId = DEFAULT_TENANT_ID } = (request.body || {}) as {
      phone?: string;
      password?: string;
      tenantId?: string;
    };

    if (!phone || !password) {
      return reply.status(400).send({ error: 'Nomor HP dan password wajib diisi.' });
    }

    const result = await StaffAuthService.login(phone, password, tenantId);
    if (!result) {
      try {
        const normalizedPhone = phone.replace(/\D/g, '');
        const staff = await prisma.staff.findFirst({
          where: {
            phone: normalizedPhone.length > 0 ? normalizedPhone : phone,
            tenant_id: tenantId,
          },
        });
        if (
          staff &&
          staff.active &&
          (await verifyPassword(password, staff.password_hash)) &&
          staff.role !== 'THERAPIST'
        ) {
          return reply.status(403).send({
            error: `Akun "${staff.name}" adalah Staf Admin (${staff.role}) dan tidak boleh login memakai nomor HP. Gunakan email super admin, atau minta pengelola mengubah peran akun menjadi Terapis.`,
          });
        }
      } catch {
        // DB offline / error query — jatuh ke pesan generik di bawah
      }
      return reply.status(401).send({ error: 'Nomor HP atau password salah, atau akun nonaktif.' });
    }

    staffLoginAttemptsMap.delete(ip);

    const isSecureRequest =
      request.protocol === 'https' ||
      String(request.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim() === 'https';

    const cookieValue = `staff_session=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${
      isSecureRequest ? '; Secure' : ''
    }`;
    reply.header('Set-Cookie', cookieValue);

    return reply.status(200).send({
      success: true,
      message: 'Login staff berhasil.',
      staff: {
        id: result.staff.id,
        name: result.staff.name,
        role: (result.staff.role || 'THERAPIST').toLowerCase(),
      },
      data: {
        expiresAt: result.expiresAt,
      },
      token: result.token,
    });
  });

  /**
   * POST /api/staff/auth/restore
   * Mengembalikan cookie staff_session dari token yang disimpan di localStorage (fallback PWA).
   * Dipakai saat browser kehilangan cookie (mis. PWA Android ditutup) tapi sesi server masih valid.
   */
  fastify.post('/api/staff/auth/restore', async (request, reply) => {
    const body = (request.body || {}) as { token?: string };
    const token = (body.token || '').trim();
    if (!token) {
      return reply.status(400).send({ error: 'Token wajib diisi.' });
    }

    const session = await StaffAuthService.validateSession(token);
    if (!session) {
      return reply.status(401).send({ error: 'Sesi tidak valid atau telah kadaluarsa.' });
    }

    const isSecureRequest =
      request.protocol === 'https' ||
      String(request.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim() === 'https';

    const cookieValue = `staff_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${
      isSecureRequest ? '; Secure' : ''
    }`;
    reply.header('Set-Cookie', cookieValue);

    return reply.status(200).send({
      success: true,
      message: 'Sesi staff dipulihkan.',
      staff: {
        id: session.staff.id,
        name: session.staff.name,
        role: (session.staff.role || 'THERAPIST').toLowerCase(),
      },
    });
  });

  /**
   * POST /api/staff/auth/logout
   * Menghancurkan sesi staff dan menghapus cookie staff_session
   */
  fastify.post('/api/staff/auth/logout', async (request, reply) => {
    const cookieHeader = request.headers['cookie'] || '';
    const cookie = cookieHeader.match(/staff_session=([^;]+)/)?.[1];

    if (cookie) {
      await StaffAuthService.logout(cookie);
    }

    reply.header('Set-Cookie', 'staff_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return reply.status(200).send({ success: true, message: 'Logout staff berhasil.' });
  });

  /**
   * GET /api/staff/auth/me
   * Memeriksa info sesi staff aktif saat ini
   */
  fastify.get('/api/staff/auth/me', async (request, reply) => {
    const session = (request as any).staffSession;
    if (!session || !session.staff) {
      return reply.status(401).send({ authenticated: false, error: 'Unauthorized' });
    }

    return reply.status(200).send({
      authenticated: true,
      success: true,
      staff: {
        id: session.staff.id,
        name: session.staff.name,
        role: (session.staff.role || 'THERAPIST').toLowerCase(),
      },
    });
  });
}

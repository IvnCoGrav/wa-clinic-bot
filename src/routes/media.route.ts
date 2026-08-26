import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { safeCompare } from '../utils/auth';

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Folder outbound → publik (dibutuhkan Meta/WABA & WAHA utk mengambil file).
// Folder inbound → privat, hanya dapat diakses dashboard ber-login (via cookie admin_session / staff_session).
const SCOPE_IS_PRIVATE: Record<string, boolean> = {
  outbound: false,
  inbound: true,
};

/**
 * Validasi otentikasi media privat (inbound / WAHA proxy)
 */
async function isMediaAuthorized(request: FastifyRequest): Promise<boolean> {
  const isDev = process.env.NODE_ENV !== 'production';
  const cookieHeader = request.headers['cookie'] || '';
  const sessionCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];
  const staffCookie = cookieHeader.match(/staff_session=([^;]+)/)?.[1];
  const apiKey = (request.headers['x-api-key'] || request.headers['x-admin-api-key'] || (request.query as any)?.apiKey || (request.query as any)?.key) as string | undefined;
  const authHeader = request.headers['authorization'];
  const queryToken = (request.query as any)?.token;

  const { AdminSessionService } = await import('../services/admin-session.service');
  if (sessionCookie && AdminSessionService.validateSession(sessionCookie)) return true;
  if (staffCookie) {
    const { StaffAuthService } = await import('../services/staff-auth.service');
    const staff = await StaffAuthService.validateSession(staffCookie);
    if (staff) return true;
  }
  if (queryToken) {
    if (AdminSessionService.validateSession(queryToken)) return true;
    const { StaffAuthService } = await import('../services/staff-auth.service');
    const staff = await StaffAuthService.validateSession(queryToken);
    if (staff) return true;
  }
  const adminKey = process.env.ADMIN_API_KEY;
  if (apiKey && adminKey && safeCompare(apiKey, adminKey)) return true;
  if (authHeader && authHeader.startsWith('Bearer ') && adminKey && safeCompare(authHeader.slice(7), adminKey)) return true;
  return false;
}

/**
 * SSRF Guard untuk URL eksternal (memblokir internal IPs, private networks, cloud metadata)
 */
function isValidExternalUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '169.254.169.254' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function mediaRoutes(fastify: FastifyInstance) {
  const { mediaService } = await import('../services/media.service');

  fastify.get('/media/:scope/:tenant/:file', async (request: FastifyRequest<{
    Params: { scope: string; tenant: string; file: string };
  }>, reply: FastifyReply) => {
    const { scope, tenant, file } = request.params;

    if (!(scope in SCOPE_IS_PRIVATE)) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    // Folder inbound privat → verifikasi session admin/staff atau API key
    if (SCOPE_IS_PRIVATE[scope]) {
      const authorized = await isMediaAuthorized(request);
      if (!authorized) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }

    const abs = mediaService.filePathFromRelativeUrl(`/media/${scope}/${tenant}/${file}`);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const ext = (path.extname(abs) || '').replace(/^\./, '').toLowerCase();
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.type(MIME_MAP[ext] || 'application/octet-stream');
    const stream = fs.createReadStream(abs);
    return reply.send(stream);
  });

  /**
   * GET /api/files/:session/:file
   * Proxy terautentikasi ke file store WAHA (SEC-02 Fix)
   * Hanya dapat diakses oleh user terautentikasi (admin/staff/API key).
   */
  fastify.get('/api/files/:session/:file', async (request: FastifyRequest<{
    Params: { session: string; file: string };
  }>, reply: FastifyReply) => {
    const authorized = await isMediaAuthorized(request);
    if (!authorized) {
      return reply.status(401).send({ error: 'Unauthorized: Authentication required to access WhatsApp files.' });
    }

    const { session, file } = request.params;
    const { wahaClient } = await import('../integrations/waha/client');

    const result = await wahaClient.fetchFile(session, file);
    if (!result) {
      return reply.status(404).send({ error: 'File tidak ditemukan di server WAHA' });
    }

    const ext = (path.extname(file) || '').replace(/^\./, '').toLowerCase();
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.type(result.contentType || MIME_MAP[ext] || 'image/jpeg');
    return reply.send(result.data);
  });

  /**
   * GET /media/asset/:filename
   * Endpoint publik asset statis (misal gambar pricelist default) agar dapat dimuat di dashboard Live Chat.
   */
  fastify.get('/media/asset/:filename', async (request: FastifyRequest<{
    Params: { filename: string };
  }>, reply: FastifyReply) => {
    const { filename } = request.params;
    const sanitized = path.basename(filename);
    const assetPath = path.join(process.cwd(), 'assets', sanitized);
    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      return reply.status(404).send({ error: 'Asset Not Found' });
    }
    const ext = (path.extname(sanitized) || '').replace(/^\./, '').toLowerCase();
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.type(MIME_MAP[ext] || 'image/jpeg');
    return reply.send(fs.createReadStream(assetPath));
  });

  /**
   * GET /media/avatar/:customerId
   * Endpoint publik foto profil customer (atau avatar inisial) dengan proteksi SSRF (SEC-06 Fix).
   */
  fastify.get('/media/avatar/:customerId', async (request: FastifyRequest<{
    Params: { customerId: string };
  }>, reply: FastifyReply) => {
    const rawId = request.params.customerId.replace(/\.(jpg|jpeg|png|webp|svg)$/i, '');
    const { prisma } = await import('../db/client');
    const { customerService } = await import('../services/customer.service');
    const axios = (await import('axios')).default;

    let customer: any = null;
    try {
      customer = await customerService.getCustomerById(rawId, 'default-tenant');
      if (!customer) {
        customer = await prisma.customer.findUnique({ where: { id: rawId } });
      }
    } catch {}

    const avatarDir = path.join(process.cwd(), 'storage', 'media', 'avatars');
    const localAvatarPath = path.join(avatarDir, `${rawId}.jpg`);

    // 1. Ambil dari cache lokal jika sudah ada
    if (fs.existsSync(localAvatarPath) && fs.statSync(localAvatarPath).isFile()) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.type('image/jpeg');
      return reply.send(fs.createReadStream(localAvatarPath));
    }

    // 2. Unduh dari customer.profile_picture_url jika ada & valid (SSRF Protected)
    if (customer?.profile_picture_url && isValidExternalUrl(customer.profile_picture_url)) {
      try {
        const picRes = await axios.get(customer.profile_picture_url, {
          responseType: 'arraybuffer',
          timeout: 4000,
          maxContentLength: 2 * 1024 * 1024, // Max 2MB
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (picRes.status === 200 && picRes.data && picRes.data.length > 0) {
          try {
            if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
            fs.writeFileSync(localAvatarPath, Buffer.from(picRes.data));
          } catch {}
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Cache-Control', 'public, max-age=86400');
          reply.type('image/jpeg');
          return reply.send(Buffer.from(picRes.data));
        }
      } catch (err: any) {
        console.warn(`[AVATAR PROXY] Failed to fetch profile picture for customer ${rawId}:`, err.message);
      }
    }

    // 3. Fallback: generate dynamic avatar dari UI Avatars
    const name = customer?.name || 'Pelanggan';
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=008069&color=fff&size=256&bold=true`;
    try {
      const fallbackRes = await axios.get(fallbackUrl, { responseType: 'arraybuffer', timeout: 5000, maxContentLength: 1024 * 1024 });
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.type('image/png');
      return reply.send(Buffer.from(fallbackRes.data));
    } catch {
      return reply.redirect(fallbackUrl);
    }
  });
}
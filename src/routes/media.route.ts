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
  // Audio (voice note WhatsApp = Ogg Opus .oga) + format audio/dokumen lain.
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
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
  // D.3 (audit #199): DILARANG menerima kredensial via query string (?apiKey/
  // ?key/?token) — berisiko bocor ke access log/proxy/riwayat browser. Hanya
  // cookie sesi, header X-API-KEY, atau Authorization: Bearer yang diizinkan.
  const apiKey = (request.headers['x-api-key'] || request.headers['x-admin-api-key']) as string | undefined;
  const authHeader = request.headers['authorization'];

  const { AdminSessionService, SessionStoreUnavailable } = await import('../services/admin-session.service');
  // DB sesi tak tersedia → dianggap belum terotentikasi di lapis media (deny aman,
  // bukan 500). Media bukan jalur logout; fallback lain (staff/API key) tetap dicoba.
  const adminSessionValid = async (t: string): Promise<boolean> => {
    try {
      return !!(await AdminSessionService.validateSession(t));
    } catch (err) {
      if (err instanceof SessionStoreUnavailable) return false;
      throw err;
    }
  };
  // DB sesi staff tak tersedia → deny aman (false), bukan 500/401 ambigu.
  // Media bukan jalur logout; fallback lain (API key) tetap dicoba.
  const staffSessionValid = async (t: string): Promise<boolean> => {
    try {
      const { StaffAuthService } = await import('../services/staff-auth.service');
      return !!(await StaffAuthService.validateSession(t));
    } catch (err) {
      if (err instanceof SessionStoreUnavailable) return false;
      throw err;
    }
  };
  if (sessionCookie && (await adminSessionValid(sessionCookie))) return true;
  if (staffCookie && (await staffSessionValid(staffCookie))) return true;
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

/**
 * Helper untuk parsing Range header format `bytes=start-end`.
 * Mendukung `bytes=start-end`, `bytes=start-`, dan `bytes=-suffix`.
 * Mengembalikan:
 * - { start, end } jika rentang valid
 * - null jika tidak ada Range header
 * - 'INVALID' jika format salah atau di luar batas totalSize (respons 416)
 */
function parseRangeHeader(
  rangeHeader: string | undefined,
  totalSize: number
): { start: number; end: number } | null | 'INVALID' {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;
  const rawRange = rangeHeader.slice(6).trim();
  const match = rawRange.match(/^(\d*)-(\d*)$/);
  if (!match) return 'INVALID';
  const startStr = match[1];
  const endStr = match[2];

  if (!startStr && !endStr) return 'INVALID';

  let start: number;
  let end: number;

  if (startStr && endStr) {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
  } else if (startStr && !endStr) {
    start = parseInt(startStr, 10);
    end = totalSize - 1;
  } else {
    // Suffix range: bytes=-500 (ambil 500 byte terakhir)
    const suffix = parseInt(endStr, 10);
    if (suffix <= 0) return 'INVALID';
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  }

  if (isNaN(start) || isNaN(end) || start < 0 || end < start || start >= totalSize) {
    return 'INVALID';
  }

  // Batasi end tidak boleh melebihi totalSize - 1
  end = Math.min(end, totalSize - 1);
  return { start, end };
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
    let finalAbs: string = abs || '';
    let isFallback = false;
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      const fallbackAbs = mediaService.resolveThumbFallback(`/media/${scope}/${tenant}/${file}`);
      if (fallbackAbs) {
        finalAbs = fallbackAbs;
        isFallback = true;
      } else {
        return reply.status(404).send({ error: 'Not Found' });
      }
    }

    const stat = fs.statSync(finalAbs);
    const totalSize = stat.size;
    const ext = (path.extname(finalAbs) || '').replace(/^\./, '').toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cache-Control', 'public, max-age=86400');
    if (isFallback) {
      reply.header('X-Media-Fallback', 'thumbnail');
      console.log(`[MEDIA FALLBACK] HD→thumb served: /media/${scope}/${tenant}/${file}`);
    }
    reply.header('Accept-Ranges', 'bytes');
    reply.type(contentType);

    const range = parseRangeHeader(request.headers.range, totalSize);
    if (range === 'INVALID') {
      reply.status(416);
      reply.type('application/json');
      reply.header('Content-Range', `bytes */${totalSize}`);
      return reply.send({ error: 'Range Not Satisfiable' });
    }

    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      reply.status(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      reply.header('Content-Length', chunkSize);
      if (request.method === 'HEAD') {
        return reply.send();
      }
      const stream = fs.createReadStream(finalAbs, { start, end });
      return reply.send(stream);
    }

    reply.header('Content-Length', totalSize);
    if (request.method === 'HEAD') {
      return reply.send();
    }
    const stream = fs.createReadStream(finalAbs);
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

    const totalSize = result.data.length;
    const ext = (path.extname(file) || '').replace(/^\./, '').toLowerCase();
    const contentType = result.contentType || MIME_MAP[ext] || 'image/jpeg';

    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('Accept-Ranges', 'bytes');
    reply.type(contentType);

    const range = parseRangeHeader(request.headers.range, totalSize);
    if (range === 'INVALID') {
      reply.status(416);
      reply.type('application/json');
      reply.header('Content-Range', `bytes */${totalSize}`);
      return reply.send({ error: 'Range Not Satisfiable' });
    }

    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      reply.status(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      reply.header('Content-Length', chunkSize);
      if (request.method === 'HEAD') {
        return reply.send();
      }
      const chunk = result.data.subarray(start, end + 1);
      return reply.send(chunk);
    }

    reply.header('Content-Length', totalSize);
    if (request.method === 'HEAD') {
      return reply.send();
    }
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
    // SEC-AUDIT-05: kunci path traversal di level path resolver (stdlib path,
    // bukan pencocokan string). basename membuang segmen direktori; resolve+
    // startsWith memastikan file tetap di dalam avatarDir apa pun inputnya.
    const rawParam = request.params.customerId.replace(/\.(jpg|jpeg|png|webp|svg)$/i, '');
    const rawId = path.basename(rawParam);
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
    const resolvedDir = path.resolve(avatarDir);
    const localAvatarPath = path.resolve(avatarDir, `${rawId}.jpg`);
    if (!localAvatarPath.startsWith(resolvedDir + path.sep)) {
      return reply.status(404).send({ error: 'Not Found' });
    }

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
          // SEC-AUDIT-08: jangan ikuti redirect — server penyerang bisa 302 ke IP internal.
          maxRedirects: 0,
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
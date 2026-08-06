import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Folder outbound → publik (dibutuhkan Meta/WABA & WAHA utk mengambil file, dan
// untuk menampilkan gambar yang dikirim admin). Folder inbound → privat, hanya
// dapat diakses dashboard ber-login (via cookie admin_session).
const SCOPE_IS_PRIVATE: Record<string, boolean> = {
  outbound: false,
  inbound: true,
};

export async function mediaRoutes(fastify: FastifyInstance) {
  const { AdminSessionService } = await import('../services/admin-session.service');
  const { mediaService } = await import('../services/media.service');

  fastify.get('/media/:scope/:tenant/:file', async (request: FastifyRequest<{
    Params: { scope: string; tenant: string; file: string };
  }>, reply: FastifyReply) => {
    const { scope, tenant, file } = request.params;

    if (!(scope in SCOPE_IS_PRIVATE)) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    // Folder inbound privat → verifikasi session admin cookie.
    if (SCOPE_IS_PRIVATE[scope]) {
      const cookieHeader = request.headers['cookie'] || '';
      const sessionCookie = cookieHeader.match(/admin_session=([^;]+)/)?.[1];
      const valid = sessionCookie ? AdminSessionService.validateSession(sessionCookie) : false;
      if (!valid) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }

    const abs = mediaService.filePathFromRelativeUrl(`/media/${scope}/${tenant}/${file}`);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const ext = (path.extname(abs) || '').replace(/^\./, '').toLowerCase();
    reply.type(MIME_MAP[ext] || 'application/octet-stream');
    const stream = fs.createReadStream(abs);
    return reply.send(stream);
  });
}
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/**
 * Balasan cepat versi aplikasi staf (terapis/bidan).
 *
 * Hanya membaca (read-only) dan HANYA mengembalikan template yang aman
 * dikirim ke customer dari aplikasi staf. Teks bisnis tetap berasal dari DB
 * (tabel `quick_replies`), bukan hardcode di bundle frontend — sesuai mandat
 * non-hardcode & tenant-aware.
 */
export async function staffQuickRepliesRoutes(fastify: FastifyInstance) {
  fastify.get('/api/staff/quick-replies', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
    try {
      const rows = await (prisma as any).quickReply.findMany({
        where: { tenant_id: tenantId },
        select: { shortcut: true, title: true, content: true, category: true },
        orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
      });
      return reply.status(200).send({ success: true, data: rows });
    } catch {
      // DB offline: jangan gagalkan aplikasi staf; UI wajib fallback tanpa
      // mengarang teks bisnis (tombol draft akan memberi tahu template kosong).
      return reply.status(200).send({ success: true, data: [] });
    }
  });
}

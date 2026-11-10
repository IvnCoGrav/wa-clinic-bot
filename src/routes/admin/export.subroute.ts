import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { chatExportService, formatLocalDate } from '../../services/chat-export.service';

const chatExportCooldown = new Map<string, number>();
const CHAT_EXPORT_COOLDOWN_MS = 2000;

export async function exportAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/export/daily-chats?date=YYYY-MM-DD
   *    atau ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (rentang, maks 31 hari)
   * Generate konten Markdown percakapan harian/rentang untuk analisa AI.
   */
  fastify.get(
    '/api/admin/export/daily-chats',
    async (
      request: FastifyRequest<{ Querystring: { date?: string; startDate?: string; endDate?: string; tenantId?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = request.query?.tenantId || DEFAULT_TENANT_ID;
        const cooldownKey = `${tenantId}:${request.ip}`;
        const lastCall = chatExportCooldown.get(cooldownKey) || 0;
        const now = Date.now();
        if (now - lastCall < CHAT_EXPORT_COOLDOWN_MS) {
          return reply.status(429).send({
            success: false,
            code: 'RATE_LIMITED',
            error: 'Permintaan ekspor chat terlalu sering. Harap tunggu beberapa detik sebelum mencoba lagi.',
          });
        }
        chatExportCooldown.set(cooldownKey, now);
        if (chatExportCooldown.size > 500) {
          for (const [k, time] of chatExportCooldown.entries()) {
            if (now - time > 60000) chatExportCooldown.delete(k);
          }
        }

        const { date, startDate, endDate } = request.query || {};
        const hasRange = !!startDate && !!endDate;
        const label = hasRange ? `${startDate} s/d ${endDate}` : date || formatLocalDate();

        const result = hasRange
          ? await chatExportService.generateRange(tenantId, startDate!, endDate!)
          : await chatExportService.generateDay(tenantId, date || formatLocalDate());

        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error || 'Gagal generate ekspor chat.' });
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CHAT_EXPORT_GENERATE',
          targetId: label,
          payload: { tenantId, fileName: result.fileName, stats: result.stats },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/export/daily-chats/list
   * Daftar file ekspor harian yang sudah di-generate (oleh cron / manual).
   */
  fastify.get('/api/admin/export/daily-chats/list', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const files = await chatExportService.listExports();
      return reply.status(200).send({ success: true, data: files });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}

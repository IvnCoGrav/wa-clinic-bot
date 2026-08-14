import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { chatExportService, formatLocalDate } from '../../services/chat-export.service';

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
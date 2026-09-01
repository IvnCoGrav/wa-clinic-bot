import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FinancialAnalyticsService } from '../../services/financial-analytics.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export async function analyticsAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/financial-analytics
   * Mengambil data analitik omset, reservasi, tren harian, dan ringkasan transaksi bulanan
   */
  fastify.get(
    '/api/admin/financial-analytics',
    async (
      request: FastifyRequest<{
        Querystring: {
          year?: string;
          month?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const year = request.query.year ? parseInt(request.query.year, 10) : undefined;
      const month = request.query.month ? parseInt(request.query.month, 10) : undefined;

      try {
        const data = await FinancialAnalyticsService.getMonthlyAnalytics(
          DEFAULT_TENANT_ID,
          year,
          month
        );

        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err.message || 'Gagal memuat data analitik transaksi.',
        });
      }
    }
  );

  /**
   * GET /api/admin/financial-analytics/export
   * Mengunduh rekap spreadsheet CSV transaksi dan reservasi bulanan
   */
  fastify.get(
    '/api/admin/financial-analytics/export',
    async (
      request: FastifyRequest<{
        Querystring: {
          year?: string;
          month?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const now = new Date();
      const year = request.query.year ? parseInt(request.query.year, 10) : now.getFullYear();
      const month = request.query.month ? parseInt(request.query.month, 10) : now.getMonth() + 1;

      try {
        const csvContent = await FinancialAnalyticsService.generateMonthlyTransactionsCsv(
          DEFAULT_TENANT_ID,
          year,
          month
        );

        const filename = `rekap-transaksi-kala-spa-${year}-${String(month).padStart(2, '0')}.csv`;

        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .status(200)
          .send(csvContent);
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err.message || 'Gagal mengekspor file CSV transaksi.',
        });
      }
    }
  );
}

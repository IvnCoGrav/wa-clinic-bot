import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FinancialAnalyticsService } from '../../services/financial-analytics.service';
import { TreatmentHeatmapService } from '../../services/treatment-heatmap.service';
import { tenantOf } from './route-helpers';

const financialExportCooldown = new Map<string, number>();
const FINANCIAL_EXPORT_COOLDOWN_MS = 2000;

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
        const tenantId = tenantOf(request);
        const data = await FinancialAnalyticsService.getMonthlyAnalytics(
          tenantId,
          year,
          month
        );

        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send({ success: true, data });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          success: false,
          error: err.message || 'Gagal memuat data analitik transaksi.',
        });
      }
    }
  );

  /**
   * GET /api/admin/financial-analytics/heatmap
   * Heatmap kepadatan treatment: jumlah reservasi `completed` per tanggal/jam
   * (scope weekly | monthly | multi). Metrik warna = count, bukan omzet.
   */
  fastify.get(
    '/api/admin/financial-analytics/heatmap',
    async (
      request: FastifyRequest<{
        Querystring: {
          year?: string;
          month?: string;
          scope?: string;
          months?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const rawYear = request.query.year;
      const rawMonth = request.query.month;
      const rawScope = (request.query.scope || 'weekly').toLowerCase();
      const rawMonths = request.query.months;

      const year = rawYear === undefined ? undefined : parseInt(rawYear, 10);
      const month = rawMonth === undefined ? undefined : parseInt(rawMonth, 10);
      const months = rawMonths === undefined ? undefined : parseInt(rawMonths, 10);

      if (year !== undefined && (!Number.isInteger(year) || year < 1970 || year > 2999)) {
        return reply.status(400).send({ success: false, error: 'Parameter year tidak valid.' });
      }
      if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
        return reply.status(400).send({ success: false, error: 'Parameter month harus 1–12.' });
      }
      if (!['weekly', 'monthly', 'multi'].includes(rawScope)) {
        return reply.status(400).send({ success: false, error: 'Parameter scope harus weekly, monthly, atau multi.' });
      }
      if (months !== undefined && (!Number.isInteger(months) || months < 1 || months > 12)) {
        return reply.status(400).send({ success: false, error: 'Parameter months harus 1–12.' });
      }

      try {
        const tenantId = tenantOf(request);
        const data = await TreatmentHeatmapService.getHeatmap(
          tenantId,
          year,
          month,
          rawScope as 'weekly' | 'monthly' | 'multi',
          months
        );

        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send({ success: true, data });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          success: false,
          error: err.message || 'Gagal memuat heatmap treatment.',
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
        const tenantId = tenantOf(request);
        const cooldownKey = `${tenantId}:${request.ip}`;
        const lastCall = financialExportCooldown.get(cooldownKey) || 0;
        const nowMs = Date.now();
        if (nowMs - lastCall < FINANCIAL_EXPORT_COOLDOWN_MS) {
          return reply.status(429).send({
            success: false,
            code: 'RATE_LIMITED',
            error: 'Permintaan ekspor keuangan terlalu sering. Harap tunggu beberapa detik sebelum mencoba lagi.',
          });
        }
        financialExportCooldown.set(cooldownKey, nowMs);
        if (financialExportCooldown.size > 500) {
          for (const [k, time] of financialExportCooldown.entries()) {
            if (nowMs - time > 60000) financialExportCooldown.delete(k);
          }
        }

        const csvContent = await FinancialAnalyticsService.generateMonthlyTransactionsCsv(
          tenantId,
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
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          success: false,
          error: err.message || 'Gagal mengekspor file CSV transaksi.',
        });
      }
    }
  );
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { isScorecardStaffUiEnabled } from '../../config/feature-flags';
import { StaffScorecardService } from '../../services/staff-scorecard.service';
import { staffRetentionService } from '../../services/staff-retention.service';

const scorecardService = new StaffScorecardService();

function parsePeriod(query: Record<string, any>): { year: number; month: number } | null {
  const wibKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const [currentYear, currentMonth] = wibKey.split('-').map(Number);

  const year = query?.year ? Number(query.year) : currentYear;
  const month = query?.month ? Number(query.month) : currentMonth;

  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Dashboard raport untuk bidan yang sedang login.
 * staffId SELALU dari sesi; query staffId diabaikan (anti-IDOR).
 */
export async function staffScorecardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/staff/scorecard/me', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isScorecardStaffUiEnabled()) {
      return reply.status(404).send({
        success: false,
        code: 'FEATURE_DISABLED',
        error: 'Raport bidan belum diaktifkan untuk portal staf.',
      });
    }

    const staffId = (request as any).staffId;
    if (!staffId) {
      return reply.status(401).send({
        success: false,
        error: 'Sesi staff tidak valid.',
      });
    }

    const tenantId =
      (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
    const period = parsePeriod((request.query || {}) as Record<string, any>);
    if (!period) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_PERIOD',
        error: 'Parameter year/month tidak valid.',
      });
    }

    try {
      const report = await scorecardService.getReport({
        tenantId,
        year: period.year,
        month: period.month,
        staffId,
      });

      const item = report.items[0] || null;
      const retentionPolicy = await staffRetentionService.getPolicy(tenantId);

      return reply.send({
        success: true,
        data: {
          period: { year: period.year, month: period.month },
          item,
          /**
           * false = bidan tidak masuk daftar dinilai (nonaktif / tidak ikut insentif).
           * Dashboard memakai ini untuk membedakan "tidak dinilai" dari "belum ada kunjungan".
           */
          included: Boolean(item),
          policy: report.policy,
          retentionPolicy: {
            benchmark_pct: retentionPolicy.benchmark_pct,
            min_sample: retentionPolicy.min_sample,
            min_tenure_months: retentionPolicy.min_tenure_months,
            window_days: retentionPolicy.window_days,
            formula_version: retentionPolicy.formula_version,
          },
        },
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err?.message || 'Gagal memuat raport.',
      });
    }
  });
}

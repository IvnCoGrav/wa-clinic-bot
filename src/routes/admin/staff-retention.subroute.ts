import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { staffRetentionService } from '../../services/staff-retention.service';
import { tenantOf } from './route-helpers';
import { prisma } from '../../db/client';

export async function staffRetentionAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/staff-retention
   * Mengambil laporan retensi bidan periode bulanan (murni read-only)
   */
  fastify.get(
    '/api/admin/staff-retention',
    async (
      request: FastifyRequest<{
        Querystring: {
          year?: string;
          month?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = tenantOf(request);
        const now = new Date();
        const year = request.query.year ? parseInt(request.query.year, 10) : now.getUTCFullYear();
        const month = request.query.month ? parseInt(request.query.month, 10) : now.getUTCMonth() + 1;

        if (isNaN(year) || isNaN(month) || year < 2020 || year > 2050 || month < 1 || month > 12) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_PERIOD',
            error: 'Parameter year (2020-2050) dan month (1-12) tidak valid.',
          });
        }

        const staffRole = (request as any).staffRole;
        if (staffRole === 'THERAPIST') {
          return reply.status(403).send({
            success: false,
            code: 'FORBIDDEN_STAFF_ROLE',
            error: 'Bidan/Terapis tidak memiliki izin untuk melihat laporan retensi klinik.',
          });
        }

        const { report } = await staffRetentionService.computeForPeriod(tenantId, year, month, {
          persist: false,
          status: 'DRAFT',
        });

        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send({ success: true, data: report });
      } catch (err: any) {
        const isDbOffline = err.message?.includes('Database offline');
        const statusCode = isDbOffline ? 503 : (err.statusCode || 500);
        return reply.status(statusCode).send({
          success: false,
          code: isDbOffline ? 'DB_OFFLINE' : (err.code || 'INTERNAL_ERROR'),
          error: err.message || 'Gagal memuat laporan retensi bidan.',
        });
      }
    }
  );

  /**
   * GET /api/admin/staff-retention/drilldown
   * Mengambil daftar pasien kohort untuk verifikasi audit dan hak banding staf
   */
  fastify.get(
    '/api/admin/staff-retention/drilldown',
    async (
      request: FastifyRequest<{
        Querystring: {
          year?: string;
          month?: string;
          staff_id?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = tenantOf(request);
        const now = new Date();
        const year = request.query.year ? parseInt(request.query.year, 10) : now.getUTCFullYear();
        const month = request.query.month ? parseInt(request.query.month, 10) : now.getUTCMonth() + 1;
        const staffId = request.query.staff_id || null;

        const staffRole = (request as any).staffRole;
        const currentStaffId = (request as any).staffId;
        if (staffRole === 'THERAPIST') {
          if (!currentStaffId || staffId !== currentStaffId) {
            return reply.status(403).send({
              success: false,
              code: 'FORBIDDEN_STAFF_ROLE',
              error: 'Bidan hanya diperbolehkan melihat drilldown pasien kohort milik sendiri.',
            });
          }
        }

        if (isNaN(year) || isNaN(month) || year < 2020 || year > 2050 || month < 1 || month > 12) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_PERIOD',
            error: 'Parameter year (2020-2050) dan month (1-12) tidak valid.',
          });
        }

        const drilldown = await staffRetentionService.getDrilldown(tenantId, staffId, year, month);

        return reply.status(200).send({
          success: true,
          data: drilldown,
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          success: false,
          error: err.message || 'Gagal memuat drilldown pasien kohort.',
        });
      }
    }
  );

  /**
   * POST /api/admin/staff-retention/snapshot
   * Membekukan (freeze) snapshot retensi per periode untuk keperluan payroll
   */
  fastify.post(
    '/api/admin/staff-retention/snapshot',
    async (
      request: FastifyRequest<{
        Body: {
          year: number;
          month: number;
          status?: 'PREVIEW' | 'FINAL';
          notes?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const staffRole = (request as any).staffRole;
        if (staffRole && staffRole !== 'SUPER_ADMIN' && staffRole !== 'TENANT_ADMIN') {
          return reply.status(403).send({
            success: false,
            error: 'Pembekuan snapshot hanya boleh dilakukan oleh Admin atau Super Admin.',
            code: 'FORBIDDEN_ROLE',
          });
        }

        const tenantId = tenantOf(request);
        const { year, month, status = 'PREVIEW' } = request.body || {};

        if (!year || !month || year < 2020 || year > 2050 || month < 1 || month > 12) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_PERIOD',
            error: 'Parameter year (2020-2050) dan month (1-12) wajib diisi dengan benar.',
          });
        }

        const actor =
          (request as any).adminUser?.name ||
          (request as any).staffName ||
          (request as any).authMethod ||
          'admin';

        const { report } = await staffRetentionService.computeForPeriod(tenantId, year, month, {
          persist: true,
          status,
          actor,
        });

        return reply.status(200).send({
          success: true,
          message: `Snapshot periode ${year}-${month} berhasil disimpan dengan status ${status}.`,
          data: report,
        });
      } catch (err: any) {
        const isDbOffline = err.message?.includes('Database offline');
        const statusCode = isDbOffline ? 503 : (err.statusCode || 500);
        return reply.status(statusCode).send({
          success: false,
          code: isDbOffline ? 'DB_OFFLINE' : (err.code || 'INTERNAL_ERROR'),
          error: err.message || 'Gagal menyimpan snapshot retensi.',
        });
      }
    }
  );

  /**
   * GET /api/admin/staff-retention/policy
   * Mengambil kebijakan (policy) retensi aktif
   */
  fastify.get(
    '/api/admin/staff-retention/policy',
    async (
      request: FastifyRequest<{
        Querystring: {
          as_of?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = tenantOf(request);
        const asOfDate = request.query.as_of ? new Date(request.query.as_of) : new Date();
        const policy = await staffRetentionService.getPolicy(tenantId, asOfDate);

        return reply.status(200).send({
          success: true,
          data: policy,
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          success: false,
          error: err.message || 'Gagal memuat policy retensi.',
        });
      }
    }
  );

  /**
   * PUT /api/admin/staff-retention/policy
   * Membuat versi baru policy retensi (Hanya SUPER_ADMIN)
   */
  fastify.put(
    '/api/admin/staff-retention/policy',
    async (
      request: FastifyRequest<{
        Body: {
          window_days?: number;
          pool_months?: number;
          benchmark_pct?: number;
          tier1_max_pct?: number;
          tier2_max_pct?: number;
          split_tier1?: number;
          split_tier2?: number;
          split_tier3?: number;
          min_sample?: number;
          min_tenure_months?: number;
          downgrade_periods?: number;
          soft_landing_until?: string | null;
          effective_from: string;
          formula_version?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const staffRole = (request as any).staffRole;
        if (staffRole && staffRole !== 'SUPER_ADMIN') {
          return reply.status(403).send({
            success: false,
            error: 'Pengaturan policy retensi hanya boleh diubah oleh Super Admin.',
            code: 'FORBIDDEN_STAFF_ROLE',
          });
        }

        const tenantId = tenantOf(request);
        const body = request.body;

        if (!body || !body.effective_from) {
          return reply.status(400).send({
            success: false,
            error: 'Parameter effective_from wajib disertakan.',
          });
        }

        const effectiveFromDate = new Date(body.effective_from);
        if (isNaN(effectiveFromDate.getTime())) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_EFFECTIVE_FROM',
            error: 'Format tanggal effective_from tidak valid.',
          });
        }

        const tier1 = body.tier1_max_pct ?? 31.1;
        const tier2 = body.tier2_max_pct ?? 38.1;
        if (tier1 <= 0 || tier2 <= tier1 || tier2 >= 100) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_TIER_THRESHOLDS',
            error: 'Ambang tier1_max_pct harus > 0 dan lebih kecil dari tier2_max_pct (< 100).',
          });
        }

        const s1 = body.split_tier1 ?? 50;
        const s2 = body.split_tier2 ?? 55;
        const s3 = body.split_tier3 ?? 60;
        if (s1 < 0 || s2 < s1 || s3 < s2 || s3 > 100) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_SPLIT_PERCENTAGES',
            error: 'Persentase split bagi hasil harus bertingkat (split_tier1 <= split_tier2 <= split_tier3 <= 100).',
          });
        }

        const minSample = body.min_sample ?? 40;
        if (minSample <= 0) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_MIN_SAMPLE',
            error: 'min_sample harus bilangan positif (> 0).',
          });
        }

        const windowDays = body.window_days ?? 60;
        const poolMonths = body.pool_months ?? 6;
        if (windowDays <= 0 || poolMonths <= 0) {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_WINDOW_OR_POOL',
            error: 'window_days dan pool_months harus bernilai positif (> 0).',
          });
        }

        const newPolicy = await prisma.retentionPolicy.create({
          data: {
            tenant_id: tenantId,
            window_days: body.window_days ?? 60,
            pool_months: body.pool_months ?? 6,
            benchmark_pct: body.benchmark_pct ?? 34.6,
            tier1_max_pct: body.tier1_max_pct ?? 31.1,
            tier2_max_pct: body.tier2_max_pct ?? 38.1,
            split_tier1: body.split_tier1 ?? 50,
            split_tier2: body.split_tier2 ?? 55,
            split_tier3: body.split_tier3 ?? 60,
            min_sample: body.min_sample ?? 40,
            min_tenure_months: body.min_tenure_months ?? 4,
            downgrade_periods: body.downgrade_periods ?? 2,
            soft_landing_until: body.soft_landing_until ? new Date(body.soft_landing_until) : null,
            effective_from: effectiveFromDate,
            formula_version: body.formula_version ?? 'v1',
          },
        });

        return reply.status(200).send({
          success: true,
          message: 'Policy retensi versi baru berhasil dibuat.',
          data: newPolicy,
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          success: false,
          error: err.message || 'Gagal memperbarui policy retensi.',
        });
      }
    }
  );
}

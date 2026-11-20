import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolveSessionTenantId } from './route-helpers';
import { auditService } from '../../services/audit.service';
import { VisitEvidenceService } from '../../services/visit-evidence.service';
import {
  StaffScorecardService,
  validateStaffScorecardPolicy,
} from '../../services/staff-scorecard.service';

const evidenceService = new VisitEvidenceService();
const staffScorecardService = new StaffScorecardService();

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePeriod(input: Record<string, any>): { year: number; month: number } | null {
  const wibKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const [currentYear, currentMonth] = wibKey.split('-').map(Number);

  const rawYear = input?.year;
  const rawMonth = input?.month;
  const year =
    rawYear === undefined || rawYear === null || rawYear === '' ? currentYear : Number(rawYear);
  const month =
    rawMonth === undefined || rawMonth === null || rawMonth === '' ? currentMonth : Number(rawMonth);

  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return { year, month };
}

/**
 * Policy penilaian bidan.
 * - GET  : boleh dibaca admin/CS.
 * - PUT  : hanya Super Admin (API key owner atau staff role SUPER_ADMIN).
 */
export async function staffScorecardAdminRoutes(fastify: FastifyInstance) {
  fastify.get('/api/admin/staff-scorecard/policy', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveSessionTenantId(request);
      const policy = await staffScorecardService.getPolicy(tenantId);
      return reply.send({ success: true, data: policy });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err?.message || 'Gagal memuat policy penilaian.',
      });
    }
  });

  fastify.put(
    '/api/admin/staff-scorecard/policy',
    async (request: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      const staffRole = (request as any).staffRole;
      if (staffRole && staffRole !== 'SUPER_ADMIN') {
        return reply.status(403).send({
          success: false,
          code: 'FORBIDDEN_SCORECARD_WRITE',
          error: 'Pengaturan penilaian hanya boleh diubah oleh Super Admin.',
        });
      }

      const tenantId = resolveSessionTenantId(request);
      const validation = validateStaffScorecardPolicy(request.body || {}, tenantId);
      if (!validation.valid || !validation.policy) {
        return reply.status(400).send({
          success: false,
          code: validation.code || 'INVALID_POLICY',
          error: validation.error || 'Policy tidak valid.',
        });
      }

      try {
        const created = await staffScorecardService.createPolicyVersion(tenantId, validation.policy);

        await auditService.logAdminAction({
          tenantId,
          apiKey: (request as any).adminKeyUsed || 'STAFF_SESSION',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'UPDATE_STAFF_SCORECARD_POLICY',
          targetId: created.id,
          payload: {
            weight_punctuality: created.weight_punctuality,
            weight_retention: created.weight_retention,
            weight_volume: created.weight_volume,
            tolerance_minutes: created.tolerance_minutes,
            chat_evidence_minutes: created.chat_evidence_minutes,
            target_visits_per_day: created.target_visits_per_day,
            working_days_per_month: created.working_days_per_month,
            grade_a_min: created.grade_a_min,
            grade_b_min: created.grade_b_min,
            grade_c_min: created.grade_c_min,
            grade_d_min: created.grade_d_min,
            effective_from: created.effective_from,
          },
        });

        return reply.send({ success: true, data: created });
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err?.message || 'Gagal menyimpan policy penilaian.',
        });
      }
    }
  );

  fastify.get('/api/admin/staff-scorecard/evidence', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveSessionTenantId(request);
    const query = (request.query || {}) as Record<string, any>;

    const status = String(query.status || 'NEEDS_REVIEW').toUpperCase() as
      | 'AUTO'
      | 'NEEDS_REVIEW'
      | 'APPROVED'
      | 'REJECTED';
    if (!['AUTO', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_STATUS',
        error: 'Status review tidak dikenal.',
      });
    }

    const from = parseDateOrNull(query.from);
    const to = parseDateOrNull(query.to);
    if ((query.from && !from) || (query.to && !to)) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_DATE',
        error: 'Format tanggal from/to tidak valid.',
      });
    }

    try {
      const limit = Math.min(Math.max(Number(query.limit || 20), 1), 50);
      const offset = Math.max(Number(query.offset || 0), 0);
      const onlyScored = String(query.onlyScored ?? 'false') === 'true';

      const { items, total } = await evidenceService.listForReview({
        tenantId,
        status,
        staffId: typeof query.staffId === 'string' && query.staffId ? query.staffId : null,
        from,
        to,
        limit,
        offset,
        onlyScored,
      });
      return reply.send({
        success: true,
        data: items,
        meta: { total, limit, offset },
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err?.message || 'Gagal memuat antrean verifikasi.',
      });
    }
  });

  fastify.get(
    '/api/admin/staff-scorecard/evidence/impact',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = resolveSessionTenantId(request);
      const period = parsePeriod((request.query || {}) as Record<string, any>);
      if (!period) {
        return reply.status(400).send({
          success: false,
          code: 'INVALID_PERIOD',
          error: 'Parameter year/month tidak valid.',
        });
      }

      try {
        const data = await staffScorecardService.previewPendingImpact({
          tenantId,
          year: period.year,
          month: period.month,
        });
        return reply.send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err?.message || 'Gagal menghitung preview dampak.',
        });
      }
    }
  );

  fastify.post(
    '/api/admin/staff-scorecard/evidence/:id/review',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { action?: string; note?: string } }>,
      reply: FastifyReply
    ) => {
      const evidenceId = request.params?.id;
      const body = request.body || {};
      const action = String(body.action || '').toUpperCase();

      if (action !== 'APPROVE' && action !== 'REJECT') {
        return reply.status(400).send({
          success: false,
          code: 'INVALID_ACTION',
          error: 'Aksi harus APPROVE atau REJECT.',
        });
      }

      const tenantId = resolveSessionTenantId(request);

      try {
        const result = await evidenceService.reviewEvidence({
          tenantId,
          evidenceId,
          action,
          note: body.note ?? null,
          actor: (request as any).adminIdentity || 'Admin',
        });

        if (!result.ok) {
          const code = result.code || 'INVALID_ACTION';
          const statusCode = code === 'NOT_FOUND' ? 404 : code === 'ALREADY_REVIEWED' ? 409 : 400;
          return reply.status(statusCode).send({
            success: false,
            code,
            error:
              code === 'NOT_FOUND'
                ? 'Bukti tidak ditemukan.'
                : code === 'ALREADY_REVIEWED'
                  ? 'Bukti ini sudah direview dan tidak dapat diubah.'
                  : 'Aksi tidak valid.',
          });
        }

        await auditService.logAdminAction({
          tenantId,
          apiKey: (request as any).adminKeyUsed || 'STAFF_SESSION',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'REVIEW_ARRIVAL_EVIDENCE',
          targetId: evidenceId,
          payload: {
            decision: action,
            note: body.note ?? null,
            reservationId: result.data?.reservation_id ?? null,
            source: result.data?.source ?? null,
          },
        });

        return reply.send({ success: true, data: result.data });
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err?.message || 'Gagal menyimpan keputusan verifikasi.',
        });
      }
    }
  );

  fastify.get('/api/admin/staff-scorecard/report', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveSessionTenantId(request);
    const query = (request.query || {}) as Record<string, any>;
    const period = parsePeriod(query);
    if (!period) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_PERIOD',
        error: 'Parameter year/month tidak valid.',
      });
    }

    try {
      const report = await staffScorecardService.getReport({
        tenantId,
        year: period.year,
        month: period.month,
        staffId: typeof query.staffId === 'string' && query.staffId ? query.staffId : null,
      });
      return reply.send({ success: true, data: report });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err?.message || 'Gagal menghitung raport penilaian.',
      });
    }
  });

  fastify.post('/api/admin/staff-scorecard/recalculate', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveSessionTenantId(request);
    const body = (request.body || {}) as Record<string, any>;
    const period = parsePeriod(body);
    if (!period) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_PERIOD',
        error: 'Parameter year/month tidak valid.',
      });
    }

    try {
      const report = await staffScorecardService.getReport({
        tenantId,
        year: period.year,
        month: period.month,
        staffId: typeof body.staffId === 'string' && body.staffId ? body.staffId : null,
        includeFrozen: false,
      });
      return reply.send({ success: true, data: report });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err?.message || 'Gagal menghitung ulang penilaian.',
      });
    }
  });

  fastify.post('/api/admin/staff-scorecard/snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
    const staffRole = (request as any).staffRole;
    if (staffRole && staffRole !== 'SUPER_ADMIN') {
      return reply.status(403).send({
        success: false,
        code: 'FORBIDDEN_SCORECARD_SNAPSHOT',
        error: 'Pembekuan snapshot hanya boleh dilakukan oleh Super Admin.',
      });
    }

    const tenantId = resolveSessionTenantId(request);
    const body = (request.body || {}) as Record<string, any>;
    const period = parsePeriod(body);
    if (!period) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_PERIOD',
        error: 'Parameter year/month tidak valid.',
      });
    }

    try {
      const actor = (request as any).adminIdentity || 'Admin';
      const result = await staffScorecardService.freezePeriod({
        tenantId,
        year: period.year,
        month: period.month,
        staffId: typeof body.staffId === 'string' && body.staffId ? body.staffId : null,
        actor,
      });

      await auditService.logAdminAction({
        tenantId,
        apiKey: (request as any).adminKeyUsed || 'STAFF_SESSION',
        adminIdentity: actor,
        action: 'FREEZE_STAFF_SCORECARD',
        targetId: `${period.year}-${String(period.month).padStart(2, '0')}`,
        payload: {
          year: period.year,
          month: period.month,
          staffId: body.staffId ?? null,
          written: result.written,
          skipped: result.skipped,
        },
      });

      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err?.message || 'Gagal membekukan snapshot penilaian.',
      });
    }
  });
}

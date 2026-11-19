import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolveSessionTenantId } from './route-helpers';
import { auditService } from '../../services/audit.service';
import {
  staffScorecardService,
  validateStaffScorecardPolicy,
} from '../../services/staff-scorecard.service';

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
}

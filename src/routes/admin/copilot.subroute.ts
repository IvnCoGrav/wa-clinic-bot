import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { copilotService } from '../../services/copilot/copilot.service';

/**
 * copilot.subroute.ts (Fase 6r) — endpoint AI Clinic Copilot.
 * Auth admin + tenant-scope + rate-limit (global) + audit.
 */
export async function copilotAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/copilot/chat
   * Body: { message: string, history?: Array<{role, content}> }
   */
  fastify.post(
    '/api/admin/copilot/chat',
    async (
      request: FastifyRequest<{
        Body: { message?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { message, history } = request.body || {};

      if (!message || !message.trim()) {
        return reply.status(400).send({ success: false, error: 'message wajib diisi.' });
      }
      if (message.length > 1000) {
        return reply.status(400).send({ success: false, error: 'message maksimal 1000 karakter.' });
      }

      const result = await copilotService.chat({ tenantId, message: message.trim(), history });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'AI_COPILOT_CHAT',
        targetId: tenantId,
        payload: { message: message.slice(0, 200), toolsUsed: result.toolsUsed, grounded: result.grounded, rowCounts: result.rowCounts },
        ipAddress: request.ip,
        tenantId,
      });

      return reply.status(200).send({ success: result.success, data: result });
    }
  );
}

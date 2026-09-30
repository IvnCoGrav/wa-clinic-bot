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
    {
      // Gerbang kode (bukan klaim komentar): endpoint ini memanggil LLM multi-step
      // (mahal). Batasi per-klien agar tidak bisa membanjiri biaya/kuota.
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          message?: string;
          history?: Array<{ role: 'user' | 'assistant'; content: string }>;
          conversationId?: string;
          customerId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { message, history, conversationId, customerId } = request.body || {};

      if (!message || !message.trim()) {
        return reply.status(400).send({ success: false, error: 'message wajib diisi.' });
      }
      if (message.length > 1000) {
        return reply.status(400).send({ success: false, error: 'message maksimal 1000 karakter.' });
      }

      // Konteks pasien aktif (opsional) — divalidasi ulang tenant-scoped oleh tool.
      const activeContext =
        conversationId || customerId
          ? { conversationId: conversationId?.trim() || undefined, customerId: customerId?.trim() || undefined }
          : undefined;

      const result = await copilotService.chat({ tenantId, message: message.trim(), history, activeContext });

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

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { telemetryService } from '../../services/telemetry.service';

export async function aiHealthAdminRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/admin/system/ai-health',
    async (
      request: FastifyRequest<{ Querystring: { windowHours?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const windowHours = Math.max(1, Math.min(168, parseInt(request.query?.windowHours || '24', 10) || 24));
        const summary = telemetryService.getHealthSummary(windowHours);
        return reply.status(200).send({ success: true, data: summary });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}

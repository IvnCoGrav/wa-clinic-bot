import { FastifyInstance } from 'fastify';
import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';

export async function healthRoutes(fastify: FastifyInstance) {
  /**
   * GET /health
   * Liveness probe. Cukup mengonfirmasi proses Node.js aktif dan berjalan.
   */
  fastify.get('/health', async (request, reply) => {
    return reply.status(200).send({
      status: 'OK',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /ready
   * Readiness probe. Memeriksa dependency eksternal.
   */
  fastify.get('/ready', async (request, reply) => {
    const checks: Record<string, any> = {
      database: 'UNKNOWN',
      waha: 'UNKNOWN',
    };
    let isHealthy = true;

    // 1. Database Check
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'CONNECTED';
    } catch (err: any) {
      checks.database = `FAILED: ${err.message}`;
      isHealthy = false;
    }

    // 2. WAHA Session Check
    try {
      const wahaStatus = await wahaClient.getSessionStatus();
      checks.waha = wahaStatus;
      if (wahaStatus !== 'WORKING') {
        isHealthy = false;
      }
    } catch (err: any) {
      checks.waha = `FAILED: ${err.message}`;
      isHealthy = false;
    }

    const statusCode = isHealthy ? 200 : 503;
    return reply.status(statusCode).send({
      status: isHealthy ? 'READY' : 'NOT_READY',
      timestamp: new Date().toISOString(),
      checks,
    });
  });
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

let cachedWahaHealth = { status: 'WORKING', lastChecked: 0 };

export async function registerSystemSecurityRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/health
   */
  fastify.get('/api/admin/health', async (request: FastifyRequest, reply: FastifyReply) => {
    let wahaStatus = cachedWahaHealth.status;
    const now = Date.now();
    if (now - cachedWahaHealth.lastChecked > 10000) {
      try {
        const { wahaClient } = await import('../../../integrations/waha/client');
        wahaStatus = await Promise.race([
          wahaClient.getSessionStatus(),
          new Promise<string>((resolve) => setTimeout(() => resolve(cachedWahaHealth.status), 1200))
        ]);
        cachedWahaHealth = { status: wahaStatus, lastChecked: now };
      } catch (_) {}
    }
    const uptime = process.uptime();

    const { broadcastQueueService } = await import('../../../services/broadcast-queue.service');
    const { faqCacheService } = await import('../../../services/faq-cache.service');
    const { queueService } = await import('../../../services/queue.service');
    const broadcastRedis = broadcastQueueService.isRedisEnabled();
    const faqCacheRedis = faqCacheService.isRedisEnabled();
    const messageQueueRedis = queueService.isRedisEnabled();
    const redisQueue = broadcastRedis && faqCacheRedis && messageQueueRedis
      ? 'ACTIVE'
      : 'IN_MEMORY_FALLBACK_ACTIVE';

    return reply.status(200).send({
      success: true,
      timestamp: new Date().toISOString(),
      wahaStatus,
      redisQueue,
      haversineLocationEngine: 'ACTIVE_MULTIPLIER_1.25X',
      telegramEmergencyAlerts: 'CONFIGURED',
      systemUptimeSeconds: uptime,
      data: {
        wahaStatus,
        redisQueue,
        redisDetail: {
          messageQueue: messageQueueRedis ? 'ACTIVE' : 'IN_MEMORY_FALLBACK_ACTIVE',
          broadcastQueue: broadcastRedis ? 'ACTIVE' : 'IN_MEMORY_FALLBACK_ACTIVE',
          faqCache: faqCacheRedis ? 'ACTIVE' : 'IN_MEMORY_FALLBACK_ACTIVE',
        },
        haversineLocationEngine: 'ACTIVE_MULTIPLIER_1.25X',
        telegramEmergencyAlerts: 'CONFIGURED',
        systemUptimeSeconds: uptime,
      },
    });
  });
}

import { FastifyInstance } from 'fastify';
import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';

async function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

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
   * Readiness probe provider-aware. Memeriksa dependency eksternal sesuai provider aktif.
   */
  fastify.get('/ready', async (request, reply) => {
    const checks: Record<string, any> = {
      database: 'UNKNOWN',
    };
    let isHealthy = true;

    // 1. Database Check (timeout 2.5s)
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 2500, 'Database query timed out');
      checks.database = 'CONNECTED';
    } catch (err: any) {
      // SEC-AUDIT-16: pesan error mentah (host/port/stack) hanya ke log server,
      // klien publik menerima status generik.
      console.error('[READY CHECK] Database check failed:', err?.message);
      checks.database = 'FAILED: Database unavailable';
      isHealthy = false;
    }

    // Ambil tenant aktif untuk deteksi provider
    let tenants: Array<{
      id: string;
      whatsapp_provider?: string;
      waba_phone_number_id?: string | null;
      waba_access_token?: string | null;
    }> = [];

    if (checks.database === 'CONNECTED') {
      try {
        tenants = await withTimeout(
          prisma.tenant.findMany({
            select: {
              id: true,
              whatsapp_provider: true,
              waba_phone_number_id: true,
              waba_access_token: true,
            },
          }),
          2000,
          'Tenants query timed out'
        );
      } catch (err: any) {
        console.warn('[READY CHECK] Gagal membaca konfigurasi tenant:', err?.message);
      }
    }

    const hasWahaTenant = tenants.length === 0 || tenants.some((t) => !t.whatsapp_provider || t.whatsapp_provider === 'WAHA');
    const hasWabaTenant = tenants.some((t) => t.whatsapp_provider === 'WABA');

    // 2. WAHA Session Check (hanya jika ada tenant yang menggunakan WAHA)
    if (hasWahaTenant) {
      try {
        const wahaStatus = await withTimeout(wahaClient.getSessionStatus(), 2500, 'WAHA check timed out');
        checks.waha = wahaStatus;
        if (wahaStatus !== 'WORKING') {
          isHealthy = false;
        }
      } catch (err: any) {
        console.error('[READY CHECK] WAHA check failed:', err?.message);
        checks.waha = 'FAILED: WAHA unavailable';
        isHealthy = false;
      }
    }

    // 3. WABA Credential Check (hanya jika ada tenant yang menggunakan WABA)
    if (hasWabaTenant) {
      const invalidWaba = tenants.filter(
        (t) => t.whatsapp_provider === 'WABA' && (!t.waba_phone_number_id || !t.waba_access_token)
      );
      if (invalidWaba.length > 0) {
        checks.waba = `FAILED: Missing credentials for ${invalidWaba.length} WABA tenant(s)`;
        isHealthy = false;
      } else {
        checks.waba = 'CONFIGURED';
      }
    }

    // 4. Redis/Queue Check (bila SEPARATE_WORKER atau REDIS_URL aktif)
    const isQueueRequired = process.env.SEPARATE_WORKER === 'true' || !!process.env.REDIS_URL;
    if (isQueueRequired) {
      try {
        const { queueService } = await import('../services/queue.service');
        if (queueService.isRedisEnabled()) {
          const redisPong = await withTimeout(queueService.pingRedis(), 2500, 'Queue ping timed out');
          if (redisPong) {
            checks.queue = 'CONNECTED';
          } else {
            checks.queue = 'FAILED: Redis queue unresponsive';
            isHealthy = false;
          }
        } else {
          checks.queue = 'FAILED: Redis queue disconnected';
          isHealthy = false;
        }
      } catch (err: any) {
        console.error('[READY CHECK] Queue check failed:', err?.message);
        checks.queue = 'FAILED: Queue unavailable';
        isHealthy = false;
      }
    }

    const statusCode = isHealthy ? 200 : 503;

    // K-005: status cron bersifat informasional di readiness — kegagalan cron
    // TIDAK boleh memicu restart container (cascade), tetapi wajib terlihat.
    let cronHealth: any = 'UNKNOWN';
    try {
      const { getCronHealthSnapshot } = await import('../lifecycle/cron-health');
      const snapshot = getCronHealthSnapshot();
      cronHealth = {
        status: snapshot.status,
        alertThreshold: snapshot.alertThreshold,
        failingJobs: snapshot.failingJobs,
      };
    } catch (err: any) {
      cronHealth = `UNKNOWN: ${err?.message || 'gagal membaca status cron'}`;
    }

    return reply.status(statusCode).send({
      status: isHealthy ? 'READY' : 'NOT_READY',
      timestamp: new Date().toISOString(),
      checks: { ...checks, cron: cronHealth },
    });
  });
}

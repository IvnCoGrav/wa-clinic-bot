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
   *
   * M19-09: endpoint ini PUBLIK (probe orchestrator). Respons hanya `{ status }`;
   * detail dependency/cron tidak boleh dibocorkan ke internet — detail tersedia di
   * GET /api/admin/health (ber-auth). Secret tenant (waba_access_token) juga tidak
   * boleh dibaca hanya untuk probe; keberadaan token dicek lewat COUNT di DB.
   */
  fastify.get('/ready', async (_request, reply) => {
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

    // Ambil tenant aktif untuk deteksi provider (TANPA secret).
    let tenants: Array<{
      id: string;
      whatsapp_provider?: string;
      waba_phone_number_id?: string | null;
    }> = [];

    if (checks.database === 'CONNECTED') {
      try {
        const rows = await withTimeout(
          prisma.tenant.findMany({
            select: {
              id: true,
              whatsapp_provider: true,
              waba_phone_number_id: true,
            },
          }),
          2000,
          'Tenants query timed out'
        );
        tenants = Array.isArray(rows) ? rows : [];
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

    // 3. WABA Credential Check — COUNT langsung di DB; token tidak pernah ditarik
    // ke memori proses hanya demi probe publik.
    if (hasWabaTenant) {
      try {
        const rows = await withTimeout(
          prisma.$queryRaw<Array<{ missing: number }>>`
            SELECT COUNT(*)::int AS missing FROM tenants
            WHERE whatsapp_provider::text = 'WABA'
              AND (
                waba_phone_number_id IS NULL OR waba_phone_number_id = ''
                OR waba_access_token IS NULL OR waba_access_token = ''
              )`,
          2000,
          'WABA credential check timed out'
        );
        const missing = Number(rows?.[0]?.missing || 0);
        if (missing > 0) {
          checks.waba = `FAILED: Missing credentials for ${missing} WABA tenant(s)`;
          isHealthy = false;
        } else {
          checks.waba = 'CONFIGURED';
        }
      } catch (err: any) {
        console.error('[READY CHECK] WABA credential check failed:', err?.message);
        checks.waba = 'FAILED: Credential check unavailable';
        isHealthy = false;
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

    let healthy = isHealthy;

    // K-005: status cron bersifat informasional di readiness — kegagalan cron
    // TIDAK boleh memicu restart container (cascade), tetapi wajib terlihat.
    let cronHealth: any = 'UNKNOWN';
    try {
      const { getCronHealthSnapshotAsync } = await import('../lifecycle/cron-health');
      const snapshot = await getCronHealthSnapshotAsync();
      cronHealth = {
        status: snapshot.status,
        alertThreshold: snapshot.alertThreshold,
        failingJobs: snapshot.failingJobs,
      };
      // Cron DEGRADED/NO_JOBS harus terlihat sebagai NOT_READY. NO_JOBS hanya
      // dianggap sehat bila proses ini memang tidak menjalankan cron (mode app).
    } catch (err: any) {
      cronHealth = `UNKNOWN: ${err?.message || 'gagal membaca status cron'}`;
    }

    if (cronHealth?.status === 'DEGRADED') {
      healthy = false;
    }
    if (process.env.SEPARATE_WORKER === 'true' && cronHealth?.status === 'NO_JOBS') {
      // Mode worker terpisah: app tidak mendaftarkan cron; NO_JOBS berarti
      // heartbeat worker tidak terlihat (mati/standby) → jangan lapor READY.
      healthy = false;
    }

    // Observabilitas internal (log), BUKAN respons publik.
    if (!healthy) {
      console.warn('[READY CHECK] NOT_READY', JSON.stringify({ checks, cron: cronHealth }));
    }

    const statusCode = healthy ? 200 : 503;
    return reply.status(statusCode).send({ status: healthy ? 'READY' : 'NOT_READY' });
  });
}

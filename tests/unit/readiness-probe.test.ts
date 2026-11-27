import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { healthRoutes } from '../../src/routes/health.route';
import { prisma } from '../../src/db/client';
import { wahaClient } from '../../src/integrations/waha/client';
import { queueService } from '../../src/services/queue.service';

describe('Task S2.3 — Provider-Aware Readiness Probe (/ready)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.SEPARATE_WORKER;
    delete process.env.REDIS_URL;
    app = Fastify();
    await app.register(healthRoutes);
    await app.ready();
  });

  it('mengembalikan 200 READY jika DB dan WAHA berjalan normal (mode default/WAHA)', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([1] as any);
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      { id: 'default-tenant', whatsapp_provider: 'WAHA' },
    ] as any);
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValueOnce('WORKING');

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('READY');
    // M19-09: detail dependency tidak lagi diekspos di endpoint publik.
    expect(body.checks).toBeUndefined();
  });

  it('mengembalikan 503 jika WAHA down pada tenant yang menggunakan WAHA', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([1] as any);
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      { id: 'default-tenant', whatsapp_provider: 'WAHA' },
    ] as any);
    vi.spyOn(wahaClient, 'getSessionStatus').mockRejectedValueOnce(new Error('Connection refused'));

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toEqual({ status: 'NOT_READY' });
    expect(res.payload).not.toContain('Connection refused');
  });

  it('mengembalikan 200 READY pada lingkungan WABA-only meskipun WAHA server down/mati', async () => {
    // Panggilan raw pertama: SELECT 1. Kedua: COUNT tenant WABA tanpa kredensial.
    vi.spyOn(prisma, '$queryRaw')
      .mockResolvedValueOnce([1] as any)
      .mockResolvedValueOnce([{ missing: 0 }] as any);
    // Seluruh tenant menggunakan provider WABA murni
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      {
        id: 'tenant-waba',
        whatsapp_provider: 'WABA',
        waba_phone_number_id: '10987654321',
      },
    ] as any);
    // Jika wahaClient dipanggil, dia akan throw error
    const wahaSpy = vi.spyOn(wahaClient, 'getSessionStatus').mockRejectedValue(new Error('WAHA is completely offline'));

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('READY');
    expect(body.checks).toBeUndefined();
    // Memastikan WAHA tidak pernah disentuh sama sekali saat WABA-only
    expect(wahaSpy).not.toHaveBeenCalled();
  });

  it('memeriksa ketersediaan queue jika SEPARATE_WORKER disetel true', async () => {
    process.env.SEPARATE_WORKER = 'true';
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([1] as any);
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      { id: 'default-tenant', whatsapp_provider: 'WAHA' },
    ] as any);
    // G8: heartbeat worker harus terlihat agar cron dianggap sehat.
    (prisma as any).cronJobHeartbeat = {
      findMany: vi.fn().mockResolvedValue([
        {
          job_name: 'sheets-sync',
          last_started_at: new Date(Date.now() - 60_000),
          last_finished_at: new Date(Date.now() - 30_000),
          last_status: 'SUCCESS',
          last_error: null,
          consecutive_failures: 0,
        },
      ]),
    };
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValueOnce('WORKING');
    vi.spyOn(queueService, 'isRedisEnabled').mockReturnValueOnce(true);
    const pingSpy = vi.spyOn(queueService, 'pingRedis').mockResolvedValueOnce(true);

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'READY' });
    expect(pingSpy).toHaveBeenCalled();
  });

  it('queue tidak responsif pada mode worker terpisah → 503 tanpa detail', async () => {
    process.env.SEPARATE_WORKER = 'true';
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([1] as any);
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      { id: 'default-tenant', whatsapp_provider: 'WAHA' },
    ] as any);
    (prisma as any).cronJobHeartbeat = { findMany: vi.fn().mockResolvedValue([]) };
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValueOnce('WORKING');
    vi.spyOn(queueService, 'isRedisEnabled').mockReturnValueOnce(true);
    vi.spyOn(queueService, 'pingRedis').mockResolvedValueOnce(false);

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'NOT_READY' });
  });
});

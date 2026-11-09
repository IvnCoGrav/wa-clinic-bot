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
    expect(body.checks.database).toBe('CONNECTED');
    expect(body.checks.waha).toBe('WORKING');
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
    expect(body.status).toBe('NOT_READY');
    expect(body.checks.waha).toContain('FAILED');
  });

  it('mengembalikan 200 READY pada lingkungan WABA-only meskipun WAHA server down/mati', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([1] as any);
    // Seluruh tenant menggunakan provider WABA murni
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      {
        id: 'tenant-waba',
        whatsapp_provider: 'WABA',
        waba_phone_number_id: '10987654321',
        waba_access_token: 'secret-token',
      },
    ] as any);
    // Jika wahaClient dipanggil, dia akan throw error
    const wahaSpy = vi.spyOn(wahaClient, 'getSessionStatus').mockRejectedValue(new Error('WAHA is completely offline'));

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('READY');
    expect(body.checks.database).toBe('CONNECTED');
    expect(body.checks.waba).toBe('CONFIGURED');
    expect(body.checks.waha).toBeUndefined();
    // Memastikan WAHA tidak pernah disentuh sama sekali saat WABA-only
    expect(wahaSpy).not.toHaveBeenCalled();
  });

  it('memeriksa ketersediaan queue jika SEPARATE_WORKER disetel true', async () => {
    process.env.SEPARATE_WORKER = 'true';
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([1] as any);
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValueOnce([
      { id: 'default-tenant', whatsapp_provider: 'WAHA' },
    ] as any);
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValueOnce('WORKING');
    vi.spyOn(queueService, 'isRedisEnabled').mockReturnValueOnce(true);
    vi.spyOn(queueService, 'pingRedis').mockResolvedValueOnce(true);

    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('READY');
    expect(body.checks.queue).toBe('CONNECTED');
  });
});

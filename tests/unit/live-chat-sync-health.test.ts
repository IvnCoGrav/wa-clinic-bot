import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test_admin_key_sync_health';

/**
 * GET /api/admin/live-chat/sync-health (Fase C v3) — observabilitas drift.
 * Bentuk respons wajib stabil baik saat DB online maupun offline
 * (offline → healthy:false + note, success tetap true).
 */
describe('Live Chat Sync Health Endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mengembalikan kontrakt sync-health yang stabil', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/sync-health',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.healthy).toBe('boolean');
    expect(typeof body.driftsFound).toBe('number');
    expect(body.missingWaId).toMatchObject({ total: expect.any(Number) });
    expect(body.activeSync).toBeDefined();
    expect(typeof body.checkedAt).toBe('string');
    if (!body.healthy && body.driftsFound === 0) {
      // Jalur DB offline wajib jujur via note, bukan healthy:true palsu.
      expect(typeof body.note).toBe('string');
    }
  });

  it('menolak tanpa API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/sync-health',
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});

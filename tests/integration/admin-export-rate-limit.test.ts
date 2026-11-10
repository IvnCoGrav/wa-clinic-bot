import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { queueService } from '../../src/services/queue.service';
import { FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test_admin_key_export_rl';
const ADMIN_HEADERS = { 'x-api-key': ADMIN_KEY };

describe('Admin Export Route Rate Limiting (API-12)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  it('rejects consecutive requests within debounce window (2 seconds) with 429', async () => {
    // First request should pass or proceed (may be 200 or empty result)
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/admin/export/daily-chats?date=2026-11-10',
      headers: ADMIN_HEADERS,
    });
    // First call shouldn't be 429
    expect(res1.statusCode).not.toBe(429);

    // Immediate second request within 2 seconds should be rate limited (429)
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/admin/export/daily-chats?date=2026-11-10',
      headers: ADMIN_HEADERS,
    });
    expect(res2.statusCode).toBe(429);
    const body = JSON.parse(res2.payload);
    expect(body.error).toContain('Permintaan ekspor chat terlalu sering');
  });
});

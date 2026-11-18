import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';

describe('Task 1.7: Meta Pixel Health Probe Endpoint', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_pixel_health';
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close().catch(() => {});
  });

  it('GET /api/admin/debug/meta-pixel-health mengembalikan status ok dengan rincian checks CSP dan XFO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/debug/meta-pixel-health',
      headers: {
        'x-api-key': 'test_admin_key_pixel_health',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks).toBeDefined();
    expect(body.checks.cspValid).toBe(true);
    expect(body.checks.xfoDeny).toBe(true);
    expect(body.headers['content-security-policy']).toContain('connect.facebook.net');
    expect(body.headers['x-frame-options']).toBe('DENY');
  });
});

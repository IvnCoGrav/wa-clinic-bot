import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app';

describe('Meta attribution debug endpoints (DB offline fallback)', () => {
  const app = buildApp();

  it('meta-clicks returns fallback shape when DB offline', async () => {
    process.env.ADMIN_API_KEY = 'smoke_key';
    const res = await app.inject({ method: 'GET', url: '/api/admin/debug/meta-clicks', headers: { 'x-api-key': 'smoke_key' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.entries)).toBe(true);
    expect(typeof body.data.total).toBe('number');
    expect(body.data.dbNote).toContain('DB offline');
  });

  it('meta-summary returns KPI shape when DB offline', async () => {
    process.env.ADMIN_API_KEY = 'smoke_key';
    const res = await app.inject({ method: 'GET', url: '/api/admin/debug/meta-summary', headers: { 'x-api-key': 'smoke_key' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.data.totalClicks).toBe('number');
    expect(typeof body.data.conversionRate).toBe('number');
    expect(body.data.capiHealth).toBeDefined();
    expect(body.data.capiHealth.circuitState).toBeDefined();
  });

  it('meta-capi-test returns credentials-missing response when no creds', async () => {
    process.env.ADMIN_API_KEY = 'smoke_key';
    delete process.env.FB_PIXEL_ID;
    delete process.env.FB_CAPI_ACCESS_TOKEN;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/debug/meta-capi-test',
      headers: { 'x-api-key': 'smoke_key' },
      payload: { eventName: 'Contact' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.data.pixelIdConfigured).toBe(false);
    expect(body.data.source).toBe('none');
  });

  it('meta-capi-test rejects unknown event name', async () => {
    process.env.ADMIN_API_KEY = 'smoke_key';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/debug/meta-capi-test',
      headers: { 'x-api-key': 'smoke_key' },
      payload: { eventName: 'BogusEvent' },
    });
    expect(res.statusCode).toBe(400);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/app';

/** Ar-008: WAHA webhook tanpa secret harus fail-closed kecuali diizinkan eksplisit. */
describe('WAHA webhook — fail-closed tanpa secret (Ar-008)', () => {
  const app = buildApp();
  const originalAllow = process.env.WAHA_ALLOW_UNSIGNED_WEBHOOK;

  beforeEach(() => {
    process.env.WAHA_WEBHOOK_SECRET = '';
    delete process.env.WAHA_ALLOW_UNSIGNED_WEBHOOK;
  });

  afterEach(() => {
    if (originalAllow === undefined) delete process.env.WAHA_ALLOW_UNSIGNED_WEBHOOK;
    else process.env.WAHA_ALLOW_UNSIGNED_WEBHOOK = originalAllow;
  });

  it('tanpa secret + tanpa izin → 401 (bukan diproses)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'message', session: 'default', payload: {} }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('dev eksplisit WAHA_ALLOW_UNSIGNED_WEBHOOK=true → diproses', async () => {
    process.env.WAHA_ALLOW_UNSIGNED_WEBHOOK = 'true';
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'message', session: 'default', payload: {} }),
    });
    expect(res.statusCode).not.toBe(401);
  });
});

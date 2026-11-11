import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { wabaTenantService } from '../../src/services/waba-tenant.service';

/** Ar-008: webhook WABA tanpa secret harus fail-closed, bukan hanya di production. */
describe('WABA webhook — fail-closed tanpa secret (Ar-008)', () => {
  const app = buildApp();
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const originalSecret = process.env.WABA_APP_SECRET;
  const originalAllow = process.env.WABA_ALLOW_UNSIGNED_WEBHOOK;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.WABA_APP_SECRET;
    delete process.env.WABA_ALLOW_UNSIGNED_WEBHOOK;
    vi.spyOn(wabaTenantService, 'resolveAppSecretByPhoneNumberId').mockResolvedValue('');
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.WABA_APP_SECRET;
    else process.env.WABA_APP_SECRET = originalSecret;
    if (originalAllow === undefined) delete process.env.WABA_ALLOW_UNSIGNED_WEBHOOK;
    else process.env.WABA_ALLOW_UNSIGNED_WEBHOOK = originalAllow;
  });

  it('NODE_ENV=staging tanpa secret → 401 (tidak lagi fail-open)', async () => {
    process.env.NODE_ENV = 'staging';
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('dev eksplisit WABA_ALLOW_UNSIGNED_WEBHOOK=true → diproses (200)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.WABA_ALLOW_UNSIGNED_WEBHOOK = 'true';
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });
});

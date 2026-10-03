import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/app';

/**
 * ADR-001 gerbang single-tenant di LEVEL ROUTE (end-to-end Fastify inject).
 * Membuktikan route (bukan hanya service) menolak tenant non-owner dengan 403
 * + kode deterministik SEBELUM biaya LLM, dan meloloskan owner.
 */
process.env.ADMIN_API_KEY = 'test_admin_key_copilot_gate';
const app = buildApp();

describe('POST /api/admin/copilot/chat — gerbang single-tenant route', () => {
  const key = 'test_admin_key_copilot_gate';
  const originalAllowlist = process.env.COPILOT_ALLOWED_TENANT_IDS;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = key;
  });

  afterEach(() => {
    process.env.COPILOT_ALLOWED_TENANT_IDS = originalAllowlist;
  });

  it('tenant yang tidak ada di allowlist → 403 COPILOT_TENANT_DEPRECATED', async () => {
    process.env.COPILOT_ALLOWED_TENANT_IDS = 'tenant-lain';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/copilot/chat',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      payload: { message: 'jadwal besok siapa saja?' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('COPILOT_TENANT_DEPRECATED');
  });

  it('owner (default-tenant) lolos gerbang route (bukan 403)', async () => {
    process.env.COPILOT_ALLOWED_TENANT_IDS = 'default-tenant';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/copilot/chat',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      payload: { message: 'jadwal besok siapa saja?' },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('tanpa auth → 401 (gerbang tenant tidak membuka akses anonim)', async () => {
    process.env.COPILOT_ALLOWED_TENANT_IDS = '*';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/copilot/chat',
      headers: { 'content-type': 'application/json' },
      payload: { message: 'jadwal besok' },
    });
    expect(res.statusCode).toBe(401);
  });
});

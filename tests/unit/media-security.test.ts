import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

describe('Media & Proxy Security Tests (SEC-02 & SEC-06)', () => {
  const app = buildApp();
  const superAdminKey = 'test_super_admin_key_sec_02';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = superAdminKey;
  });

  describe('1. WAHA File Proxy Authentication (SEC-02 Fix)', () => {
    it('rejects unauthenticated requests to /api/files/:session/:file with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files/default/inbound_photo_123.jpg',
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain('Unauthorized');
    });

    it('accepts authenticated requests with valid X-API-KEY header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files/default/inbound_photo_123.jpg',
        headers: { 'x-api-key': superAdminKey },
      });

      // It should pass authentication (may return 404 because file does not exist on mock, but NOT 401)
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe('2. Customer Avatar SSRF Protection (SEC-06 Fix)', () => {
    it('serves dynamic UI avatar fallback if customer is not found or url is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/media/avatar/non_existent_customer_id',
      });

      // Should return 200 image/png fallback or redirect to safe ui-avatars.com
      expect([200, 302]).toContain(res.statusCode);
    });
  });
});

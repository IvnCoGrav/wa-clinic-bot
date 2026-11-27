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
    it('menolak avatar anonim', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/media/avatar/non_existent_customer_id',
      });
      expect(res.statusCode).toBe(401);
    });

    it('fallback avatar lokal untuk customer tanpa foto (tanpa redirect pihak ketiga)', async () => {
      const { prisma } = await import('../../src/db/client');
      vi.mocked((prisma as any).customer.findUnique).mockResolvedValue({
        id: 'cust-avatar',
        tenant_id: 'default-tenant',
        name: 'Bunda Sari',
        profile_picture_url: null,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/media/avatar/cust-avatar',
        headers: { 'x-api-key': superAdminKey },
      });

      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('image/svg+xml');
      expect(res.headers['location']).toBeUndefined();
    });
  });
});

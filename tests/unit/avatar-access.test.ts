import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

describe('F3 — avatar publik menjadi terautentikasi', () => {
  const app = buildApp();
  const ADMIN_KEY = 'test_admin_key_avatar_f3';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('menolak akses anonim', async () => {
    const res = await app.inject({ method: 'GET', url: '/media/avatar/cust-1' });
    expect(res.statusCode).toBe(401);
  });

  it('customer tenant lain tidak dapat diakses lewat ?tenantId', async () => {
    vi.mocked((prisma as any).customer.findFirst).mockResolvedValue(null);
    vi.mocked((prisma as any).customer.findUnique).mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/media/avatar/cust-tenant-b?tenantId=tenant-b',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-a' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('fallback inisial dibuat lokal, tanpa nama lengkap dan tanpa redirect pihak ketiga', async () => {
    vi.mocked((prisma as any).customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      tenant_id: 'default-tenant',
      name: 'Riska Elia',
      profile_picture_url: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/media/avatar/cust-1',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('image/svg+xml');
    expect(res.headers['location']).toBeUndefined();
    expect(res.body).not.toContain('Riska');
    expect(res.body).toContain('RE');
    expect(res.headers['cache-control']).toContain('private');
  });
});

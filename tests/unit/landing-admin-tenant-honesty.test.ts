import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * M-03 + M-04 + Cfg-012 (sisa landing admin):
 * 1. Landing yang dibuat/di-list memakai tenant peminta, bukan `default-tenant`.
 * 2. Cek duplikat slug dibatasi per tenant (dua tenant boleh punya slug sama).
 * 3. Produksi: kegagalan DB TIDAK boleh dibalas `200 success` — harus 503.
 */

const adminKey = 'test_admin_key_landing_m03_m04';
const app = buildApp();
const oldNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_API_KEY = adminKey;
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.NODE_ENV = oldNodeEnv;
});

describe('landing admin tenant-aware', () => {
  it('POST membuat landing untuk tenant peminta (header), bukan default-tenant', async () => {
    const findFirst = vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);
    const create = vi.spyOn(prisma.landingPage, 'create').mockResolvedValue({
      id: 'lp-1',
      tenant_id: 'tenant-b',
      slug: 'promo-baby',
      title: 'Promo',
      landing_type: 'STRUCTURED_JSON',
      html_content: null,
      events: [],
      meta_pixel_id: null,
      whatsapp_number: null,
      is_active: true,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/landings',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
      payload: { title: 'Promo', slug: 'promo-baby' },
    });

    expect(res.statusCode).toBe(200);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'promo-baby', tenant_id: 'tenant-b' } })
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenant_id: 'tenant-b' }) })
    );
  });

  it('duplikat slug diperiksa per tenant (bukan global)', async () => {
    const findFirst = vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.landingPage, 'create').mockResolvedValue({ id: 'lp-2', slug: 'promo-baby', title: 'P' } as any);

    await app.inject({
      method: 'POST',
      url: '/api/admin/landings',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-c' },
      payload: { title: 'Promo C', slug: 'promo-baby' },
    });

    const where = (findFirst.mock.calls[0][0] as any).where;
    expect(where).toEqual({ slug: 'promo-baby', tenant_id: 'tenant-c' });
  });

  it('GET daftar landing memakai tenant peminta', async () => {
    const findMany = vi.spyOn(prisma.landingPage, 'findMany').mockResolvedValue([] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/landings',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
    });

    expect(res.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenant_id: 'tenant-b' } })
    );
  });
});

describe('landing admin jujur saat DB gagal (produksi)', () => {
  it('POST create gagal → 503, bukan 200 sukses palsu', async () => {
    vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.landingPage, 'create').mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/landings',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
      payload: { title: 'Promo', slug: 'promo-db-gagal' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('DATABASE_UNAVAILABLE');
    expect(res.json().success).toBe(false);
  });

  it('PUT update gagal → 503', async () => {
    vi.spyOn(prisma.landingPage, 'findUnique').mockResolvedValue({
      id: 'lp-1',
      tenant_id: 'tenant-b',
      slug: 'promo-baby',
      title: 'Promo',
      landing_type: 'STRUCTURED_JSON',
      html_content: null,
      events: [],
      meta_pixel_id: null,
      whatsapp_number: null,
      is_active: true,
    } as any);
    vi.spyOn(prisma.landingPage, 'update').mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/landings/lp-1',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
      payload: { title: 'Promo Baru' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('DATABASE_UNAVAILABLE');
  });

  it('DELETE gagal → 503', async () => {
    vi.spyOn(prisma.landingPage, 'findUnique').mockResolvedValue({
      id: 'lp-1',
      tenant_id: 'tenant-b',
      slug: 'promo-baby',
      title: 'Promo',
    } as any);
    vi.spyOn(prisma.landingPage, 'delete').mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/landings/lp-1',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
    });

    expect(res.statusCode).toBe(503);
  });

  it('reset landing gagal → 503', async () => {
    vi.spyOn(prisma.tenant, 'upsert').mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenant/tenant-b/landing/reset',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
    });

    expect(res.statusCode).toBe(503);
  });

  it('non-produksi tetap degraded 200 (simulator tidak putus)', async () => {
    process.env.NODE_ENV = 'test';
    vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.landingPage, 'create').mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/landings',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
      payload: { title: 'Promo', slug: 'promo-dev' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/In-Memory/i);
  });
});

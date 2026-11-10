import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { prisma } from '../../src/db/client';
import { clearScopeCache } from '../../src/services/role-scope.service';

describe('Landing Page Admin API — GET status, POST reset (offline/fallback)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    // Blank tracking env supaya purge cache (fire-and-forget) tidak mencoba jaringan
    process.env.TRACKING_API_BASE_URL = '';
    process.env.TRACKING_API_KEY = '';
    process.env.LANDING_BASE_URL = 'https://landing.example.com';
  });

  it('1. GET /api/admin/tenant/:id/landing tanpa auth harus 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/tenant/kenanga/landing' });
    expect(res.statusCode).toBe(401);
  });

  it('2. GET /api/admin/tenant/:id/landing mengembalikan status landing fail-open (DB offline → default)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenant/kenanga/landing',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe('kenanga');
    expect(body.data.landingType).toBe('STRUCTURED_JSON');
    expect(body.data.hasRawHtml).toBe(false);
    expect(body.data.rawHtmlContent).toBe('');
    expect(body.data.sizeBytes).toBe(0);
    expect(body.data.previewBaseUrl).toBe('https://landing.example.com');
  });

  it('3. POST /api/admin/tenant/:id/landing/reset tanpa auth harus 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenant/kenanga/landing/reset',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('4. POST /api/admin/tenant/:id/landing/reset mengembalikan STRUCTURED_JSON (offline fallback)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenant/kenanga/landing/reset',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.landingType).toBe('STRUCTURED_JSON');
  });

  it('5. GET previewBaseUrl jatuh ke TRACKING_API_BASE_URL kalau LANDING_BASE_URL kosong', async () => {
    process.env.LANDING_BASE_URL = '';
    process.env.TRACKING_API_BASE_URL = 'http://localhost:3000';

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenant/kenanga/landing',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    const body = JSON.parse(res.body);
    expect(body.data.previewBaseUrl).toBe('http://localhost:3000');
  });

  it('6. Upload PUT /html tetap berhasil (fallback) dan purge cache no-op saat tracking env kosong', async () => {
    const validHtml = '<html><head><title>Promo</title></head><body><a id="wa-cta" href="#">Chat WA</a></body></html>';

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/kenanga/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: validHtml },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.landingType).toBe('RAW_HTML');
  });

  it('S-010: staf tenant-a DILARANG mengunggah HTML landing tenant-b (cross-tenant)', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      id: 'sess-staff-a',
      token_hash: 'hash-staff-a',
      staff_id: 'staff-a',
      staff: {
        id: 'staff-a',
        name: 'Staff Tenant A',
        role: 'ADMIN_CS',
        tenant_id: 'tenant-a',
        is_active: true,
      },
    } as any);

    // Beri izin scope agar request mencapai handler dan yang diuji adalah guard tenant,
    // bukan fail-closed scope (dua lapis pertahanan tetap diuji terpisah).
    (prisma as any).roleApiScope = {
      findMany: vi.fn().mockResolvedValue([
        { api_prefix: '/api/admin/tenant', methods: 'GET,PUT,POST,DELETE' },
      ]),
    };
    clearScopeCache();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/tenant-b/html',
      headers: {
        cookie: 'staff_session=token-staff-a',
        'x-requested-with': 'XMLHttpRequest',
      },
      payload: { rawHtml: '<html><body>Serangan lintas cabang</body></html>' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('FORBIDDEN_TENANT_ACCESS');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('CAPI Config Admin Endpoints (Meta Pixel & CAPI)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_capi';
    process.env.WABA_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    delete process.env.FB_PIXEL_ID;
    delete process.env.FB_CAPI_ACCESS_TOKEN;
  });

  it('T1: GET returns none when tenant has no config and no env', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/capi-config',
      headers: { 'x-api-key': 'test_admin_key_capi' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.metaPixelId).toBeNull();
    expect(body.data.hasCapiAccessToken).toBe(false);
    expect(body.data.capiTokenSource).toBe('none');
  });

  it('T2: GET masks token but reports configured when DB present', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      meta_pixel_id: 'PIXEL_123',
      meta_capi_access_token: 'ENCRYPTED_TOKEN',
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/capi-config',
      headers: { 'x-api-key': 'test_admin_key_capi' },
    });

    const body = JSON.parse(res.body);
    expect(body.data.metaPixelId).toBe('PIXEL_123');
    expect(body.data.hasCapiAccessToken).toBe(true);
    expect(body.data.capiTokenSource).toBe('db');
    // Token TIDAK boleh bocor di response
    expect(res.body).not.toContain('ENCRYPTED_TOKEN');
  });

  it('T3: GET reports env fallback when tenant empty but env set', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);
    process.env.FB_PIXEL_ID = 'PIXEL_ENV';
    process.env.FB_CAPI_ACCESS_TOKEN = 'TOKEN_ENV';

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/capi-config',
      headers: { 'x-api-key': 'test_admin_key_capi' },
    });

    const body = JSON.parse(res.body);
    expect(body.data.capiTokenSource).toBe('env');
    expect(body.data.envPixelConfigured).toBe(true);
  });

  it('T4: PATCH saves pixel (plaintext) and encrypts access token', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      meta_pixel_id: null,
      meta_capi_access_token: null,
    } as any);
    vi.mocked(prisma.tenant.update).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      meta_pixel_id: 'PIXEL_456',
      meta_capi_access_token: 'ENCRYPTED_XYZ',
    } as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/capi-config',
      headers: { 'x-api-key': 'test_admin_key_capi' },
      payload: {
        metaPixelId: 'PIXEL_456',
        capiAccessToken: 'EAAsecret_capi_token',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    const updateArg = vi.mocked(prisma.tenant.update).mock.calls[0][0] as any;
    expect(updateArg.data.meta_pixel_id).toBe('PIXEL_456');
    // Token harus ter-encrypt, bukan plaintext
    expect(updateArg.data.meta_capi_access_token).not.toBe('EAAsecret_capi_token');
    expect(updateArg.data.meta_capi_access_token.length).toBeGreaterThan(40);

    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_CAPI_CONFIG' })
    );
  });

  it('T5: PATCH with null token clears the column', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      meta_pixel_id: 'PIXEL_1',
      meta_capi_access_token: 'SOME_TOKEN',
    } as any);
    vi.mocked(prisma.tenant.update).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      meta_pixel_id: 'PIXEL_1',
      meta_capi_access_token: null,
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/capi-config',
      headers: { 'x-api-key': 'test_admin_key_capi' },
      payload: { capiAccessToken: null },
    });

    expect(res.statusCode).toBe(200);
    const updateArg = vi.mocked(prisma.tenant.update).mock.calls[0][0] as any;
    expect(updateArg.data.meta_capi_access_token).toBeNull();
  });

  it('T6: GET does not throw when DB offline', async () => {
    vi.mocked(prisma.tenant.findUnique).mockRejectedValueOnce(new Error('Database offline'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/capi-config',
      headers: { 'x-api-key': 'test_admin_key_capi' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.capiTokenSource).toBe('none');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { AdminSessionService } from '../../src/services/admin-session.service';

/**
 * API-04 — tenant sesi admin adalah otoritas server.
 * Header `x-tenant-id` dari klien TIDAK boleh memindahkan sesi cookie ke tenant lain.
 */
const app = buildApp();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_API_KEY = 'test_admin_key_api04';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('API-04 tenant sesi admin', () => {
  it('cookie session tenant-b mengalahkan header tenant-a', async () => {
    vi.spyOn(AdminSessionService, 'validateSession').mockResolvedValue({
      id: 'sess-b',
      token: 'valid-cookie-token',
      adminIdentity: 'Admin B',
      tenantId: 'tenant-b',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    } as any);
    const findUnique = vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: {
        cookie: 'admin_session=valid-cookie-token',
        'x-tenant-id': 'tenant-a',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tenant-b' } })
    );
    expect(findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tenant-a' } })
    );
  });

  it('createSession menyimpan tenant pada sesi', async () => {
    vi.spyOn(prisma.adminSession, 'create').mockResolvedValue({
      id: 'sess-1',
      admin_identity: 'Admin',
      tenant_id: 'tenant-c',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 3600_000),
    } as any);

    const session = await AdminSessionService.createSession('Admin', 'tenant-c');
    expect(session.tenantId).toBe('tenant-c');
    expect(prisma.adminSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenant_id: 'tenant-c' }) })
    );
  });
});

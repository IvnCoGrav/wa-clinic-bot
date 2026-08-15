import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { prisma } from '../../src/db/client';
import * as bcryptUtil from '../../src/utils/bcrypt';

describe('Unified Login Endpoint (/api/admin/auth/login)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'super_secret_admin_key';
  });

  it('authenticates Super Admin via API Key / Password and returns super_admin role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: {
        identifier: 'admin@kalamomsspa.com',
        password: 'super_secret_admin_key',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.role).toBe('super_admin');
    expect(body.redirectTo).toBe('/admin/overview');
    expect(body.user.role).toBe('super_admin');
    expect(res.headers['set-cookie']).toContain('admin_session=');
  });

  it('authenticates Staff Terapis via Phone + Password and redirects to /admin/staff/today', async () => {
    vi.spyOn(prisma.staff, 'findFirst').mockResolvedValue({
      id: 'staff-terapis-1',
      tenant_id: 'default-tenant',
      name: 'Bidan Dewi',
      phone: '08123456789',
      password_hash: 'hashed_pw',
      role: 'THERAPIST',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);

    vi.spyOn(bcryptUtil, 'verifyPassword').mockResolvedValue(true);
    vi.spyOn(StaffAuthService, 'login').mockResolvedValue({
      token: 'valid_staff_token_xyz',
      staff: {
        id: 'staff-terapis-1',
        name: 'Bidan Dewi',
        phone: '08123456789',
        role: 'THERAPIST',
      } as any,
      expiresAt: new Date(Date.now() + 43200000),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: {
        identifier: '08123456789',
        password: 'correct_password',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.role).toBe('therapist');
    expect(body.redirectTo).toBe('/admin/staff/today');
    expect(body.user.name).toBe('Bidan Dewi');
    expect(res.headers['set-cookie']).toContain('staff_session=valid_staff_token_xyz');
  });

  it('blocks Staf Admin (ADMIN_CS) from phone login with 403 notification', async () => {
    vi.spyOn(prisma.staff, 'findFirst').mockResolvedValue({
      id: 'staff-cs-1',
      tenant_id: 'default-tenant',
      name: 'CS Sarah',
      phone: '081299998888',
      password_hash: 'hashed_pw',
      role: 'ADMIN_CS',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);

    vi.spyOn(bcryptUtil, 'verifyPassword').mockResolvedValue(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: {
        identifier: '081299998888',
        password: 'cs_password_123',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Staf Admin');
    expect(body.error).toContain('nomor HP');
  });

  it('blocks Advertiser from phone login with 403 notification', async () => {
    vi.spyOn(prisma.staff, 'findFirst').mockResolvedValue({
      id: 'staff-adv-1',
      tenant_id: 'default-tenant',
      name: 'Media Buyer Anton',
      phone: '081277776666',
      password_hash: 'hashed_pw',
      role: 'ADVERTISER',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);

    vi.spyOn(bcryptUtil, 'verifyPassword').mockResolvedValue(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: {
        identifier: '081277776666',
        password: 'adv_password_123',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Staf Admin');
    expect(body.error).toContain('nomor HP');
  });

  it('returns 401 when neither super admin key nor staff credentials match', async () => {
    vi.spyOn(prisma.staff, 'findFirst').mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: {
        identifier: 'unknown@user.com',
        password: 'wrong_password',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('salah');
  });

  it('GET /api/admin/auth/me resolves staff_session cookie', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      id: 'session-1',
      staff_id: 'staff-cs-1',
      token_hash: 'hash',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 10000),
      revoked_at: null,
      staff: {
        id: 'staff-cs-1',
        name: 'CS Sarah',
        phone: '081299998888',
        role: 'ADMIN_CS',
      } as any,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: {
        cookie: 'staff_session=some_valid_cookie_token',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.user.role).toBe('admin_cs');
    expect(body.user.name).toBe('CS Sarah');
  });
});

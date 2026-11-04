import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { staffRetentionService } from '../../src/services/staff-retention.service';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { tenantOf } from '../../src/routes/admin/route-helpers';
import { clearScopeCache } from '../../src/services/role-scope.service';
import { prisma } from '../../src/db/client';

const ADMIN_KEY = 'test-admin-key';

describe('Admin Staff Retention Route — Tenant Isolation & Auth Guards (Phase 4 Acceptance)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('passes tenantId from request header to computeForPeriod', async () => {
    const mockReport: any = {
      tenantId: 'tenant-test-b',
      periodYear: 2026,
      periodMonth: 10,
      asOf: '2026-10-31',
      windowDays: 60,
      poolStart: '2026-02-01',
      poolEnd: '2026-08-31',
      benchmarkPct: 34.6,
      status: 'DRAFT',
      formulaVersion: 'v1',
      items: [],
    };

    const spy = vi
      .spyOn(staffRetentionService, 'computeForPeriod')
      .mockResolvedValueOnce({ report: mockReport, cohort: [] });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-retention?year=2026&month=10',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': 'tenant-test-b',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      'tenant-test-b',
      2026,
      10,
      expect.objectContaining({ persist: false, status: 'DRAFT' })
    );

    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe('tenant-test-b');
  });

  it('passes tenantId to drilldown endpoint', async () => {
    const spy = vi
      .spyOn(staffRetentionService, 'getDrilldown')
      .mockResolvedValueOnce([
        {
          customerId: 'c1',
          customerName: 'Bunda Test',
          customerPhone: '628123456789',
          firstVisitDate: '2026-08-01',
          lastVisitDate: '2026-08-20',
          totalVisits: 2,
          isRetained: true,
          sameStaffVisits: 1,
          otherStaffVisits: 0,
        },
      ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-retention/drilldown?year=2026&month=10&staff_id=s1',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': 'tenant-test-b',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('tenant-test-b', 's1', 2026, 10);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].customerName).toBe('Bunda Test');
  });

  it('rejects with 401 when credentials/session is missing', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-retention?year=2026&month=10',
    });

    expect(res.statusCode).toBe(401);
  });

  it('tenantOf throws 401 TENANT_REQUIRED when tenantId is missing', () => {
    const mockReq: any = { headers: {} };
    expect(() => tenantOf(mockReq)).toThrowError(/tenantId wajib/);
  });

  it('PUT policy by non-superadmin returns 403 FORBIDDEN_STAFF_ROLE', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValueOnce({
      staff: {
        id: 'staff-123',
        tenant_id: 'default-tenant',
        name: 'Bidan Test',
        phone: '08123',
        role: 'THERAPIST',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      session: {
        id: 'sess-123',
        staff_id: 'staff-123',
        token_hash: 'hash',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
        revoked_at: null,
      },
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/staff-retention/policy',
      headers: {
        cookie: 'staff_session=valid_staff_token',
        'x-requested-with': 'XMLHttpRequest',
        'x-tenant-id': 'default-tenant',
      },
      payload: {
        effective_from: '2027-01-01',
        benchmark_pct: 35.0,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(['FORBIDDEN_STAFF_ROLE', 'FORBIDDEN_STAFF_MANAGEMENT', 'FORBIDDEN_ROLE_SCOPE']).toContain(body.code);
  });

  it('Gate 6.5: computeForPeriod with status=FINAL throws 422 when unassigned cohort exists', async () => {
    // Mock fetchVisits returning unassigned visit
    vi.spyOn(staffRetentionService, 'fetchVisits').mockResolvedValueOnce([
      { customerId: 'c_unassigned', staffId: null, visitDate: '2026-08-01' },
    ]);

    await expect(
      staffRetentionService.computeForPeriod('default-tenant', 2026, 11, {
        status: 'FINAL',
      })
    ).rejects.toThrowError(/Gate Keras 6.5 Terlanggar/);
  });

  it('rejects THERAPIST accessing main retention report with 403 FORBIDDEN_STAFF_ROLE or FORBIDDEN_ROLE_SCOPE', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValueOnce({
      staff: {
        id: 'therapist-1',
        tenant_id: 'default-tenant',
        name: 'Bidan Mawar',
        role: 'THERAPIST',
        active: true,
      },
      session: {
        id: 'sess-t1',
        staff_id: 'therapist-1',
      },
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-retention?year=2026&month=10',
      headers: {
        cookie: 'staff_session=valid_token',
        'x-requested-with': 'XMLHttpRequest',
        'x-tenant-id': 'default-tenant',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(['FORBIDDEN_STAFF_ROLE', 'FORBIDDEN_ROLE_SCOPE']).toContain(body.code);
  });

  it('rejects THERAPIST accessing drilldown of another staff with 403 FORBIDDEN_STAFF_ROLE', async () => {
    clearScopeCache();
    (prisma as any).roleApiScope = {
      findMany: vi.fn().mockResolvedValue([
        { api_prefix: '/api/admin/staff-retention/drilldown', methods: 'GET' },
      ]),
    };

    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValueOnce({
      staff: {
        id: 'therapist-1',
        tenant_id: 'default-tenant',
        name: 'Bidan Mawar',
        role: 'THERAPIST',
        active: true,
      },
      session: {
        id: 'sess-t1',
        staff_id: 'therapist-1',
      },
    } as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-retention/drilldown?year=2026&month=10&staff_id=therapist-2',
      headers: {
        cookie: 'staff_session=valid_token',
        'x-requested-with': 'XMLHttpRequest',
        'x-tenant-id': 'default-tenant',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('FORBIDDEN_STAFF_ROLE');
  });

  it('allows THERAPIST accessing drilldown of own cohort', async () => {
    clearScopeCache();
    (prisma as any).roleApiScope = {
      findMany: vi.fn().mockResolvedValue([
        { api_prefix: '/api/admin/staff-retention/drilldown', methods: 'GET' },
      ]),
    };

    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValueOnce({
      staff: {
        id: 'therapist-1',
        tenant_id: 'default-tenant',
        name: 'Bidan Mawar',
        role: 'THERAPIST',
        active: true,
      },
      session: {
        id: 'sess-t1',
        staff_id: 'therapist-1',
      },
    } as any);

    vi.spyOn(staffRetentionService, 'getDrilldown').mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-retention/drilldown?year=2026&month=10&staff_id=therapist-1',
      headers: {
        cookie: 'staff_session=valid_token',
        'x-requested-with': 'XMLHttpRequest',
        'x-tenant-id': 'default-tenant',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
  });

  it('Gate Fail-Safe: computeForPeriod with status=FINAL throws 422 when policy is unconfigured/db_empty', async () => {
    vi.spyOn(staffRetentionService, 'getPolicy').mockResolvedValueOnce({
      ...staffRetentionService['prisma'] as any,
      tenant_id: 'default-tenant',
      window_days: 60,
      pool_months: 6,
      benchmark_pct: 34.6,
      tier1_max_pct: 31.1,
      tier2_max_pct: 38.1,
      split_tier1: 50,
      split_tier2: 55,
      split_tier3: 60,
      min_sample: 40,
      min_tenure_months: 4,
      downgrade_periods: 2,
      soft_landing_until: null,
      effective_from: new Date(),
      formula_version: 'v1',
      is_fallback: true,
      db_empty: true,
    });

    await expect(
      staffRetentionService.computeForPeriod('default-tenant', 2026, 11, {
        status: 'FINAL',
      })
    ).rejects.toThrowError(/Pembekuan snapshot FINAL dilarang sebelum tabel retention_policies/);
  });
});

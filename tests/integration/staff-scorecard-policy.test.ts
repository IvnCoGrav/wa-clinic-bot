import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/role-scope.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/role-scope.service')>();
  return {
    ...actual,
    isApiScopeAllowed: vi.fn().mockResolvedValue({ allowed: true, managed: false }),
  };
});

import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { StaffAuthService } from '../../src/services/staff-auth.service';

const VALID_BODY = {
  weight_punctuality: 50,
  weight_retention: 30,
  weight_volume: 20,
  tolerance_minutes: 30,
  chat_evidence_minutes: 30,
  target_visits_per_day: 3,
  working_days_per_month: 26,
  min_sample_punctuality: 10,
  min_sample_retention: 40,
  min_tenure_months: 4,
  grade_a_min: 90,
  grade_b_min: 75,
  grade_c_min: 60,
  grade_d_min: 40,
  effective_from: '2026-11-20T00:00:00+07:00',
};

describe('Staff Scorecard Policy (F3)', () => {
  const app = buildApp();
  const ADMIN_KEY = 'test_admin_key_scorecard';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    (prisma.staffScorecardPolicy.findFirst as any).mockReset();
    (prisma.staffScorecardPolicy.findFirst as any).mockRejectedValue(
      new Error('Database offline')
    );
    (prisma.staffScorecardPolicy.create as any).mockReset();
    (prisma.staffScorecardPolicy.create as any).mockRejectedValue(
      new Error('Database offline')
    );
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
  });

  it('GET policy saat DB offline mengembalikan default, bukan 500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/policy',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.is_fallback).toBe(true);
    expect(body.data.weight_punctuality).toBe(50);
    expect(body.data.weight_retention).toBe(30);
    expect(body.data.weight_volume).toBe(20);
  });

  it('PUT policy valid menyimpan versi baru dan mencatat audit', async () => {
    (prisma.staffScorecardPolicy.create as any).mockImplementation((args: any) =>
      Promise.resolve({
        id: 'policy-1',
        ...args.data,
        created_at: new Date(),
        updated_at: new Date(),
      })
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/staff-scorecard/policy',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('policy-1');

    expect(prisma.staffScorecardPolicy.create).toHaveBeenCalledTimes(1);
    const createArg = (prisma.staffScorecardPolicy.create as any).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      tenant_id: 'default-tenant',
      weight_punctuality: 50,
      weight_retention: 30,
      weight_volume: 20,
      formula_version: 'v1',
    });

    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE_STAFF_SCORECARD_POLICY',
        targetId: 'policy-1',
      })
    );
  });

  it('PUT bobot total 90 ditolak 400 dan tidak menulis apa pun', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/staff-scorecard/policy',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { ...VALID_BODY, weight_volume: 10 },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('INVALID_WEIGHTS');
    expect(prisma.staffScorecardPolicy.create).not.toHaveBeenCalled();
    expect(auditService.logAdminAction).not.toHaveBeenCalled();
  });

  it('PUT ambang grade tidak menurun ditolak 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/staff-scorecard/policy',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { ...VALID_BODY, grade_a_min: 60 },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('INVALID_GRADE_THRESHOLDS');
    expect(prisma.staffScorecardPolicy.create).not.toHaveBeenCalled();
  });

  it('PUT oleh ADMIN_CS ditolak 403', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      staff: {
        id: 'cs1',
        name: 'CS',
        role: 'ADMIN_CS',
        active: true,
        tenant_id: 'default-tenant',
      },
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: null,
    } as any);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/staff-scorecard/policy',
      headers: {
        cookie: 'staff_session=cs',
        'x-requested-with': 'XMLHttpRequest',
      },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
    expect(prisma.staffScorecardPolicy.create).not.toHaveBeenCalled();
  });

  it('GET policy tetap boleh untuk ADMIN_CS', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      staff: {
        id: 'cs1',
        name: 'CS',
        role: 'ADMIN_CS',
        active: true,
        tenant_id: 'default-tenant',
      },
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: null,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/policy',
      headers: {
        cookie: 'staff_session=cs',
        'x-requested-with': 'XMLHttpRequest',
      },
    });

    expect(res.statusCode).toBe(200);
  });
});

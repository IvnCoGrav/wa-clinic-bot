import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/role-scope.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/role-scope.service')>();
  return {
    ...actual,
    isApiScopeAllowed: vi.fn().mockResolvedValue({ allowed: true, managed: false }),
  };
});

import { buildApp } from '../../src/app';
import { auditService } from '../../src/services/audit.service';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { StaffScorecardService } from '../../src/services/staff-scorecard.service';
import { isApiScopeAllowed } from '../../src/services/role-scope.service';

const ADMIN_KEY = 'test_admin_key_scorecard_report';

const POLICY = {
  id: 'policy-1',
  tenant_id: 'default-tenant',
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
  formula_version: 'v1',
  effective_from: new Date('2026-01-01T00:00:00.000Z'),
  effective_to: null,
};

const ITEM = {
  staffId: 'staff-thabita',
  staffName: 'Bidan Thabita',
  periodYear: 2026,
  periodMonth: 11,
  punctuality: {
    pct: 19.4,
    onTime: 6,
    lateMeasured: 7,
    chatLate: 18,
    unknown: 6,
    assessed: 31,
    total: 37,
    status: 'OK',
  },
  retention: {
    pct: null,
    eligible: false,
    status: 'SKIPPED:TENURE',
    cohortN: 0,
    retainedN: 0,
    benchmarkPct: 34.6,
  },
  volume: { pct: 74.9, visits: 37, target: 49.4 },
  coveragePct: 83.8,
  score: 35.3,
  grade: 'E',
  usedWeights: { punctuality: 71.4, retention: 0, volume: 28.6 },
  excluded: ['retention'],
  status: 'PREVIEW',
  computedAt: '2026-11-20T00:00:00.000Z',
};

const REPORT = {
  tenantId: 'default-tenant',
  periodYear: 2026,
  periodMonth: 11,
  policy: POLICY,
  items: [ITEM],
};

function staffSession(role: string) {
  return {
    id: 'session-1',
    token_hash: 'hash',
    staff_id: `staff-${role.toLowerCase()}`,
    expires_at: new Date(Date.now() + 3_600_000),
    revoked_at: null,
    created_at: new Date(),
    staff: {
      id: `staff-${role.toLowerCase()}`,
      name: `Staf ${role}`,
      phone: '08123456789',
      role,
      active: true,
      tenant_id: 'default-tenant',
    },
  } as any;
}

describe('Scorecard Report Admin (F5 endpoints + F8 review UI)', () => {
  const app = buildApp();
  let reportSpy: ReturnType<typeof vi.spyOn>;
  let freezeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // restoreAllMocks mencabut implementasi vi.fn() dari vi.mock — pasang ulang.
    (isApiScopeAllowed as any).mockResolvedValue({ allowed: true, managed: false });
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.SCORECARD_STAFF_UI_ENABLED = 'true';

    reportSpy = vi
      .spyOn(StaffScorecardService.prototype, 'getReport')
      .mockResolvedValue(REPORT as any);
    freezeSpy = vi.spyOn(StaffScorecardService.prototype, 'freezePeriod').mockResolvedValue({
      written: 1,
      skipped: 0,
      items: [ITEM as any],
    });
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
  });

  it('GET report mengembalikan nilai + policy untuk periode yang diminta', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/report?year=2026&month=11',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      staffName: 'Bidan Thabita',
      grade: 'E',
      status: 'PREVIEW',
      coveragePct: 83.8,
    });
    expect(body.data.policy.weight_punctuality).toBe(50);
    expect(reportSpy.mock.calls[0][0]).toMatchObject({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
    });
  });

  it('GET report menolak bulan tidak valid (400) tanpa memanggil agregasi', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/report?year=2026&month=0',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_PERIOD');
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('POST recalculate memaksa hitung ulang (includeFrozen=false)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/recalculate',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { year: 2026, month: 11 },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.items[0].grade).toBe('E');
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'default-tenant',
        year: 2026,
        month: 11,
        includeFrozen: false,
      })
    );
  });

  it('POST snapshot membekukan nilai dan mencatat audit FREEZE_STAFF_SCORECARD', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/snapshot',
      headers: { 'x-api-key': ADMIN_KEY, 'x-admin-identity': 'Owner Klinik' },
      payload: { year: 2026, month: 11 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toMatchObject({ written: 1, skipped: 0 });
    expect(freezeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'default-tenant',
        year: 2026,
        month: 11,
        actor: 'Owner Klinik',
      })
    );
    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FREEZE_STAFF_SCORECARD',
        targetId: '2026-11',
        payload: expect.objectContaining({ written: 1, skipped: 0 }),
      })
    );
  });

  it('POST snapshot menolak sesi admin non-SUPER_ADMIN (403)', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(staffSession('ADMIN_CS'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/snapshot',
      headers: { cookie: 'staff_session=valid', 'x-requested-with': 'XMLHttpRequest' },
      payload: { year: 2026, month: 11 },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('FORBIDDEN_SCORECARD_SNAPSHOT');
    expect(freezeSpy).not.toHaveBeenCalled();
  });

  it('POST snapshot mengizinkan SUPER_ADMIN', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(staffSession('SUPER_ADMIN'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/snapshot',
      headers: { cookie: 'staff_session=valid', 'x-requested-with': 'XMLHttpRequest' },
      payload: { year: 2026, month: 11 },
    });

    expect(res.statusCode).toBe(200);
    expect(freezeSpy).toHaveBeenCalledTimes(1);
  });

  it('POST snapshot menolak periode tidak valid (400) tanpa membekukan', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/snapshot',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { year: 2026, month: 99 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_PERIOD');
    expect(freezeSpy).not.toHaveBeenCalled();
  });

  it('error agregasi dilaporkan 500 dengan pesan asli', async () => {
    reportSpy.mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/report?year=2026&month=11',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: 'Database offline' });
  });
});

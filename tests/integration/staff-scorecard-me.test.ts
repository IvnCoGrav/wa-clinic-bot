import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { StaffScorecardService } from '../../src/services/staff-scorecard.service';
import { staffRetentionService } from '../../src/services/staff-retention.service';

const SESSION = {
  id: 'session-1',
  token_hash: 'hash',
  staff_id: 'staff-thabita',
  expires_at: new Date(Date.now() + 3_600_000),
  revoked_at: null,
  created_at: new Date(),
  staff: {
    id: 'staff-thabita',
    name: 'Bidan Thabita',
    phone: '08123456789',
    role: 'THERAPIST',
    active: true,
    tenant_id: 'tenant-a',
  },
} as any;

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

const POLICY = {
  id: 'policy-1',
  tenant_id: 'tenant-a',
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

describe('GET /api/staff/scorecard/me (F6)', () => {
  const app = buildApp();
  let reportSpy: ReturnType<typeof vi.spyOn>;
  let policySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_scorecard_staff';

    reportSpy = vi.spyOn(StaffScorecardService.prototype, 'getReport').mockResolvedValue({
      tenantId: 'tenant-a',
      periodYear: 2026,
      periodMonth: 11,
      policy: POLICY as any,
      items: [ITEM as any],
    });
    policySpy = vi.spyOn(staffRetentionService, 'getPolicy').mockResolvedValue({
      window_days: 60,
      benchmark_pct: 34.6,
      min_sample: 40,
      min_tenure_months: 4,
      formula_version: 'v1',
    } as any);
  });

  it('menolak permintaan tanpa sesi staff (401)', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/scorecard/me',
      headers: { cookie: 'staff_session=invalid' },
    });

    expect(res.statusCode).toBe(401);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('memakai staffId dari sesi, bukan dari query (anti-IDOR)', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(SESSION);

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/scorecard/me?staffId=staff-lain&year=2026&month=11',
      headers: { cookie: 'staff_session=valid' },
    });

    expect(res.statusCode).toBe(200);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-a',
      year: 2026,
      month: 11,
      staffId: 'staff-thabita',
    });
  });

  it('mengembalikan bentuk data raport lengkap untuk dashboard', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(SESSION);

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/scorecard/me',
      headers: { cookie: 'staff_session=valid' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.period).toEqual({ year: expect.any(Number), month: expect.any(Number) });
    expect(body.data.item).toMatchObject({
      staffId: 'staff-thabita',
      grade: 'E',
      coveragePct: 83.8,
      status: 'PREVIEW',
    });
    expect(body.data.included).toBe(true);
    expect(body.data.item.punctuality).toMatchObject({ pct: 19.4, chatLate: 18, unknown: 6 });
    expect(body.data.item.retention).toMatchObject({ eligible: false, status: 'SKIPPED:TENURE' });
    expect(body.data.policy).toMatchObject({ weight_punctuality: 50, tolerance_minutes: 30 });
    expect(body.data.retentionPolicy).toMatchObject({
      benchmark_pct: 34.6,
      min_sample: 40,
      min_tenure_months: 4,
    });
  });

  it('menolak periode tidak valid (400) tanpa memanggil agregasi', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(SESSION);

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/scorecard/me?year=2026&month=13',
      headers: { cookie: 'staff_session=valid' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_PERIOD');
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('item null bila staff belum punya data (tidak error)', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(SESSION);
    reportSpy.mockResolvedValue({
      tenantId: 'tenant-a',
      periodYear: 2026,
      periodMonth: 11,
      policy: POLICY as any,
      items: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/scorecard/me',
      headers: { cookie: 'staff_session=valid' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.item).toBeNull();
    expect(JSON.parse(res.body).data.included).toBe(false);
  });

  it('mengembalikan 500 dengan pesan jelas saat agregasi gagal', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(SESSION);
    reportSpy.mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/scorecard/me',
      headers: { cookie: 'staff_session=valid' },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: 'Database offline' });
    // Policy retensi tidak perlu diambil bila agregasi utama sudah gagal.
    expect(policySpy).not.toHaveBeenCalled();
  });
});

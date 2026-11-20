import { describe, it, expect, vi } from 'vitest';
import { StaffScorecardService } from '../../src/services/staff-scorecard.service';

const POLICY = {
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
};

function item(overrides: Record<string, any>) {
  return {
    staffId: 'staff-thabita',
    staffName: 'Bidan Thabita',
    periodYear: 2026,
    periodMonth: 11,
    punctuality: {
      pct: 50,
      onTime: 7,
      lateMeasured: 7,
      chatLate: 0,
      unknown: 24,
      assessed: 14,
      total: 38,
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
    volume: { pct: 73.1, visits: 38, target: 52 },
    coveragePct: 36.8,
    score: 56.6,
    grade: 'D',
    usedWeights: { punctuality: 71.4, retention: 0, volume: 28.6 },
    excluded: ['retention'],
    status: 'PREVIEW',
    computedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

const HANIFAH = item({
  staffId: 'staff-hanifah',
  staffName: 'Bidan Hanifah',
  punctuality: {
    pct: 71.4,
    onTime: 5,
    lateMeasured: 2,
    chatLate: 0,
    unknown: 2,
    assessed: 7,
    total: 9,
    status: 'OK',
  },
  volume: { pct: 17.3, visits: 9, target: 52 },
  coveragePct: 77.8,
  score: 17.3,
  grade: 'E',
});

const CINDY = item({
  staffId: 'staff-cindy',
  staffName: 'Bidan Cindy',
  punctuality: {
    pct: null,
    onTime: 0,
    lateMeasured: 0,
    chatLate: 0,
    unknown: 0,
    assessed: 0,
    total: 0,
    status: 'INSUFFICIENT_SAMPLE',
  },
  volume: { pct: 0, visits: 0, target: 52 },
  coveragePct: 0,
  score: 0,
  grade: 'E',
});

function buildPrisma(pendingRows: any[]) {
  return {
    visitArrivalEvidence: { findMany: vi.fn().mockResolvedValue(pendingRows) },
  };
}

describe('StaffScorecardService.previewPendingImpact', () => {
  it('menghitung dampak approval: Thabita 18 pending → ketepatan 21,9% dan grade E', async () => {
    const prisma = buildPrisma([
      ...Array.from({ length: 18 }, (_, index) => ({
        reservation_id: `res-t-${index}`,
        reservation: { assigned_staff_id: 'staff-thabita' },
      })),
      { reservation_id: 'res-h-1', reservation: { assigned_staff_id: 'staff-hanifah' } },
    ]);
    const service = new StaffScorecardService(prisma as any, {} as any);
    vi.spyOn(service, 'getReport').mockResolvedValue({
      tenantId: 'default-tenant',
      periodYear: 2026,
      periodMonth: 11,
      policy: POLICY as any,
      items: [item({}), HANIFAH, CINDY] as any,
    });

    const result = await service.previewPendingImpact({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: new Date('2026-11-20T05:00:00Z'),
    });

    const thabita = result.find((row) => row.staffId === 'staff-thabita')!;
    expect(thabita.pending).toBe(18);
    expect(thabita.current).toMatchObject({ punctualityPct: 50, grade: 'D', coveragePct: 36.8 });
    expect(thabita.projected).toMatchObject({
      punctualityPct: 21.9,
      coveragePct: 84.2,
      grade: 'E',
    });

    const hanifah = result.find((row) => row.staffId === 'staff-hanifah')!;
    expect(hanifah.pending).toBe(1);
    expect(hanifah.projected.punctualityPct).toBe(62.5);
    expect(hanifah.projected.coveragePct).toBe(88.9);

    const cindy = result.find((row) => row.staffId === 'staff-cindy')!;
    expect(cindy.pending).toBe(0);
    expect(cindy.projected).toEqual(cindy.current);
  });

  it('query hanya mengambil kandidat CHAT yang belum tiba & di atas ambang', async () => {
    const prisma = buildPrisma([]);
    const service = new StaffScorecardService(prisma as any, {} as any);
    vi.spyOn(service, 'getReport').mockResolvedValue({
      tenantId: 'default-tenant',
      periodYear: 2026,
      periodMonth: 11,
      policy: POLICY as any,
      items: [item({})] as any,
    });

    await service.previewPendingImpact({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: new Date('2026-11-20T05:00:00Z'),
    });

    const where = (prisma.visitArrivalEvidence.findMany as any).mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenant_id: 'default-tenant',
      source: 'CHAT',
      review_status: 'NEEDS_REVIEW',
      observed_minutes: { gt: 30 },
      reservation: { status: 'completed', arrived_at: null },
    });
    expect(where.reservation.booking_date.gte).toBeInstanceOf(Date);
    expect(where.reservation.booking_date.lt).toBeInstanceOf(Date);
  });

  it('gagal baca bukti tidak membuat preview error (pending 0)', async () => {
    const prisma = {
      visitArrivalEvidence: {
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
    };
    const service = new StaffScorecardService(prisma as any, {} as any);
    vi.spyOn(service, 'getReport').mockResolvedValue({
      tenantId: 'default-tenant',
      periodYear: 2026,
      periodMonth: 11,
      policy: POLICY as any,
      items: [item({})] as any,
    });

    const result = await service.previewPendingImpact({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: new Date('2026-11-20T05:00:00Z'),
    });

    expect(result[0].pending).toBe(0);
    expect(result[0].projected).toEqual(result[0].current);
  });
});

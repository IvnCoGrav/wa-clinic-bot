import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveScorecardPeriod,
  StaffScorecardService,
} from '../../src/services/staff-scorecard.service';

const NOW = new Date('2026-11-19T05:00:00.000Z'); // 12:00 WIB
const BOOKING = new Date('2026-11-10T03:00:00.000Z');

function buildReservations() {
  const rows: any[] = [];
  for (let i = 0; i < 6; i += 1) {
    rows.push({
      id: `r-on-${i}`,
      booking_date: BOOKING,
      arrived_at: new Date(BOOKING.getTime() + 10 * 60_000),
    });
  }
  for (let i = 0; i < 7; i += 1) {
    rows.push({
      id: `r-late-${i}`,
      booking_date: BOOKING,
      arrived_at: new Date(BOOKING.getTime() + 60 * 60_000),
    });
  }
  for (let i = 0; i < 24; i += 1) {
    rows.push({ id: `r-unknown-${i}`, booking_date: BOOKING, arrived_at: null });
  }
  return rows;
}

function buildEvidence() {
  const rows: any[] = [];
  for (let i = 0; i < 18; i += 1) {
    rows.push({
      reservation_id: `r-unknown-${i}`,
      observed_minutes: 40,
    });
  }
  return rows;
}

function buildPrisma() {
  return {
    staff: { findMany: vi.fn().mockResolvedValue([{ id: 's1', name: 'Bidan Thabita' }]) },
    reservation: { findMany: vi.fn().mockResolvedValue(buildReservations()) },
    visitArrivalEvidence: { findMany: vi.fn().mockResolvedValue(buildEvidence()) },
    staffScorecardPolicy: {
      findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
    },
    staffScorecardSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

function buildRetention(status = 'SKIPPED', retentionPct: number | null = 14.3) {
  return {
    computeForPeriod: vi.fn().mockResolvedValue({
      report: {
        items: [
          {
            staffId: 's1',
            staffName: 'Bidan Thabita',
            cohortN: 21,
            retainedN: 3,
            retentionPct,
            benchmarkPct: 34.6,
            status,
            skipReason: status === 'OK' ? null : 'TENURE',
          },
        ],
      },
    }),
  };
}

describe('StaffScorecardService — agregasi', () => {
  let prisma: any;
  let retention: any;
  let service: StaffScorecardService;

  beforeEach(() => {
    prisma = buildPrisma();
    retention = buildRetention();
    service = new StaffScorecardService(prisma, retention);
  });

  it('menghitung ketepatan, volume, dan mengecualikan retensi yang belum layak', async () => {
    const report = await service.getReport({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: NOW,
    });

    expect(report.items).toHaveLength(1);
    const item = report.items[0];

    expect(item.punctuality).toMatchObject({
      pct: 19.4,
      onTime: 6,
      lateMeasured: 7,
      chatLate: 18,
      unknown: 6,
      assessed: 31,
      total: 37,
      status: 'OK',
    });
    expect(item.volume.pct).toBe(74.9);
    expect(item.volume.target).toBe(49.4);
    expect(item.retention.eligible).toBe(false);
    expect(item.retention.status).toBe('SKIPPED:TENURE');
    expect(item.coveragePct).toBe(83.8);
    expect(item.excluded).toEqual(['retention']);
    expect(item.usedWeights).toEqual({ punctuality: 71.4, retention: 0, volume: 28.6 });
    expect(item.score).toBe(35.3);
    expect(item.grade).toBe('E');
    expect(item.status).toBe('PREVIEW');
  });

  it('hanya menghitung bukti chat yang sudah APPROVED', async () => {
    prisma.visitArrivalEvidence.findMany.mockResolvedValue([
      { reservation_id: 'r-unknown-0', observed_minutes: 40 },
    ]);

    const report = await service.getReport({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: NOW,
    });

    expect(report.items[0].punctuality.chatLate).toBe(1);
    expect(report.items[0].punctuality.unknown).toBe(23);
  });

  it('menyertakan retensi saat policy kanonis menyatakan OK', async () => {
    retention = buildRetention('OK', 30);
    service = new StaffScorecardService(prisma, retention);

    const report = await service.getReport({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: NOW,
    });

    const item = report.items[0];
    expect(item.retention.eligible).toBe(true);
    expect(item.excluded).toEqual([]);
    expect(item.usedWeights).toEqual({ punctuality: 50, retention: 30, volume: 20 });
  });

  it('snapshot FINAL dipakai apa adanya tanpa hitung ulang', async () => {
    prisma.staffScorecardSnapshot.findMany.mockResolvedValue([
      {
        staff_id: 's1',
        staff_name: 'Bidan Thabita',
        period_year: 2026,
        period_month: 11,
        status: 'FINAL',
        punctuality_pct: 19.4,
        retention_pct: null,
        volume_pct: 74.9,
        weighted_score: 35.3,
        grade: 'E',
        coverage_pct: 83.8,
        measured_n: 13,
        chat_late_n: 18,
        unknown_n: 6,
        computed_at: new Date('2026-11-20T00:00:00Z'),
      },
    ]);

    const report = await service.getReport({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: NOW,
    });

    expect(report.items[0].status).toBe('FINAL');
    expect(report.items[0].grade).toBe('E');
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });

  it('freeze tidak menimpa snapshot FINAL yang sudah ada', async () => {
    prisma.staffScorecardSnapshot.findUnique.mockResolvedValue({ status: 'FINAL' });

    const result = await service.freezePeriod({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      actor: 'Admin',
    });

    expect(result).toEqual({ written: 0, skipped: 1, items: expect.any(Array) });
    expect(prisma.staffScorecardSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('freeze menulis snapshot FINAL saat belum ada', async () => {
    const result = await service.freezePeriod({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      actor: 'Admin',
    });

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);
    expect(prisma.staffScorecardSnapshot.upsert).toHaveBeenCalledTimes(1);

    const payload = prisma.staffScorecardSnapshot.upsert.mock.calls[0][0];
    expect(payload.create).toMatchObject({
      tenant_id: 'default-tenant',
      staff_id: 's1',
      period_year: 2026,
      period_month: 11,
      status: 'FINAL',
      grade: 'E',
      measured_n: 13,
      chat_late_n: 18,
      unknown_n: 6,
      computed_by: 'Admin',
    });
    expect(payload.create.retention_pct).toBeNull();
  });
});

describe('resolveScorecardPeriod', () => {
  it('menghitung hari berjalan untuk bulan ini', () => {
    const period = resolveScorecardPeriod(2026, 11, NOW);
    expect(period.daysInMonth).toBe(30);
    expect(period.periodDays).toBe(19);
    expect(period.isCurrentMonth).toBe(true);
  });

  it('bulan lampau memakai seluruh hari', () => {
    const period = resolveScorecardPeriod(2026, 10, NOW);
    expect(period.periodDays).toBe(31);
    expect(period.isCurrentMonth).toBe(false);
  });

  it('bulan depan belum punya hari berjalan', () => {
    const period = resolveScorecardPeriod(2026, 12, NOW);
    expect(period.periodDays).toBe(0);
  });
});

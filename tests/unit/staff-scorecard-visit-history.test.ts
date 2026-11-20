import { describe, it, expect, vi } from 'vitest';
import { StaffScorecardService } from '../../src/services/staff-scorecard.service';

const NOW = new Date('2026-11-20T05:00:00Z');
const PERIOD_BOOKING = new Date('2026-11-05T03:00:00Z');

const PERIOD_RESERVATIONS = [
  {
    id: 'r1',
    booking_date: PERIOD_BOOKING,
    arrived_at: new Date(PERIOD_BOOKING.getTime() + 10 * 60_000),
    customer: { name: 'Bunda Satu' },
  },
  {
    id: 'r2',
    booking_date: new Date('2026-11-06T03:00:00Z'),
    arrived_at: null,
    customer: { name: 'Bunda Dua' },
  },
  {
    id: 'r3',
    booking_date: new Date('2026-11-07T03:00:00Z'),
    arrived_at: new Date('2026-11-07T04:00:00Z'),
    customer: { name: 'Bunda Tiga' },
  },
];

const HISTORY_ROWS = [
  { id: 'h1', customer_id: 'c1', booking_date: new Date('2026-10-10T03:00:00Z'), assigned_staff_id: 's1' },
  { id: 'r1', customer_id: 'c1', booking_date: new Date('2026-11-05T03:00:00Z'), assigned_staff_id: 's1' },
  { id: 'h2', customer_id: 'c2', booking_date: new Date('2026-10-12T03:00:00Z'), assigned_staff_id: 's2' },
  { id: 'r2', customer_id: 'c2', booking_date: new Date('2026-11-06T03:00:00Z'), assigned_staff_id: 's1' },
  { id: 'r3', customer_id: 'c3', booking_date: new Date('2026-11-07T03:00:00Z'), assigned_staff_id: 's1' },
];

function buildPrisma() {
  const findMany = vi.fn(async (args: any) => {
    const where = args?.where || {};
    if (where.customer_id?.in) return HISTORY_ROWS;
    if (where.assigned_staff_id?.in) {
      return [{ customer_id: 'c1' }, { customer_id: 'c2' }, { customer_id: 'c3' }];
    }
    if (where.assigned_staff_id === 's1') return PERIOD_RESERVATIONS;
    return [];
  });

  return {
    staff: { findMany: vi.fn().mockResolvedValue([{ id: 's1', name: 'Bidan Thabita' }]) },
    reservation: {
      findMany,
      groupBy: vi.fn().mockResolvedValue([
        { assigned_staff_id: 's1', _count: { _all: 9 } },
      ]),
    },
    staffScorecardPolicy: {
      findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
    },
    staffScorecardSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    visitArrivalEvidence: {
      findMany: vi.fn().mockResolvedValue([
        { reservation_id: 'r2', observed_minutes: 45 },
      ]),
    },
  };
}

function buildRetention() {
  return {
    computeForPeriod: vi.fn().mockResolvedValue({
      report: {
        items: [
          {
            staffId: 's1',
            staffName: 'Bidan Thabita',
            cohortN: 21,
            retainedN: 3,
            retentionPct: 14.3,
            benchmarkPct: 34.6,
            status: 'OK',
            skipReason: null,
          },
        ],
      },
    }),
  };
}

describe('StaffScorecardService — rincian kunjungan untuk raport', () => {
  it('menghitung pasien baru/ulang, asal pasien, nomor kunjungan, dan top 3 telat', async () => {
    const prisma = buildPrisma();
    const service = new StaffScorecardService(prisma as any, buildRetention() as any);

    const report = await service.getReport({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: NOW,
    });

    const item = report.items[0];
    expect(item.punctuality).toMatchObject({
      onTime: 1,
      lateMeasured: 1,
      chatLate: 1,
      unknown: 0,
      total: 3,
    });

    expect(item.visits).toEqual({
      newPatients: 1,
      repeatVisits: 2,
      ownRepeat: 1,
      handoffRepeat: 1,
      visitNumbers: [{ visitNumber: 2, count: 2 }],
      previousPeriodVisits: 9,
    });

    expect(item.worstLate).toHaveLength(2);
    expect(item.worstLate[0]).toMatchObject({
      reservationId: 'r3',
      source: 'JAM',
      minutes: 60,
      customerName: 'Bunda Tiga',
    });
    expect(item.worstLate[1]).toMatchObject({
      reservationId: 'r2',
      source: 'CHAT',
      minutes: 45,
      customerName: 'Bunda Dua',
    });
  });

  it('snapshot FINAL tidak mengarang rincian kunjungan', async () => {
    const prisma = buildPrisma();
    prisma.staffScorecardSnapshot.findMany = vi.fn().mockResolvedValue([
      {
        staff_id: 's1',
        staff_name: 'Bidan Thabita',
        period_year: 2026,
        period_month: 11,
        status: 'FINAL',
        punctuality_pct: 50,
        retention_pct: null,
        volume_pct: 73,
        weighted_score: 42,
        grade: 'D',
        coverage_pct: 36.8,
        measured_n: 14,
        chat_late_n: 0,
        unknown_n: 24,
        computed_at: new Date('2026-11-20T00:00:00Z'),
      },
    ]);
    const service = new StaffScorecardService(prisma as any, buildRetention() as any);

    const report = await service.getReport({
      tenantId: 'default-tenant',
      year: 2026,
      month: 11,
      now: NOW,
    });

    expect(report.items[0].status).toBe('FINAL');
    expect(report.items[0].visits).toBeNull();
    expect(report.items[0].worstLate).toEqual([]);
  });
});

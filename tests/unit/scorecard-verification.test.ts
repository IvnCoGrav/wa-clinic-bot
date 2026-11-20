import { describe, it, expect } from 'vitest';
import {
  compareScorecardPeriod,
  type RawStaffCounts,
} from '../../scripts/verify-scorecard-period';
import type { StaffScorecardItem } from '../../src/services/staff-scorecard.service';

function buildItem(overrides: Partial<StaffScorecardItem> = {}): StaffScorecardItem {
  return {
    staffId: 'staff-1',
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
    ...overrides,
  } as StaffScorecardItem;
}

const RAW: RawStaffCounts = {
  staffId: 'staff-1',
  totalVisits: 37,
  onTime: 6,
  lateMeasured: 7,
  chatLate: 18,
  unknown: 6,
};

describe('compareScorecardPeriod (F8 gate)', () => {
  it('PASS saat angka API sama dengan hitungan SQL', () => {
    const result = compareScorecardPeriod([buildItem()], [RAW]);
    expect(result).toEqual({ ok: true, mismatches: [], checkedStaff: 1 });
  });

  it('menandai selisih total kunjungan (data baru masuk setelah cache/snapshot)', () => {
    const result = compareScorecardPeriod([buildItem()], [{ ...RAW, totalVisits: 38 }]);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { staffId: 'staff-1', field: 'totalVisits', api: 37, raw: 38 },
    ]);
  });

  it('menandai selisih bukti chat yang belum disetujui', () => {
    const item = buildItem({
      punctuality: {
        pct: 19.4,
        onTime: 6,
        lateMeasured: 7,
        chatLate: 17,
        unknown: 7,
        assessed: 30,
        total: 37,
        status: 'OK',
      },
    });
    const result = compareScorecardPeriod([item], [RAW]);
    expect(result.ok).toBe(false);
    const fields = result.mismatches.map((m) => m.field);
    expect(fields).toContain('chatLate');
    expect(fields).toContain('unknown');
  });

  it('menandai bidan yang ada di API tetapi tidak muncul di SQL', () => {
    const result = compareScorecardPeriod([buildItem()], []);
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ staffId: 'staff-1', field: 'row', api: 1, raw: 0 });
  });

  it('menandai invarian assessed yang tidak konsisten walau field mentah cocok', () => {
    const item = buildItem({
      punctuality: {
        pct: 19.4,
        onTime: 6,
        lateMeasured: 7,
        chatLate: 18,
        unknown: 6,
        assessed: 30,
        total: 37,
        status: 'OK',
      },
    });
    const result = compareScorecardPeriod([item], [RAW]);
    expect(result.ok).toBe(false);
    expect(result.mismatches.map((m) => m.field)).toContain(
      'assessed != onTime+lateMeasured+chatLate'
    );
    expect(result.mismatches.map((m) => m.field)).toContain('total != assessed+unknown');
  });

  it('PASS untuk periode tanpa bidan dinilai', () => {
    const result = compareScorecardPeriod([], []);
    expect(result.ok).toBe(true);
    expect(result.checkedStaff).toBe(0);
  });
});

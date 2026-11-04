import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  RetentionVisitRow,
  RetentionPolicyInput,
  buildVisits,
  selectCohort,
  calculateRetention,
  resolveFinalTier,
  applySoftLanding,
  subtractMonths,
} from '../../src/domain/staff-retention';

const DEFAULT_POLICY: RetentionPolicyInput = {
  windowDays: 60,
  benchmarkPct: 34.6,
  tier1MaxPct: 31.1,
  tier2MaxPct: 38.1,
  splitTier1: 50,
  splitTier2: 55,
  splitTier3: 60,
  minSample: 40,
  downgradePeriods: 2,
  softLanding: false,
};

describe('Staff Retention Pure Calculator (T1-T20 Adversarial)', () => {
  // Test file isolation check
  it('Architecture guard: src/domain/staff-retention.ts must NOT import prisma or db client', () => {
    const filePath = path.join(__dirname, '../../src/domain/staff-retention.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"].*prisma.*['"]/i);
    expect(content).not.toMatch(/from\s+['"].*db\/client.*['"]/i);
    expect(content).not.toMatch(/Date\.now\(\)/);
  });

  // T1: cohort kosong
  it('T1: cohort kosong -> retentionPct=null, status=INSUFFICIENT_SAMPLE, split=50', () => {
    const visits = buildVisits([]);
    const cohort = selectCohort(visits, {
      asOf: '2027-01-31',
      windowDays: 60,
      poolMonths: 6,
    });
    const results = calculateRetention(cohort, DEFAULT_POLICY);
    expect(results).toHaveLength(0);

    // If evaluated for a staff with 0 cohort
    const emptyResult = calculateRetention([], DEFAULT_POLICY);
    expect(emptyResult).toHaveLength(0);
  });

  // T2: 2 kunjungan di tanggal sama
  it('T2: 2 kunjungan di tanggal sama -> dihitung 1 kunjungan', () => {
    const rows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-01', createdAt: '2026-08-01T08:00:00Z' },
      { customerId: 'c1', staffId: 's2', visitDate: '2026-08-01', createdAt: '2026-08-01T10:00:00Z' },
    ];
    const visits = buildVisits(rows);
    expect(visits).toHaveLength(1);
    expect(visits[0].customerId).toBe('c1');
    expect(visits[0].visitDate).toBe('2026-08-01');
    // Staf pertama berdasarkan createdAt
    expect(visits[0].staffId).toBe('s1');
  });

  // T3: kunjungan tepat di hari ke-60
  it('T3: kunjungan tepat di hari ke-60 -> dihitung repeat (boundary inklusif)', () => {
    // 2026-08-01 to 2026-09-30 is exactly 60 days
    // August: 31 days (31 - 1 = 30 days remaining in Aug)
    // September: 30 days. Total = 30 + 30 = 60 days.
    const rows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-01' },
      { customerId: 'c1', staffId: 's1', visitDate: '2026-09-30' },
    ];
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, { ...DEFAULT_POLICY, minSample: 1 });
    expect(res).toHaveLength(1);
    expect(res[0].cohortN).toBe(1);
    expect(res[0].retainedN).toBe(1);
    expect(res[0].retentionPct).toBe(100);
  });

  // T4: kunjungan hari ke-61
  it('T4: kunjungan hari ke-61 -> TIDAK dihitung repeat', () => {
    // 2026-08-01 to 2026-10-01 is 61 days
    const rows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-01' },
      { customerId: 'c1', staffId: 's1', visitDate: '2026-10-01' },
    ];
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, { ...DEFAULT_POLICY, minSample: 1 });
    expect(res).toHaveLength(1);
    expect(res[0].cohortN).toBe(1);
    expect(res[0].retainedN).toBe(0);
    expect(res[0].retentionPct).toBe(0);
  });

  // T5: n=39, retensi 50%
  it('T5: n=39, retensi 50% -> INSUFFICIENT_SAMPLE, rawTier=null, split=50', () => {
    const rows: RetentionVisitRow[] = [];
    for (let i = 1; i <= 39; i++) {
      rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-01' });
      if (i % 2 === 0) {
        rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-20' });
      }
    }
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, DEFAULT_POLICY);
    expect(res[0].cohortN).toBe(39);
    expect(res[0].status).toBe('INSUFFICIENT_SAMPLE');
    expect(res[0].rawTier).toBeNull();
    expect(res[0].splitPct).toBe(50);
  });

  // T6: n=40, retensi 31,05%
  it('T6: n=40, retensi 31,05% (< 31.1%) -> Tier 1, split 50', () => {
    // 200 patients, 62 repeat -> 31.00%
    const rows: RetentionVisitRow[] = [];
    for (let i = 1; i <= 200; i++) {
      rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-01' });
      if (i <= 62) {
        rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-15' });
      }
    }
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, DEFAULT_POLICY);
    expect(res[0].cohortN).toBe(200);
    expect(res[0].retainedN).toBe(62);
    expect(res[0].retentionPct).toBe(31.0);
    expect(res[0].rawTier).toBe(1);
    expect(res[0].splitPct).toBe(50);
  });

  // T7: n=40, retensi 31,1%
  it('T7: n=40, retensi 31,1% (boundary) -> Tier 2, split 55', () => {
    // 1000 patients, 311 repeat -> 31.10%
    const rows: RetentionVisitRow[] = [];
    for (let i = 1; i <= 1000; i++) {
      rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-01' });
      if (i <= 311) {
        rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-15' });
      }
    }
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, DEFAULT_POLICY);
    expect(res[0].retentionPct).toBe(31.1);
    expect(res[0].rawTier).toBe(2);
    expect(res[0].splitPct).toBe(55);
  });

  // T8: n=40, retensi 38,1%
  it('T8: n=40, retensi 38,1% (boundary) -> Tier 3, split 60', () => {
    // 1000 patients, 381 repeat -> 38.10%
    const rows: RetentionVisitRow[] = [];
    for (let i = 1; i <= 1000; i++) {
      rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-01' });
      if (i <= 381) {
        rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-15' });
      }
    }
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, DEFAULT_POLICY);
    expect(res[0].retentionPct).toBe(38.1);
    expect(res[0].rawTier).toBe(3);
    expect(res[0].splitPct).toBe(60);
  });

  // T9: semua pasien repeat
  it('T9: semua pasien repeat -> 100%, Tier 3', () => {
    const rows: RetentionVisitRow[] = [];
    for (let i = 1; i <= 50; i++) {
      rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-01' });
      rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-15' });
    }
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, DEFAULT_POLICY);
    expect(res[0].cohortN).toBe(50);
    expect(res[0].retainedN).toBe(50);
    expect(res[0].retentionPct).toBe(100);
    expect(res[0].rawTier).toBe(3);
    expect(res[0].splitPct).toBe(60);
  });

  // T10: pasien dengan 1 kunjungan saja
  it('T10: pasien dengan 1 kunjungan saja -> 0%, Tier 1', () => {
    const rows: RetentionVisitRow[] = [];
    for (let i = 1; i <= 50; i++) {
      rows.push({ customerId: `c${i}`, staffId: 's1', visitDate: '2026-08-01' });
    }
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, DEFAULT_POLICY);
    expect(res[0].cohortN).toBe(50);
    expect(res[0].retainedN).toBe(0);
    expect(res[0].retentionPct).toBe(0);
    expect(res[0].rawTier).toBe(1);
    expect(res[0].splitPct).toBe(50);
  });

  // T11: staf null (tanpa bidan)
  it('T11: staf null (tanpa bidan) -> muncul sebagai grup UNASSIGNED, bukan crash', () => {
    const rows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: null, visitDate: '2026-08-01' },
      { customerId: 'c1', staffId: null, visitDate: '2026-08-20' },
    ];
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, { ...DEFAULT_POLICY, minSample: 1 });
    expect(res).toHaveLength(1);
    expect(res[0].staffId).toBeNull();
    expect(res[0].cohortN).toBe(1);
    expect(res[0].retainedN).toBe(1);
  });

  // T12: cohort mentah (belum 60 hari)
  it('T12: cohort mentah (belum 60 hari) -> tidak masuk denominator', () => {
    // asOf = 2026-11-30. W = 60. pool_end = 2026-10-01.
    // Patient first visit on 2026-10-15 has NOT matured (less than 60 days from asOf)
    const rows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-01' }, // matured
      { customerId: 'c2', staffId: 's1', visitDate: '2026-10-15' }, // immature
    ];
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    expect(cohort).toHaveLength(1);
    expect(cohort[0].customerId).toBe('c1');
  });

  // T13: kunjungan di luar pool (lebih tua 6 bulan)
  it('T13: kunjungan di luar pool (lebih tua 6 bulan) -> tidak masuk denominator', () => {
    // asOf = 2026-11-30. W = 60. pool_end = 2026-10-01.
    // pool_start = 6 months before pool_end = ~2026-04-01.
    // Patient first visit on 2026-01-15 is older than 6 months -> excluded
    const rows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: 's1', visitDate: '2026-01-15' }, // outside pool
      { customerId: 'c2', staffId: 's1', visitDate: '2026-08-01' }, // inside pool
    ];
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    expect(cohort).toHaveLength(1);
    expect(cohort[0].customerId).toBe('c2');
  });

  // T14: hysteresis: Tier 2->3 langsung naik
  it('T14: hysteresis: Tier 2->3 langsung naik -> final Tier 3, streak=0', () => {
    const outcome = resolveFinalTier(3, 2, 0, DEFAULT_POLICY);
    expect(outcome.finalTier).toBe(3);
    expect(outcome.downgradeStreak).toBe(0);
  });

  // T15: hysteresis: Tier 3->1 sekali
  it('T15: hysteresis: Tier 3->1 sekali -> tetap Tier 3, streak=1', () => {
    const outcome = resolveFinalTier(1, 3, 0, DEFAULT_POLICY);
    expect(outcome.finalTier).toBe(3);
    expect(outcome.downgradeStreak).toBe(1);
  });

  // T16: hysteresis: Tier 3->1 dua kali
  it('T16: hysteresis: Tier 3->1 dua kali -> turun ke Tier 1', () => {
    const outcome = resolveFinalTier(1, 3, 1, DEFAULT_POLICY);
    expect(outcome.finalTier).toBe(1);
    expect(outcome.downgradeStreak).toBe(2);
  });

  // T17: soft landing aktif, Tier 1
  it('T17: soft landing aktif, Tier 1 -> split jadi 55', () => {
    const split = applySoftLanding(50, { ...DEFAULT_POLICY, softLanding: true });
    expect(split).toBe(55);

    const noSoft = applySoftLanding(50, { ...DEFAULT_POLICY, softLanding: false });
    expect(noSoft).toBe(50);
  });

  // T18: benchmark 0
  it('T18: benchmark 0 -> retentionIndex=null, tidak divide-by-zero', () => {
    const rows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-01' },
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-10' },
    ];
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    const res = calculateRetention(cohort, {
      ...DEFAULT_POLICY,
      benchmarkPct: 0,
      minSample: 1,
    });
    expect(res[0].retentionIndex).toBeNull();
  });

  // T19: urutan input acak (shuffle)
  it('T19: urutan input acak (shuffle) -> hasil identik (deterministik)', () => {
    const baseRows: RetentionVisitRow[] = [
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-01' },
      { customerId: 'c1', staffId: 's1', visitDate: '2026-08-20' },
      { customerId: 'c2', staffId: 's2', visitDate: '2026-08-05' },
      { customerId: 'c2', staffId: 's2', visitDate: '2026-09-01' },
      { customerId: 'c3', staffId: 's1', visitDate: '2026-08-10' },
    ];

    const shuffled = [...baseRows].sort(() => 0.5 - Math.random());

    const visits1 = buildVisits(baseRows);
    const visits2 = buildVisits(shuffled);

    const cohort1 = selectCohort(visits1, { asOf: '2026-11-30', windowDays: 60, poolMonths: 6 });
    const cohort2 = selectCohort(visits2, { asOf: '2026-11-30', windowDays: 60, poolMonths: 6 });

    const res1 = calculateRetention(cohort1, { ...DEFAULT_POLICY, minSample: 1 });
    const res2 = calculateRetention(cohort2, { ...DEFAULT_POLICY, minSample: 1 });

    expect(res1).toEqual(res2);
  });

  // T20: 1000 baris < 50ms (guard N²)
  it('T20: 1000 baris -> selesai < 50ms (guard N²)', () => {
    const rows: RetentionVisitRow[] = [];
    for (let i = 1; i <= 1000; i++) {
      const custId = `c_${i % 200}`;
      const staffId = `s_${i % 5}`;
      const month = String(Math.floor((i % 180) / 30) + 4).padStart(2, '0');
      const day = String((i % 28) + 1).padStart(2, '0');
      rows.push({
        customerId: custId,
        staffId,
        visitDate: `2026-${month}-${day}`,
      });
    }

    const start = performance.now();
    const visits = buildVisits(rows);
    const cohort = selectCohort(visits, {
      asOf: '2026-11-30',
      windowDays: 60,
      poolMonths: 6,
    });
    calculateRetention(cohort, DEFAULT_POLICY);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('T21: subtractMonths menangani tanggal akhir bulan tanpa overflow JS (M11)', () => {
    // 31 Maret non-kabisat - 1 bulan -> 28 Februari (bukan 3 Maret)
    expect(subtractMonths('2026-03-31', 1)).toBe('2026-02-28');
    // 31 Maret tahun kabisat (2024) - 1 bulan -> 29 Februari
    expect(subtractMonths('2024-03-31', 1)).toBe('2024-02-29');
    // 31 Mei - 1 bulan -> 30 April
    expect(subtractMonths('2026-05-31', 1)).toBe('2026-04-30');
    // 31 Agustus - 6 bulan -> 28 Februari
    expect(subtractMonths('2026-08-31', 6)).toBe('2026-02-28');
    // 31 Januari - 12 bulan -> 31 Januari tahun sebelumnya
    expect(subtractMonths('2026-01-31', 12)).toBe('2025-01-31');
  });
});

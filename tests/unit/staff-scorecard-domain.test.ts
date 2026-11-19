import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRADE_THRESHOLDS,
  DEFAULT_SCORECARD_WEIGHTS,
  composeScore,
  computePunctuality,
  computeVolume,
  evaluateRetentionEligibility,
  gradeFromScore,
  validateWeights,
} from '../../src/domain/staff-scorecard';

describe('computePunctuality', () => {
  it('menghitung Thabita November: 6 tepat dari 31 yang bisa dinilai', () => {
    const result = computePunctuality({
      onTime: 6,
      lateMeasured: 7,
      chatLate: 18,
      unknown: 6,
      minSample: 10,
    });

    expect(result.pct).toBe(19.4);
    expect(result.assessed).toBe(31);
    expect(result.total).toBe(37);
    expect(result.status).toBe('OK');
    expect(result.breakdown).toEqual({
      onTime: 6,
      lateMeasured: 7,
      chatLate: 18,
      unknown: 6,
    });
  });

  it('tanpa data sama sekali tidak pernah menghasilkan 0% atau 100%', () => {
    const result = computePunctuality({
      onTime: 0,
      lateMeasured: 0,
      chatLate: 0,
      unknown: 10,
      minSample: 10,
    });

    expect(result.pct).toBeNull();
    expect(result.assessed).toBe(0);
    expect(result.status).toBe('INSUFFICIENT_SAMPLE');
  });

  it('sampel di bawah minimum ditandai, angkanya tetap dihitung', () => {
    const result = computePunctuality({
      onTime: 3,
      lateMeasured: 2,
      chatLate: 0,
      unknown: 0,
      minSample: 10,
    });

    expect(result.pct).toBe(60);
    expect(result.assessed).toBe(5);
    expect(result.status).toBe('INSUFFICIENT_SAMPLE');
  });

  it('tepat di ambang minimum dianggap cukup', () => {
    const result = computePunctuality({
      onTime: 5,
      lateMeasured: 5,
      chatLate: 0,
      unknown: 0,
      minSample: 10,
    });

    expect(result.assessed).toBe(10);
    expect(result.status).toBe('OK');
  });

  it('bukti chat dihitung sebagai terlambat, bukan tepat waktu', () => {
    const result = computePunctuality({
      onTime: 1,
      lateMeasured: 0,
      chatLate: 1,
      unknown: 0,
      minSample: 1,
    });

    expect(result.pct).toBe(50);
    expect(result.assessed).toBe(2);
  });

  it('input negatif dan pecahan dibersihkan tanpa melempar error', () => {
    const result = computePunctuality({
      onTime: -5,
      lateMeasured: 2.9,
      chatLate: -2,
      unknown: 1.5,
      minSample: -3,
    });

    expect(result.breakdown).toEqual({
      onTime: 0,
      lateMeasured: 2,
      chatLate: 0,
      unknown: 1,
    });
    expect(result.pct).toBe(0);
    expect(result.assessed).toBe(2);
  });
});

describe('computeVolume', () => {
  it('memprorata target 3/hari x 26 hari untuk periode 1-18 dari 30 hari', () => {
    const result = computeVolume({
      visits: 37,
      periodDays: 18,
      daysInMonth: 30,
      targetPerDay: 3,
      workingDaysPerMonth: 26,
    });

    expect(result.target).toBe(46.8);
    expect(result.pct).toBe(79.1);
  });

  it('nol kunjungan tetap punya target dan persentase 0', () => {
    const result = computeVolume({
      visits: 0,
      periodDays: 18,
      daysInMonth: 30,
      targetPerDay: 3,
      workingDaysPerMonth: 26,
    });

    expect(result.pct).toBe(0);
    expect(result.target).toBe(46.8);
  });

  it('melebihi target tidak dipotong ke 100', () => {
    const result = computeVolume({
      visits: 60,
      periodDays: 18,
      daysInMonth: 30,
      targetPerDay: 3,
      workingDaysPerMonth: 26,
    });

    expect(result.pct).toBeGreaterThan(100);
  });

  it('periode atau bulan tidak valid menghasilkan null, bukan Infinity', () => {
    const result = computeVolume({
      visits: 10,
      periodDays: 0,
      daysInMonth: 30,
      targetPerDay: 3,
      workingDaysPerMonth: 26,
    });

    expect(result.pct).toBeNull();
    expect(result.target).toBe(0);
  });
});

describe('evaluateRetentionEligibility', () => {
  it('masa kerja kurang dari minimum menang sebelum cek sampel', () => {
    const result = evaluateRetentionEligibility({
      cohortN: 21,
      tenureMonths: 1,
      minSample: 40,
      minTenureMonths: 4,
      pct: 14.3,
    });

    expect(result.eligible).toBe(false);
    expect(result.status).toBe('TENURE');
  });

  it('masa kerja cukup tetapi sampel kurang', () => {
    const result = evaluateRetentionEligibility({
      cohortN: 21,
      tenureMonths: 5,
      minSample: 40,
      minTenureMonths: 4,
      pct: 14.3,
    });

    expect(result.eligible).toBe(false);
    expect(result.status).toBe('INSUFFICIENT_SAMPLE');
  });

  it('memenuhi dua syarat baru layak dinilai', () => {
    const result = evaluateRetentionEligibility({
      cohortN: 40,
      tenureMonths: 5,
      minSample: 40,
      minTenureMonths: 4,
      pct: 30,
    });

    expect(result.eligible).toBe(true);
    expect(result.status).toBe('OK');
  });

  it('kohort kosong atau persentase null berarti belum ada data', () => {
    expect(
      evaluateRetentionEligibility({
        cohortN: 0,
        tenureMonths: 6,
        minSample: 40,
        minTenureMonths: 4,
        pct: null,
      }).status
    ).toBe('NO_DATA');

    expect(
      evaluateRetentionEligibility({
        cohortN: 21,
        tenureMonths: 6,
        minSample: 40,
        minTenureMonths: 4,
        pct: null,
      }).status
    ).toBe('NO_DATA');
  });
});

describe('composeScore', () => {
  it('Thabita: retensi dikeluarkan, bobot dinormalisasi ke 71,4 / 28,6', () => {
    const result = composeScore({
      punctuality: { pct: 19.4, assessed: 31, minSample: 10 },
      retention: { pct: 14.3, eligible: false },
      volume: { pct: 79.1 },
    });

    expect(result.excluded).toEqual(['retention']);
    expect(result.usedWeights).toEqual({ punctuality: 71.4, retention: 0, volume: 28.6 });
    expect(result.score).toBe(36.5);
    expect(result.grade).toBe('E');
  });

  it('tiga komponen lengkap memakai bobot 50/30/20', () => {
    const result = composeScore({
      punctuality: { pct: 80, assessed: 50, minSample: 10 },
      retention: { pct: 50, eligible: true },
      volume: { pct: 100 },
    });

    expect(result.excluded).toEqual([]);
    expect(result.usedWeights).toEqual({ punctuality: 50, retention: 30, volume: 20 });
    expect(result.score).toBe(75);
    expect(result.grade).toBe('B');
  });

  it('ketepatan di bawah sampel minimum dikeluarkan, sisanya dinormalisasi', () => {
    const result = composeScore({
      punctuality: { pct: 90, assessed: 5, minSample: 10 },
      retention: { pct: 50, eligible: true },
      volume: { pct: 100 },
    });

    expect(result.excluded).toEqual(['punctuality']);
    expect(result.usedWeights).toEqual({ punctuality: 0, retention: 60, volume: 40 });
    expect(result.score).toBe(70);
    expect(result.grade).toBe('C');
  });

  it('tanpa komponen yang sah menghasilkan nilai null, bukan E', () => {
    const result = composeScore({
      punctuality: { pct: null, assessed: 0, minSample: 10 },
      retention: { pct: null, eligible: false },
      volume: { pct: null },
    });

    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.excluded).toEqual(['punctuality', 'retention', 'volume']);
  });

  it('bobot total nol tidak menghasilkan Infinity', () => {
    const result = composeScore({
      punctuality: { pct: 50, assessed: 20, minSample: 10 },
      retention: { pct: null, eligible: false },
      volume: { pct: null },
      weights: { punctuality: 0, retention: 0, volume: 0 },
    });

    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();
  });

  it('persentase ketepatan di atas 100 dijepit ke 100', () => {
    const result = composeScore({
      punctuality: { pct: 120, assessed: 20, minSample: 10 },
      retention: { pct: null, eligible: false },
      volume: { pct: null },
    });

    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
  });
});

describe('gradeFromScore', () => {
  it.each([
    [100, 'A'],
    [90, 'A'],
    [89.9, 'B'],
    [75, 'B'],
    [74.9, 'C'],
    [60, 'C'],
    [59.9, 'D'],
    [40, 'D'],
    [39.9, 'E'],
    [0, 'E'],
  ])('skor %s menghasilkan grade %s', (score, grade) => {
    expect(gradeFromScore(score)).toBe(grade);
  });

  it('null tidak dipaksa menjadi E', () => {
    expect(gradeFromScore(null)).toBeNull();
    expect(gradeFromScore(Number.NaN)).toBeNull();
  });

  it('menerima ambang kustom', () => {
    expect(gradeFromScore(75, { aMin: 80, bMin: 70, cMin: 50, dMin: 30 })).toBe('B');
    expect(gradeFromScore(85, { aMin: 80, bMin: 70, cMin: 50, dMin: 30 })).toBe('A');
  });
});

describe('validateWeights', () => {
  it('menerima bobot default', () => {
    expect(validateWeights(DEFAULT_SCORECARD_WEIGHTS)).toBe(true);
  });

  it('menolak total selain 100', () => {
    expect(validateWeights({ punctuality: 50, retention: 30, volume: 19 })).toBe(false);
    expect(validateWeights({ punctuality: 50, retention: 30, volume: 30 })).toBe(false);
  });

  it('menolak bobot negatif', () => {
    expect(validateWeights({ punctuality: 60, retention: 50, volume: -10 })).toBe(false);
  });
});

describe('default ambang', () => {
  it('sesuai keputusan D5', () => {
    expect(DEFAULT_GRADE_THRESHOLDS).toEqual({ aMin: 90, bMin: 75, cMin: 60, dMin: 40 });
    expect(DEFAULT_SCORECARD_WEIGHTS).toEqual({ punctuality: 50, retention: 30, volume: 20 });
  });
});

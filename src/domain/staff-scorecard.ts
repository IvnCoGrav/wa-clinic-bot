/**
 * staff-scorecard.ts — domain murni penilaian bidan.
 *
 * Kontrak:
 * - Tanpa I/O, tanpa Prisma, tanpa jam dinding.
 * - Semua fungsi deterministik dan dapat diuji tanpa database.
 * - Tidak pernah mengubah `arrived_at`; hanya menghitung dari angka yang diberikan.
 *
 * Komponen: ketepatan waktu, retensi, volume kunjungan.
 * Komponen yang sampelnya di bawah minimum DIKELUARKAN dan bobotnya dinormalisasi.
 */

export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export type ScoreComponentKey = 'punctuality' | 'retention' | 'volume';

export interface ScorecardWeights {
  punctuality: number;
  retention: number;
  volume: number;
}

export interface GradeThresholds {
  aMin: number;
  bMin: number;
  cMin: number;
  dMin: number;
}

export const DEFAULT_SCORECARD_WEIGHTS: ScorecardWeights = {
  punctuality: 50,
  retention: 30,
  volume: 20,
};

export const DEFAULT_GRADE_THRESHOLDS: GradeThresholds = {
  aMin: 90,
  bMin: 75,
  cMin: 60,
  dMin: 40,
};

function toCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function toPct(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Bobot sah bila semua non-negatif dan totalnya tepat 100. */
export function validateWeights(weights: ScorecardWeights): boolean {
  const values = [weights.punctuality, weights.retention, weights.volume];
  if (!values.every((v) => Number.isFinite(v) && v >= 0)) return false;
  return values.reduce((sum, v) => sum + v, 0) === 100;
}

// ---------------------------------------------------------------------------
// Ketepatan waktu
// ---------------------------------------------------------------------------

export interface PunctualityInput {
  /** Kunjungan dengan `arrived_at` <= toleransi. */
  onTime: number;
  /** Kunjungan dengan `arrived_at` > toleransi. */
  lateMeasured: number;
  /** Tanpa `arrived_at`, tetapi ada pesan customer setelah ambang. */
  chatLate: number;
  /** Tanpa sinyal apa pun. Tidak pernah dianggap tepat waktu. */
  unknown: number;
  minSample: number;
}

export interface PunctualityResult {
  /** Persentase tepat waktu dari kunjungan yang BISA dinilai. */
  pct: number | null;
  assessed: number;
  total: number;
  status: 'OK' | 'INSUFFICIENT_SAMPLE';
  breakdown: {
    onTime: number;
    lateMeasured: number;
    chatLate: number;
    unknown: number;
  };
}

export function computePunctuality(input: PunctualityInput): PunctualityResult {
  const breakdown = {
    onTime: toCount(input.onTime),
    lateMeasured: toCount(input.lateMeasured),
    chatLate: toCount(input.chatLate),
    unknown: toCount(input.unknown),
  };

  const assessed = breakdown.onTime + breakdown.lateMeasured + breakdown.chatLate;
  const total = assessed + breakdown.unknown;
  const pct = assessed > 0 ? toPct((breakdown.onTime / assessed) * 100) : null;
  const minSample = toCount(input.minSample);

  return {
    pct,
    assessed,
    total,
    status: assessed > 0 && assessed >= minSample ? 'OK' : 'INSUFFICIENT_SAMPLE',
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Volume kunjungan
// ---------------------------------------------------------------------------

export interface VolumeInput {
  visits: number;
  /** Hari yang sudah berjalan pada periode laporan (mis. 18). */
  periodDays: number;
  /** Jumlah hari dalam bulan tersebut (mis. 30). */
  daysInMonth: number;
  targetPerDay: number;
  workingDaysPerMonth: number;
}

export interface VolumeResult {
  pct: number | null;
  /** Target periode, sudah diprorata. */
  target: number;
  visits: number;
  targetPerDay: number;
}

export function computeVolume(input: VolumeInput): VolumeResult {
  const visits = toCount(input.visits);
  const periodDays = toCount(input.periodDays);
  const daysInMonth = toCount(input.daysInMonth);
  const targetPerDay = toCount(input.targetPerDay);
  const workingDays = toCount(input.workingDaysPerMonth);

  if (daysInMonth <= 0 || periodDays <= 0 || targetPerDay <= 0 || workingDays <= 0) {
    return { pct: null, target: 0, visits, targetPerDay };
  }

  const targetRaw = targetPerDay * workingDays * (periodDays / daysInMonth);
  const target = Math.round(targetRaw * 10) / 10;
  const pct = toPct((visits / targetRaw) * 100);

  return { pct, target, visits, targetPerDay };
}

// ---------------------------------------------------------------------------
// Retensi (kelayakan)
// ---------------------------------------------------------------------------

export type RetentionStatus = 'OK' | 'TENURE' | 'INSUFFICIENT_SAMPLE' | 'NO_DATA';

export interface RetentionEligibilityInput {
  cohortN: number;
  tenureMonths: number;
  minSample: number;
  minTenureMonths: number;
  pct: number | null;
}

export interface RetentionEligibilityResult {
  eligible: boolean;
  status: RetentionStatus;
  pct: number | null;
  cohortN: number;
}

/**
 * Meniru urutan kelayakan `StaffRetentionService`:
 * NO_DATA -> TENURE -> INSUFFICIENT_SAMPLE -> OK.
 */
export function evaluateRetentionEligibility(
  input: RetentionEligibilityInput
): RetentionEligibilityResult {
  const cohortN = toCount(input.cohortN);
  const pct = input.pct == null ? null : toPct(input.pct);
  const tenureMonths = toCount(input.tenureMonths);
  const minSample = toCount(input.minSample);
  const minTenureMonths = toCount(input.minTenureMonths);

  if (cohortN === 0 || pct === null) {
    return { eligible: false, status: 'NO_DATA', pct, cohortN };
  }
  if (tenureMonths < minTenureMonths) {
    return { eligible: false, status: 'TENURE', pct, cohortN };
  }
  if (cohortN < minSample) {
    return { eligible: false, status: 'INSUFFICIENT_SAMPLE', pct, cohortN };
  }
  return { eligible: true, status: 'OK', pct, cohortN };
}

// ---------------------------------------------------------------------------
// Komposisi nilai
// ---------------------------------------------------------------------------

export interface ComposeInput {
  punctuality: { pct: number | null; assessed: number; minSample: number };
  retention: { pct: number | null; eligible: boolean };
  volume: { pct: number | null };
  weights?: ScorecardWeights;
  thresholds?: GradeThresholds;
}

export interface ComposeResult {
  score: number | null;
  grade: ScoreGrade | null;
  /** Bobot efektif setelah komponen yang dikeluarkan dinormalisasi ulang (0..100). */
  usedWeights: ScorecardWeights;
  excluded: ScoreComponentKey[];
}

const EMPTY_WEIGHTS: ScorecardWeights = { punctuality: 0, retention: 0, volume: 0 };

export function composeScore(input: ComposeInput): ComposeResult {
  const weights = input.weights ?? DEFAULT_SCORECARD_WEIGHTS;
  const thresholds = input.thresholds ?? DEFAULT_GRADE_THRESHOLDS;
  const excluded: ScoreComponentKey[] = [];

  const included: Array<{ key: ScoreComponentKey; pct: number; weight: number }> = [];

  const punctualityPct =
    input.punctuality.pct == null ? null : clampPct(toPct(input.punctuality.pct) as number);
  if (
    punctualityPct == null ||
    input.punctuality.assessed <= 0 ||
    input.punctuality.assessed < toCount(input.punctuality.minSample)
  ) {
    excluded.push('punctuality');
  } else {
    included.push({ key: 'punctuality', pct: punctualityPct, weight: weights.punctuality });
  }

  const retentionPct =
    input.retention.pct == null ? null : clampPct(toPct(input.retention.pct) as number);
  if (!input.retention.eligible || retentionPct == null) {
    excluded.push('retention');
  } else {
    included.push({ key: 'retention', pct: retentionPct, weight: weights.retention });
  }

  const volumePct = input.volume.pct == null ? null : toPct(input.volume.pct);
  if (volumePct == null) {
    excluded.push('volume');
  } else {
    included.push({ key: 'volume', pct: volumePct, weight: weights.volume });
  }

  const totalWeight = included.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (included.length === 0 || totalWeight <= 0) {
    return {
      score: null,
      grade: null,
      usedWeights: { ...EMPTY_WEIGHTS },
      excluded,
    };
  }

  const score =
    Math.round(
      included.reduce((sum, item) => sum + item.pct * (Math.max(0, item.weight) / totalWeight), 0) * 10
    ) / 10;

  const usedWeights: ScorecardWeights = { ...EMPTY_WEIGHTS };
  for (const item of included) {
    usedWeights[item.key] = Math.round((Math.max(0, item.weight) / totalWeight) * 1000) / 10;
  }

  return {
    score,
    grade: gradeFromScore(score, thresholds),
    usedWeights,
    excluded,
  };
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

export function gradeFromScore(
  score: number | null,
  thresholds: GradeThresholds = DEFAULT_GRADE_THRESHOLDS
): ScoreGrade | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= thresholds.aMin) return 'A';
  if (score >= thresholds.bMin) return 'B';
  if (score >= thresholds.cMin) return 'C';
  if (score >= thresholds.dMin) return 'D';
  return 'E';
}

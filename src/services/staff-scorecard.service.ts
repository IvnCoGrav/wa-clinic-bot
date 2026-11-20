/**
 * staff-scorecard.service.ts — policy penilaian bidan (versioned).
 *
 * F3: hanya policy. Agregasi nilai menyusul di F5.
 */

import { prisma as defaultPrisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import {
  composeScore,
  computePunctuality,
  computeVolume,
  validateWeights,
  type ScorecardWeights,
} from '../domain/staff-scorecard';
import { staffRetentionService } from './staff-retention.service';

export interface StaffScorecardPolicyModel {
  id?: string;
  tenant_id: string;
  weight_punctuality: number;
  weight_retention: number;
  weight_volume: number;
  tolerance_minutes: number;
  chat_evidence_minutes: number;
  target_visits_per_day: number;
  working_days_per_month: number;
  min_sample_punctuality: number;
  min_sample_retention: number;
  min_tenure_months: number;
  grade_a_min: number;
  grade_b_min: number;
  grade_c_min: number;
  grade_d_min: number;
  formula_version: string;
  effective_from: Date;
  effective_to: Date | null;
  created_at?: Date;
  updated_at?: Date;
  is_fallback?: boolean;
}

const DEFAULT_STAFF_SCORECARD_POLICY: Omit<StaffScorecardPolicyModel, 'tenant_id'> = {
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
  effective_from: new Date('2026-11-19T00:00:00.000Z'),
  effective_to: null,
};

export interface PolicyValidationResult {
  valid: boolean;
  code?: string;
  error?: string;
  policy?: StaffScorecardPolicyModel;
}

function intInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { ok: false, error: `${field} harus bilangan bulat.` };
  }
  if (parsed < min || parsed > max) {
    return { ok: false, error: `${field} harus di antara ${min} dan ${max}.` };
  }
  return { ok: true, value: parsed };
}

/**
 * Validasi policy. Mengembalikan policy ternormalisasi atau pesan error.
 */
export function validateStaffScorecardPolicy(
  input: Record<string, any>,
  tenantId: string = DEFAULT_TENANT_ID
): PolicyValidationResult {
  const defaults = DEFAULT_STAFF_SCORECARD_POLICY;

  const weightPunctuality = intInRange(input.weight_punctuality, defaults.weight_punctuality, 0, 100, 'weight_punctuality');
  const weightRetention = intInRange(input.weight_retention, defaults.weight_retention, 0, 100, 'weight_retention');
  const weightVolume = intInRange(input.weight_volume, defaults.weight_volume, 0, 100, 'weight_volume');
  if (!weightPunctuality.ok) return { valid: false, code: 'INVALID_WEIGHTS', error: weightPunctuality.error };
  if (!weightRetention.ok) return { valid: false, code: 'INVALID_WEIGHTS', error: weightRetention.error };
  if (!weightVolume.ok) return { valid: false, code: 'INVALID_WEIGHTS', error: weightVolume.error };

  const weights = {
    punctuality: weightPunctuality.value,
    retention: weightRetention.value,
    volume: weightVolume.value,
  };
  if (!validateWeights(weights)) {
    return {
      valid: false,
      code: 'INVALID_WEIGHTS',
      error: 'Total bobot ketepatan + retensi + kunjungan harus tepat 100.',
    };
  }

  const tolerance = intInRange(input.tolerance_minutes, defaults.tolerance_minutes, 0, 180, 'tolerance_minutes');
  if (!tolerance.ok) return { valid: false, code: 'INVALID_TOLERANCE', error: tolerance.error };

  const chatThreshold = intInRange(input.chat_evidence_minutes, defaults.chat_evidence_minutes, 0, 180, 'chat_evidence_minutes');
  if (!chatThreshold.ok) return { valid: false, code: 'INVALID_CHAT_THRESHOLD', error: chatThreshold.error };

  const targetPerDay = intInRange(input.target_visits_per_day, defaults.target_visits_per_day, 1, 20, 'target_visits_per_day');
  if (!targetPerDay.ok) return { valid: false, code: 'INVALID_TARGET', error: targetPerDay.error };

  const workingDays = intInRange(input.working_days_per_month, defaults.working_days_per_month, 1, 31, 'working_days_per_month');
  if (!workingDays.ok) return { valid: false, code: 'INVALID_WORKING_DAYS', error: workingDays.error };

  const minPunctuality = intInRange(input.min_sample_punctuality, defaults.min_sample_punctuality, 1, 1000, 'min_sample_punctuality');
  if (!minPunctuality.ok) return { valid: false, code: 'INVALID_MIN_SAMPLE', error: minPunctuality.error };

  const minRetention = intInRange(input.min_sample_retention, defaults.min_sample_retention, 1, 1000, 'min_sample_retention');
  if (!minRetention.ok) return { valid: false, code: 'INVALID_MIN_SAMPLE_RETENTION', error: minRetention.error };

  const minTenure = intInRange(input.min_tenure_months, defaults.min_tenure_months, 0, 24, 'min_tenure_months');
  if (!minTenure.ok) return { valid: false, code: 'INVALID_MIN_TENURE', error: minTenure.error };

  const gradeA = intInRange(input.grade_a_min, defaults.grade_a_min, 1, 100, 'grade_a_min');
  const gradeB = intInRange(input.grade_b_min, defaults.grade_b_min, 1, 100, 'grade_b_min');
  const gradeC = intInRange(input.grade_c_min, defaults.grade_c_min, 1, 100, 'grade_c_min');
  const gradeD = intInRange(input.grade_d_min, defaults.grade_d_min, 1, 100, 'grade_d_min');
  if (!gradeA.ok) return { valid: false, code: 'INVALID_GRADE_THRESHOLDS', error: gradeA.error };
  if (!gradeB.ok) return { valid: false, code: 'INVALID_GRADE_THRESHOLDS', error: gradeB.error };
  if (!gradeC.ok) return { valid: false, code: 'INVALID_GRADE_THRESHOLDS', error: gradeC.error };
  if (!gradeD.ok) return { valid: false, code: 'INVALID_GRADE_THRESHOLDS', error: gradeD.error };

  if (!(gradeA.value > gradeB.value && gradeB.value > gradeC.value && gradeC.value > gradeD.value)) {
    return {
      valid: false,
      code: 'INVALID_GRADE_THRESHOLDS',
      error: 'Ambang grade harus menurun: A > B > C > D.',
    };
  }

  let effectiveFrom = new Date();
  if (input.effective_from !== undefined && input.effective_from !== null) {
    effectiveFrom = new Date(input.effective_from);
    if (Number.isNaN(effectiveFrom.getTime())) {
      return { valid: false, code: 'INVALID_EFFECTIVE_FROM', error: 'Format effective_from tidak valid.' };
    }
  }

  return {
    valid: true,
    policy: {
      tenant_id: tenantId,
      weight_punctuality: weights.punctuality,
      weight_retention: weights.retention,
      weight_volume: weights.volume,
      tolerance_minutes: tolerance.value,
      chat_evidence_minutes: chatThreshold.value,
      target_visits_per_day: targetPerDay.value,
      working_days_per_month: workingDays.value,
      min_sample_punctuality: minPunctuality.value,
      min_sample_retention: minRetention.value,
      min_tenure_months: minTenure.value,
      grade_a_min: gradeA.value,
      grade_b_min: gradeB.value,
      grade_c_min: gradeC.value,
      grade_d_min: gradeD.value,
      formula_version: String(input.formula_version || defaults.formula_version),
      effective_from: effectiveFrom,
      effective_to: null,
    },
  };
}

export interface ScorecardPeriodInfo {
  from: Date;
  to: Date;
  daysInMonth: number;
  periodDays: number;
  isCurrentMonth: boolean;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Rentang bulan WIB + jumlah hari berjalan (untuk prorata target). */
export function resolveScorecardPeriod(
  year: number,
  month: number,
  now: Date = new Date()
): ScorecardPeriodInfo {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = new Date(`${year}-${pad2(month)}-01T00:00:00+07:00`);
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const to = new Date(`${next.y}-${pad2(next.m)}-01T00:00:00+07:00`);

  const wibKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
  const [cy, cm, cd] = wibKey.split('-').map(Number);
  const isCurrentMonth = cy === year && cm === month;
  const isPast = cy * 12 + cm > year * 12 + month;
  const periodDays = isCurrentMonth ? cd : isPast ? daysInMonth : 0;

  return { from, to, daysInMonth, periodDays, isCurrentMonth };
}

export interface StaffScorecardItem {
  staffId: string;
  staffName: string;
  periodYear: number;
  periodMonth: number;
  punctuality: {
    pct: number | null;
    onTime: number;
    lateMeasured: number;
    chatLate: number;
    unknown: number;
    assessed: number;
    total: number;
    status: string;
  };
  retention: {
    pct: number | null;
    eligible: boolean;
    status: string;
    cohortN: number;
    retainedN: number;
    benchmarkPct: number | null;
  };
  volume: { pct: number | null; visits: number; target: number };
  coveragePct: number;
  score: number | null;
  grade: string | null;
  usedWeights: ScorecardWeights;
  excluded: string[];
  status: 'PREVIEW' | 'FINAL';
  computedAt: string;
}

export interface StaffScorecardReport {
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  policy: StaffScorecardPolicyModel;
  items: StaffScorecardItem[];
}

export interface FreezeScorecardResult {
  written: number;
  skipped: number;
  items: StaffScorecardItem[];
}

export class StaffScorecardService {
  constructor(
    private readonly prisma: any = defaultPrisma,
    private readonly retention: any = staffRetentionService
  ) {}

  /** Policy aktif pada tanggal tertentu; fallback ke default bila DB kosong/offline. */
  async getPolicy(
    tenantId: string = DEFAULT_TENANT_ID,
    asOf: Date = new Date()
  ): Promise<StaffScorecardPolicyModel> {
    try {
      const row = await this.prisma.staffScorecardPolicy.findFirst({
        where: { tenant_id: tenantId, effective_from: { lte: asOf } },
        orderBy: { effective_from: 'desc' },
      });
      if (!row) {
        return { ...DEFAULT_STAFF_SCORECARD_POLICY, tenant_id: tenantId, is_fallback: true };
      }
      return { ...row, is_fallback: false };
    } catch {
      return { ...DEFAULT_STAFF_SCORECARD_POLICY, tenant_id: tenantId, is_fallback: true };
    }
  }

  /** Membuat versi policy baru (immutable). */
  async createPolicyVersion(
    tenantId: string,
    policy: StaffScorecardPolicyModel
  ): Promise<StaffScorecardPolicyModel> {
    const created = await this.prisma.staffScorecardPolicy.create({
      data: {
        tenant_id: tenantId,
        weight_punctuality: policy.weight_punctuality,
        weight_retention: policy.weight_retention,
        weight_volume: policy.weight_volume,
        tolerance_minutes: policy.tolerance_minutes,
        chat_evidence_minutes: policy.chat_evidence_minutes,
        target_visits_per_day: policy.target_visits_per_day,
        working_days_per_month: policy.working_days_per_month,
        min_sample_punctuality: policy.min_sample_punctuality,
        min_sample_retention: policy.min_sample_retention,
        min_tenure_months: policy.min_tenure_months,
        grade_a_min: policy.grade_a_min,
        grade_b_min: policy.grade_b_min,
        grade_c_min: policy.grade_c_min,
        grade_d_min: policy.grade_d_min,
        formula_version: policy.formula_version,
        effective_from: policy.effective_from,
        effective_to: null,
      },
    });
    return created;
  }

  /**
   * Laporan nilai per periode. Snapshot FINAL dipakai apa adanya (tidak dihitung ulang).
   */
  async getReport(params: {
    tenantId: string;
    year: number;
    month: number;
    staffId?: string | null;
    includeFrozen?: boolean;
    now?: Date;
  }): Promise<StaffScorecardReport> {
    const { tenantId, year, month } = params;
    const policy = await this.getPolicy(tenantId);

    let staffList: any[] = [];
    try {
      staffList = await this.prisma.staff.findMany({
        where: {
          tenant_id: tenantId,
          active: true,
          incentive_eligible: true,
          ...(params.staffId ? { id: params.staffId } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    } catch {
      staffList = [];
    }

    const ids = (staffList || []).map((staff: any) => staff.id);
    let snapshots: any[] = [];
    if (ids.length > 0) {
      try {
        snapshots = await this.prisma.staffScorecardSnapshot.findMany({
          where: {
            tenant_id: tenantId,
            period_year: year,
            period_month: month,
            staff_id: { in: ids },
          },
        });
      } catch {
        snapshots = [];
      }
    }

    const snapshotMap = new Map<string, any>(
      (snapshots || []).map((snapshot: any) => [snapshot.staff_id, snapshot])
    );

    const items: StaffScorecardItem[] = [];
    for (const staff of staffList || []) {
      const snapshot = snapshotMap.get(staff.id);
      if (
        snapshot &&
        snapshot.status === 'FINAL' &&
        params.includeFrozen !== false
      ) {
        items.push(this.itemFromSnapshot(snapshot));
        continue;
      }
      items.push(await this.computeItem(tenantId, staff, year, month, policy, params.now ?? new Date()));
    }

    return { tenantId, periodYear: year, periodMonth: month, policy, items };
  }

  private async computeItem(
    tenantId: string,
    staff: any,
    year: number,
    month: number,
    policy: StaffScorecardPolicyModel,
    now: Date
  ): Promise<StaffScorecardItem> {
    const period = resolveScorecardPeriod(year, month, now);

    let reservations: any[] = [];
    try {
      reservations = await this.prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assigned_staff_id: staff.id,
          status: 'completed',
          booking_date: { gte: period.from, lt: period.to },
        },
        select: { id: true, booking_date: true, arrived_at: true },
      });
    } catch {
      reservations = [];
    }

    let onTime = 0;
    let lateMeasured = 0;
    const unmeasuredIds: string[] = [];

    for (const reservation of reservations || []) {
      if (reservation.arrived_at && reservation.booking_date) {
        const diffMinutes =
          (new Date(reservation.arrived_at).getTime() -
            new Date(reservation.booking_date).getTime()) /
          60000;
        if (diffMinutes <= policy.tolerance_minutes) onTime += 1;
        else lateMeasured += 1;
      } else if (reservation.id) {
        unmeasuredIds.push(reservation.id);
      }
    }

    let chatLate = 0;
    if (unmeasuredIds.length > 0) {
      try {
        const evidences = await this.prisma.visitArrivalEvidence.findMany({
          where: {
            tenant_id: tenantId,
            source: 'CHAT',
            review_status: 'APPROVED',
            reservation_id: { in: unmeasuredIds },
          },
          select: { reservation_id: true, observed_minutes: true },
        });
        const reservationsWithChat = new Set<string>();
        for (const evidence of evidences || []) {
          if (
            evidence.reservation_id &&
            (evidence.observed_minutes ?? 0) > policy.chat_evidence_minutes
          ) {
            reservationsWithChat.add(evidence.reservation_id);
          }
        }
        chatLate = reservationsWithChat.size;
      } catch {
        chatLate = 0;
      }
    }

    const unknown = Math.max(0, unmeasuredIds.length - chatLate);
    const punctuality = computePunctuality({
      onTime,
      lateMeasured,
      chatLate,
      unknown,
      minSample: policy.min_sample_punctuality,
    });

    const volume = computeVolume({
      visits: (reservations || []).length,
      periodDays: period.periodDays,
      daysInMonth: period.daysInMonth,
      targetPerDay: policy.target_visits_per_day,
      workingDaysPerMonth: policy.working_days_per_month,
    });

    const retentionMonth =
      month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

    let retentionItem: any = null;
    try {
      const retentionReport = await this.retention.computeForPeriod(
        tenantId,
        retentionMonth.year,
        retentionMonth.month
      );
      retentionItem =
        (retentionReport?.report?.items || []).find(
          (item: any) => item.staffId === staff.id
        ) || null;
    } catch {
      retentionItem = null;
    }

    const retentionPct = retentionItem?.retentionPct ?? null;
    const retentionEligible = retentionItem?.status === 'OK';
    const retentionStatus = retentionItem
      ? retentionItem.status === 'OK'
        ? 'OK'
        : `${retentionItem.status}${retentionItem.skipReason ? ':' + retentionItem.skipReason : ''}`
      : 'NO_DATA';

    const composed = composeScore({
      punctuality: {
        pct: punctuality.pct,
        assessed: punctuality.assessed,
        minSample: policy.min_sample_punctuality,
      },
      retention: { pct: retentionPct, eligible: retentionEligible },
      volume: { pct: volume.pct },
      weights: {
        punctuality: policy.weight_punctuality,
        retention: policy.weight_retention,
        volume: policy.weight_volume,
      },
      thresholds: {
        aMin: policy.grade_a_min,
        bMin: policy.grade_b_min,
        cMin: policy.grade_c_min,
        dMin: policy.grade_d_min,
      },
    });

    const total = punctuality.total;
    const coveragePct =
      total > 0 ? Math.round((punctuality.assessed / total) * 1000) / 10 : 0;

    return {
      staffId: staff.id,
      staffName: staff.name,
      periodYear: year,
      periodMonth: month,
      punctuality: {
        pct: punctuality.pct,
        onTime,
        lateMeasured,
        chatLate,
        unknown,
        assessed: punctuality.assessed,
        total,
        status: punctuality.status,
      },
      retention: {
        pct: retentionPct,
        eligible: retentionEligible,
        status: retentionStatus,
        cohortN: retentionItem?.cohortN ?? 0,
        retainedN: retentionItem?.retainedN ?? 0,
        benchmarkPct: retentionItem?.benchmarkPct ?? null,
      },
      volume: { pct: volume.pct, visits: volume.visits, target: volume.target },
      coveragePct,
      score: composed.score,
      grade: composed.grade,
      usedWeights: composed.usedWeights,
      excluded: composed.excluded,
      status: 'PREVIEW',
      computedAt: new Date().toISOString(),
    };
  }

  private itemFromSnapshot(snapshot: any): StaffScorecardItem {
    const measured = snapshot.measured_n ?? 0;
    const chat = snapshot.chat_late_n ?? 0;
    const unknown = snapshot.unknown_n ?? 0;

    return {
      staffId: snapshot.staff_id,
      staffName: snapshot.staff_name,
      periodYear: snapshot.period_year,
      periodMonth: snapshot.period_month,
      punctuality: {
        pct: snapshot.punctuality_pct ?? null,
        onTime: 0,
        lateMeasured: measured,
        chatLate: chat,
        unknown,
        assessed: measured + chat,
        total: measured + chat + unknown,
        status: 'FROZEN',
      },
      retention: {
        pct: snapshot.retention_pct ?? null,
        eligible: snapshot.retention_pct != null,
        status: 'FROZEN',
        cohortN: 0,
        retainedN: 0,
        benchmarkPct: null,
      },
      volume: { pct: snapshot.volume_pct ?? null, visits: measured, target: 0 },
      coveragePct: snapshot.coverage_pct ?? 0,
      score: snapshot.weighted_score ?? null,
      grade: snapshot.grade ?? null,
      usedWeights: { punctuality: 0, retention: 0, volume: 0 },
      excluded: [],
      status: 'FINAL',
      computedAt: snapshot.computed_at
        ? new Date(snapshot.computed_at).toISOString()
        : new Date().toISOString(),
    };
  }

  /**
   * Membekukan nilai per periode. Snapshot FINAL yang sudah ada tidak ditimpa.
   */
  async freezePeriod(params: {
    tenantId: string;
    year: number;
    month: number;
    staffId?: string | null;
    actor: string;
  }): Promise<FreezeScorecardResult> {
    const report = await this.getReport({
      tenantId: params.tenantId,
      year: params.year,
      month: params.month,
      staffId: params.staffId,
      includeFrozen: false,
    });

    let written = 0;
    let skipped = 0;

    for (const item of report.items) {
      const where = {
        tenant_id_staff_id_period_year_period_month: {
          tenant_id: params.tenantId,
          staff_id: item.staffId,
          period_year: params.year,
          period_month: params.month,
        },
      };

      let existing: any = null;
      try {
        existing = await this.prisma.staffScorecardSnapshot.findUnique({ where });
      } catch {
        existing = null;
      }

      if (existing?.status === 'FINAL') {
        skipped += 1;
        continue;
      }

      const data = {
        staff_name: item.staffName,
        punctuality_pct: item.punctuality.pct,
        retention_pct: item.retention.eligible ? item.retention.pct : null,
        volume_pct: item.volume.pct,
        weighted_score: item.score,
        grade: item.grade,
        coverage_pct: item.coveragePct,
        measured_n: Math.max(0, item.punctuality.assessed - item.punctuality.chatLate),
        chat_late_n: item.punctuality.chatLate,
        unknown_n: item.punctuality.unknown,
        status: 'FINAL',
        computed_by: params.actor,
        computed_at: new Date(),
      };

      await this.prisma.staffScorecardSnapshot.upsert({
        where,
        create: {
          tenant_id: params.tenantId,
          staff_id: item.staffId,
          period_year: params.year,
          period_month: params.month,
          ...data,
        },
        update: data,
      });
      written += 1;
    }

    return { written, skipped, items: report.items };
  }
}


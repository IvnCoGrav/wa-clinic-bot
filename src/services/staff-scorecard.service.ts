/**
 * staff-scorecard.service.ts — policy penilaian bidan (versioned).
 *
 * F3: hanya policy. Agregasi nilai menyusul di F5.
 */

import { prisma as defaultPrisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { validateWeights } from '../domain/staff-scorecard';

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

const DEFAULT_STAFF_SCORECARD_POLICY: StaffScorecardPolicyModel = {
  tenant_id: DEFAULT_TENANT_ID,
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

class StaffScorecardService {
  constructor(private readonly prisma: any = defaultPrisma) {}

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
}

export const staffScorecardService = new StaffScorecardService();

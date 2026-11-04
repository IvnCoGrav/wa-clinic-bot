import { prisma as defaultPrisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import {
  RetentionVisitRow,
  RetentionPolicyInput,
  CohortCustomer,
  buildVisits,
  selectCohort,
  calculateRetention,
  resolveFinalTier,
  applySoftLanding,
  addDays,
  subtractMonths,
} from '../domain/staff-retention';

export interface RetentionPolicyModel {
  id?: string;
  tenant_id: string;
  window_days: number;
  pool_months: number;
  benchmark_pct: number;
  tier1_max_pct: number;
  tier2_max_pct: number;
  split_tier1: number;
  split_tier2: number;
  split_tier3: number;
  min_sample: number;
  min_tenure_months: number;
  downgrade_periods: number;
  soft_landing_until: Date | null;
  effective_from: Date;
  effective_to?: Date | null;
  formula_version: string;
  is_fallback?: boolean;
  db_empty?: boolean;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicyModel = {
  tenant_id: DEFAULT_TENANT_ID,
  window_days: 60,
  pool_months: 6,
  benchmark_pct: 34.6,
  tier1_max_pct: 31.1,
  tier2_max_pct: 38.1,
  split_tier1: 50,
  split_tier2: 55,
  split_tier3: 60,
  min_sample: 40,
  min_tenure_months: 4,
  downgrade_periods: 2,
  soft_landing_until: new Date('2027-02-28T23:59:59.999Z'),
  effective_from: new Date('2026-11-04T00:00:00.000Z'),
  effective_to: null,
  formula_version: 'v1',
};

export interface StaffRetentionReportItem {
  staffId: string | null;
  staffName: string;
  cohortN: number;
  retainedN: number;
  retentionPct: number | null;
  benchmarkPct: number;
  retentionIndex: number | null;
  rawTier: 1 | 2 | 3 | null;
  finalTier: 1 | 2 | 3 | null;
  splitPct: number;
  status: 'OK' | 'INSUFFICIENT_SAMPLE' | 'SKIPPED';
  skipReason: string | null;
  downgradeStreak: number;
}

export interface StaffRetentionReport {
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  asOf: string;
  windowDays: number;
  poolStart: string;
  poolEnd: string;
  benchmarkPct: number;
  status: 'DRAFT' | 'PREVIEW' | 'FINAL';
  formulaVersion: string;
  items: StaffRetentionReportItem[];
}

export interface DrilldownCustomerItem {
  customerId: string;
  customerName: string;
  customerPhone: string;
  firstVisitDate: string;
  lastVisitDate: string;
  totalVisits: number;
  isRetained: boolean;
  sameStaffVisits: number;
  otherStaffVisits: number;
}

export class StaffRetentionService {
  constructor(private readonly prisma = defaultPrisma) {}

  /**
   * 3.1 Ambil policy aktif berdasarkan asOfDate. Fallback ke DEFAULT_RETENTION_POLICY jika DB offline/kosong.
   */
  async getPolicy(tenantId: string = DEFAULT_TENANT_ID, asOfDate: Date = new Date()): Promise<RetentionPolicyModel> {
    let dbEmpty = false;
    try {
      const policy = await this.prisma.retentionPolicy.findFirst({
        where: {
          tenant_id: tenantId,
          effective_from: { lte: asOfDate },
          OR: [{ effective_to: null }, { effective_to: { gte: asOfDate } }],
        },
        orderBy: { effective_from: 'desc' },
      });

      if (policy) {
        return {
          ...policy,
          is_fallback: false,
          db_empty: false,
        };
      }
      dbEmpty = true;
      console.warn(`[RETENTION POLICY] Warning: No active retention policy configured in DB for tenant: ${tenantId}`);
    } catch (err) {
      console.warn('[RETENTION] policy query failed, falling back to defaults:', (err as Error).message);
    }

    return {
      ...DEFAULT_RETENTION_POLICY,
      tenant_id: tenantId,
      is_fallback: true,
      db_empty: dbEmpty,
    };
  }

  /**
   * 3.2 Ambil kunjungan valid per (customer, tanggal WIB) dari database via SQL kanonis.
   */
  async fetchVisits(
    tenantId: string,
    fromDateStr: string,
    toDateStr: string
  ): Promise<RetentionVisitRow[]> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ customerId: string; visitDate: string; staffId: string | null }>>`
        WITH all_visits AS (
          SELECT
            r.customer_id,
            ((r.booking_date + interval '7 hours')::date) AS visit_date,
            (ARRAY_AGG(r.assigned_staff_id ORDER BY r.created_at)
               FILTER (WHERE r.assigned_staff_id IS NOT NULL))[1] AS staff_id
          FROM reservations r
          JOIN customers c ON c.id = r.customer_id
          WHERE r.tenant_id = ${tenantId}
            AND r.status = 'completed'
            AND r.booking_date IS NOT NULL
            AND c.is_sandbox_test = false
            AND c.is_internal_staff = false
            AND c.deleted_at IS NULL
            AND (r.series_id IS NULL OR r.session_number = 1)
          GROUP BY 1, 2
        ),
        ranked AS (
          SELECT
            customer_id,
            visit_date,
            staff_id,
            MIN(visit_date) OVER (PARTITION BY customer_id) AS min_visit_date
          FROM all_visits
        )
        SELECT customer_id AS "customerId", visit_date::text AS "visitDate", staff_id AS "staffId"
        FROM ranked
        WHERE visit_date <= ${toDateStr}::date
          AND (visit_date >= ${fromDateStr}::date OR visit_date = min_visit_date)
        ORDER BY customer_id, visit_date;
      `;

      return (rows || []).map((r) => ({
        customerId: r.customerId,
        visitDate: r.visitDate,
        staffId: r.staffId ?? null,
      }));
    } catch (err) {
      console.warn('[RETENTION] fetchVisits raw query failed:', (err as Error).message);
      throw err;
    }
  }

  /**
   * 3.3 Hitung retensi bidan untuk satu periode bulan/tahun.
   */
  async computeForPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
    opts: {
      persist?: boolean;
      status?: 'DRAFT' | 'PREVIEW' | 'FINAL';
      actor?: string;
    } = {}
  ): Promise<{ report: StaffRetentionReport; cohort: CohortCustomer[] }> {
    // 1. Tentukan batas akhir bulan (asOf)
    const lastDayOfMonth = new Date(Date.UTC(periodYear, periodMonth, 0)).getUTCDate();
    const asOfStr = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const asOfDate = new Date(`${asOfStr}T23:59:59.999Z`);

    // 2. Baca policy aktif
    const policy = await this.getPolicy(tenantId, asOfDate);

    // 3. Hitung rentang pool
    const poolEnd = addDays(asOfStr, -policy.window_days);
    const poolStart = subtractMonths(poolEnd, policy.pool_months);

    // 4. Ambil kunjungan & hitung kohort (M12: kueri otomatis menyertakan first_visit seumur hidup)
    const visitRows = await this.fetchVisits(tenantId, poolStart, asOfStr);
    const visits = buildVisits(visitRows);
    const cohort = selectCohort(visits, {
      asOf: asOfStr,
      windowDays: policy.window_days,
      poolMonths: policy.pool_months,
      poolStart,
      poolEnd,
    });

    // 5. Cek soft landing
    const isSoftLandingActive =
      policy.soft_landing_until !== null && asOfDate <= new Date(policy.soft_landing_until);

    const domainPolicyInput: RetentionPolicyInput = {
      windowDays: policy.window_days,
      benchmarkPct: policy.benchmark_pct,
      tier1MaxPct: policy.tier1_max_pct,
      tier2MaxPct: policy.tier2_max_pct,
      splitTier1: policy.split_tier1,
      splitTier2: policy.split_tier2,
      splitTier3: policy.split_tier3,
      minSample: policy.min_sample,
      downgradePeriods: policy.downgrade_periods,
      softLanding: isSoftLandingActive,
    };

    const retentionResults = calculateRetention(cohort, domainPolicyInput);
    const retentionMap = new Map(retentionResults.map((r) => [r.staffId, r]));

    // 6. Muat daftar staf aktif dari DB
    let staffList: Array<{
      id: string;
      name: string;
      role: string;
      active: boolean;
      incentive_eligible: boolean;
      incentive_scheme: string;
      employment_started_at: Date | null;
      created_at: Date;
    }> = [];

    try {
      const res = await this.prisma.staff.findMany({
        where: { tenant_id: tenantId, active: true },
        select: {
          id: true,
          name: true,
          role: true,
          active: true,
          incentive_eligible: true,
          incentive_scheme: true,
          employment_started_at: true,
          created_at: true,
        },
      });
      staffList = Array.isArray(res) ? (res as any) : [];
    } catch {
      // Fallback: jika staf tidak dapat dimuat, gunakan staf yang ada di retention results
      staffList = [];
    }

    // Tentukan periode sebelumnya untuk hysteresis
    const prevYear = periodMonth === 1 ? periodYear - 1 : periodYear;
    const prevMonth = periodMonth === 1 ? 12 : periodMonth - 1;

    // Ambil previous snapshots untuk evaluasi hysteresis
    const prevSnapshotMap = new Map<
      string,
      { finalTier: 1 | 2 | 3 | null; rawTier: 1 | 2 | 3 | null; downgradeStreak: number }
    >();
    try {
      const prevSnapshots = await this.prisma.staffRetentionSnapshot.findMany({
        where: {
          tenant_id: tenantId,
          period_year: prevYear,
          period_month: prevMonth,
        },
      });
      if (Array.isArray(prevSnapshots)) {
        for (const s of prevSnapshots) {
          prevSnapshotMap.set(s.staff_id, {
            finalTier: (s.final_tier as 1 | 2 | 3 | null) ?? null,
            rawTier: (s.raw_tier as 1 | 2 | 3 | null) ?? null,
            downgradeStreak: s.downgrade_streak ?? 0,
          });
        }
      }
    } catch {
      // Offline fallback: tidak ada previous snapshot
    }

    const items: StaffRetentionReportItem[] = [];

    // Proses staf yang terdaftar di database
    for (const s of staffList) {
      const ret = retentionMap.get(s.id);
      const cohortN = ret ? ret.cohortN : 0;
      const retainedN = ret ? ret.retainedN : 0;
      const retentionPct = ret ? ret.retentionPct : null;
      const retentionIndex = ret ? ret.retentionIndex : null;
      let rawTier = ret ? ret.rawTier : null;

      // Evaluasi kelayakan (eligibility)
      if (!s.incentive_eligible) {
        items.push({
          staffId: s.id,
          staffName: s.name,
          cohortN,
          retainedN,
          retentionPct,
          benchmarkPct: policy.benchmark_pct,
          retentionIndex,
          rawTier: null,
          finalTier: null,
          splitPct: policy.split_tier1,
          status: 'SKIPPED',
          skipReason: 'OWNER_OR_NOT_ELIGIBLE',
          downgradeStreak: 0,
        });
        continue;
      }

      if (s.incentive_scheme === 'VOLUME') {
        items.push({
          staffId: s.id,
          staffName: s.name,
          cohortN,
          retainedN,
          retentionPct,
          benchmarkPct: policy.benchmark_pct,
          retentionIndex,
          rawTier: null,
          finalTier: null,
          splitPct: policy.split_tier1,
          status: 'SKIPPED',
          skipReason: 'VOLUME_SCHEME',
          downgradeStreak: 0,
        });
        continue;
      }

      // Evaluasi masa kerja (tenure) presisi kalender (M10)
      const startDate = s.employment_started_at || s.created_at;
      let tenureMonths = 0;
      if (asOfDate >= startDate) {
        const yearsDiff = asOfDate.getUTCFullYear() - startDate.getUTCFullYear();
        const monthsDiff = asOfDate.getUTCMonth() - startDate.getUTCMonth();
        const daysDiff = asOfDate.getUTCDate() - startDate.getUTCDate();
        tenureMonths = yearsDiff * 12 + monthsDiff;
        if (daysDiff < 0) {
          tenureMonths -= 1;
        }
      }

      if (tenureMonths < policy.min_tenure_months) {
        items.push({
          staffId: s.id,
          staffName: s.name,
          cohortN,
          retainedN,
          retentionPct,
          benchmarkPct: policy.benchmark_pct,
          retentionIndex,
          rawTier: null,
          finalTier: null,
          splitPct: policy.split_tier1,
          status: 'SKIPPED',
          skipReason: 'TENURE',
          downgradeStreak: 0,
        });
        continue;
      }

      // Evaluasi ukuran sampel
      if (cohortN < policy.min_sample) {
        items.push({
          staffId: s.id,
          staffName: s.name,
          cohortN,
          retainedN,
          retentionPct,
          benchmarkPct: policy.benchmark_pct,
          retentionIndex,
          rawTier: null,
          finalTier: null,
          splitPct: policy.split_tier1,
          status: 'INSUFFICIENT_SAMPLE',
          skipReason: null,
          downgradeStreak: 0,
        });
        continue;
      }

      // Evaluasi Hysteresis
      const prev = prevSnapshotMap.get(s.id);
      const prevTier = prev?.finalTier ?? null;
      const prevDowngradeStreak = prev?.downgradeStreak ?? 0;
      const { finalTier, downgradeStreak } = resolveFinalTier(
        rawTier,
        prevTier,
        prevDowngradeStreak,
        domainPolicyInput
      );

      // Hitung splitPct dari finalTier
      let splitPct = policy.split_tier1;
      if (finalTier === 2) splitPct = policy.split_tier2;
      else if (finalTier === 3) splitPct = policy.split_tier3;

      if (isSoftLandingActive) {
        splitPct = applySoftLanding(splitPct, domainPolicyInput);
      }

      items.push({
        staffId: s.id,
        staffName: s.name,
        cohortN,
        retainedN,
        retentionPct,
        benchmarkPct: policy.benchmark_pct,
        retentionIndex,
        rawTier,
        finalTier,
        splitPct,
        status: 'OK',
        skipReason: null,
        downgradeStreak,
      });
    }

    // Periksa jika ada unassigned cohort (kunjungan tanpa staf)
    const unassigned = retentionMap.get(null);
    if (unassigned && unassigned.cohortN > 0) {
      items.push({
        staffId: null,
        staffName: 'Tanpa Bidan (UNASSIGNED)',
        cohortN: unassigned.cohortN,
        retainedN: unassigned.retainedN,
        retentionPct: unassigned.retentionPct,
        benchmarkPct: policy.benchmark_pct,
        retentionIndex: unassigned.retentionIndex,
        rawTier: null,
        finalTier: null,
        splitPct: policy.split_tier1,
        status: 'SKIPPED',
        skipReason: 'UNASSIGNED_STAFF',
        downgradeStreak: 0,
      });
    }

    const reportStatus = opts.status ?? 'DRAFT';

    const report: StaffRetentionReport = {
      tenantId,
      periodYear,
      periodMonth,
      asOf: asOfStr,
      windowDays: policy.window_days,
      poolStart,
      poolEnd,
      benchmarkPct: policy.benchmark_pct,
      status: reportStatus,
      formulaVersion: policy.formula_version,
      items,
    };

    // Gate Keras 6.5: Laporan snapshot FINAL tidak boleh diterbitkan jika ada reservasi completed tanpa bidan di dalam pool
    if (opts.status === 'FINAL' && unassigned && unassigned.cohortN > 0) {
      const err = new Error(
        `Gate Keras 6.5 Terlanggar: Terdapat ${unassigned.cohortN} pasien completed tanpa penugasan bidan di dalam pool ${poolStart} s/d ${poolEnd}. Lengkapi data penugasan bidan terlebih dahulu sebelum membekukan snapshot FINAL payroll.`
      ) as any;
      err.statusCode = 422;
      err.code = 'UNASSIGNED_POOL_RESERVATIONS_BLOCKED';
      throw err;
    }

    // Gate Fail-Safe Policy Kosong: Snapshot FINAL tidak boleh dibekukan menggunakan fallback default
    if (opts.status === 'FINAL' && policy.db_empty) {
      const err = new Error(
        'Pembekuan snapshot FINAL dilarang sebelum tabel retention_policies dikonfigurasi di database.'
      ) as any;
      err.statusCode = 422;
      err.code = 'RETENTION_POLICY_NOT_CONFIGURED';
      throw err;
    }

    // 7. Persist snapshot jika diminta
    if (opts.persist) {
      await this.persistSnapshot(report, policy.id, opts.actor);
    }

    return { report, cohort };
  }

  /**
   * 3.4 Persist snapshot ke tabel staff_retention_snapshots.
   */
  async persistSnapshot(
    report: StaffRetentionReport,
    policyId?: string,
    actor?: string
  ): Promise<void> {
    for (const item of report.items) {
      if (!item.staffId) continue; // Jangan simpan unassigned ke payroll snapshots

      try {
        await this.prisma.staffRetentionSnapshot.upsert({
          where: {
            tenant_id_staff_id_period_year_period_month: {
              tenant_id: report.tenantId,
              staff_id: item.staffId,
              period_year: report.periodYear,
              period_month: report.periodMonth,
            },
          },
          create: {
            tenant_id: report.tenantId,
            staff_id: item.staffId,
            staff_name: item.staffName,
            period_year: report.periodYear,
            period_month: report.periodMonth,
            policy_id: policyId ?? null,
            window_days: report.windowDays,
            pool_start: new Date(`${report.poolStart}T00:00:00.000Z`),
            pool_end: new Date(`${report.poolEnd}T23:59:59.999Z`),
            cohort_n: item.cohortN,
            retained_n: item.retainedN,
            retention_pct: item.retentionPct,
            benchmark_pct: item.benchmarkPct,
            retention_index: item.retentionIndex,
            raw_tier: item.rawTier,
            final_tier: item.finalTier,
            split_pct: item.splitPct,
            downgrade_streak: item.downgradeStreak,
            status: report.status,
            skip_reason: item.skipReason,
            formula_version: report.formulaVersion,
            computed_by: actor ?? 'system',
          },
          update: {
            staff_name: item.staffName,
            cohort_n: item.cohortN,
            retained_n: item.retainedN,
            retention_pct: item.retentionPct,
            benchmark_pct: item.benchmarkPct,
            retention_index: item.retentionIndex,
            raw_tier: item.rawTier,
            final_tier: item.finalTier,
            split_pct: item.splitPct,
            downgrade_streak: item.downgradeStreak,
            status: report.status,
            skip_reason: item.skipReason,
            computed_at: new Date(),
            computed_by: actor ?? 'system',
          },
        });
      } catch (err) {
        if (report.status === 'FINAL') {
          throw new Error(
            `Gagal membekukan snapshot FINAL untuk staf ${item.staffName || item.staffId}: ${(err as Error).message}`
          );
        }
        console.warn('[RETENTION] persistSnapshot failed for staff:', item.staffId, (err as Error).message);
      }
    }
  }

  /**
   * 3.4 Ambil drilldown pasien cohort untuk hak banding staf.
   */
  async getDrilldown(
    tenantId: string,
    staffId: string | null,
    periodYear: number,
    periodMonth: number
  ): Promise<DrilldownCustomerItem[]> {
    const { cohort } = await this.computeForPeriod(tenantId, periodYear, periodMonth);
    const filteredCohort = cohort.filter((c) => c.originStaffId === staffId);

    if (filteredCohort.length === 0) {
      return [];
    }

    const customerIds = filteredCohort.map((c) => c.customerId);
    const customerMap = new Map<string, { name: string; phone: string }>();

    try {
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true, phone: true },
      });
      for (const cust of customers) {
        customerMap.set(cust.id, { name: cust.name ?? '', phone: cust.phone ?? '' });
      }
    } catch {
      // Offline fallback
    }

    return filteredCohort.map((c) => {
      const custInfo = customerMap.get(c.customerId);
      return {
        customerId: c.customerId,
        customerName: custInfo?.name ?? `Pasien ${c.customerId.slice(0, 8)}`,
        customerPhone: custInfo?.phone ? maskPhoneNumber(custInfo.phone) : '',
        firstVisitDate: c.firstVisitDate,
        lastVisitDate: c.lastVisitDate,
        totalVisits: c.totalVisits,
        isRetained: c.isRetained,
        sameStaffVisits: c.sameStaffVisits,
        otherStaffVisits: c.otherStaffVisits,
      };
    });
  }
}

function maskPhoneNumber(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 8) return '****';
  return cleaned.slice(0, 4) + '****' + cleaned.slice(-3);
}

export const staffRetentionService = new StaffRetentionService();

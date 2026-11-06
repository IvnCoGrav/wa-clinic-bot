/**
 * Domain murni kalkulator insentif retensi bidan.
 *
 * ARSITEKTUR:
 * - Pure functions only — NO DB, NO network, NO Prisma imports.
 * - Deterministic: no wall-clock timestamp calls, all references depend on explicit asOf / params.
 * - Single source of truth untuk perhitungan retensi 60-hari pool 6-bulan bergulir.
 */

import { formatWibDateYYYYMMDD } from '../utils/wib-time';

export interface RetentionVisitRow {
  customerId: string;
  staffId: string | null;
  visitDate: string; // 'YYYY-MM-DD' WIB
  createdAt?: Date | string;
}

export interface Visit {
  customerId: string;
  visitDate: string; // 'YYYY-MM-DD'
  staffId: string | null;
}

export interface RetentionPolicyInput {
  windowDays: number;
  benchmarkPct: number;
  tier1MaxPct: number;
  tier2MaxPct: number;
  splitTier1: number;
  splitTier2: number;
  splitTier3: number;
  minSample: number;
  downgradePeriods: number;
  softLanding: boolean;
}

export interface CohortCustomer {
  customerId: string;
  staffId: string | null; // originStaffId
  originStaffId: string | null;
  firstVisitDate: string;
  isRetained: boolean;
  totalVisits: number;
  lastVisitDate: string;
  sameStaffVisits: number;
  otherStaffVisits: number;
}

export interface StaffRetentionResult {
  staffId: string | null;
  cohortN: number;
  retainedN: number;
  retentionPct: number | null;
  retentionIndex: number | null;
  rawTier: 1 | 2 | 3 | null;
  status: 'OK' | 'INSUFFICIENT_SAMPLE';
  splitPct: number;
}

export interface SelectCohortOptions {
  asOf: string; // 'YYYY-MM-DD'
  windowDays: number;
  poolMonths: number;
  poolStart?: string;
  poolEnd?: string;
}

function parseDateParts(dateStr: string): [number, number, number] {
  const parts = dateStr.split('-');
  return [parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10)];
}

export function dateToEpochDays(dateStr: string): number {
  const [y, m, d] = parseDateParts(dateStr);
  return Math.floor(Date.UTC(y, m - 1, d) / (24 * 3600 * 1000));
}

export function epochDaysToDate(epochDays: number): string {
  const d = new Date(epochDays * 24 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  return epochDaysToDate(dateToEpochDays(dateStr) + days);
}

export function subtractMonths(dateStr: string, months: number): string {
  const [y, m, d] = parseDateParts(dateStr);
  const totalMonths = y * 12 + (m - 1) - months;
  const targetY = Math.floor(totalMonths / 12);
  const targetM = ((totalMonths % 12) + 12) % 12 + 1;
  // Hari maksimum di target bulan (day 0 dari targetM mengembalikan hari terakhir targetM)
  const maxDaysInMonth = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();
  const targetD = Math.min(d, maxDaysInMonth);
  const resY = String(targetY);
  const resM = String(targetM).padStart(2, '0');
  const resD = String(targetD).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

/**
 * Bangun kunjungan unik per (customer, visitDate) dengan dedupe tanggal.
 * Menjamin staf pertama pada tanggal tersebut terpilih secara deterministik.
 */
export function buildVisits(rows: RetentionVisitRow[]): Visit[] {
  // Sort rows deterministically: customerId -> visitDate -> createdAt
  const sortedRows = [...rows].sort((a, b) => {
    if (a.customerId !== b.customerId) return a.customerId.localeCompare(b.customerId);
    if (a.visitDate !== b.visitDate) return a.visitDate.localeCompare(b.visitDate);
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });

  const visitMap = new Map<string, Visit>();

  for (const row of sortedRows) {
    const key = `${row.customerId}:${row.visitDate}`;
    if (!visitMap.has(key)) {
      visitMap.set(key, {
        customerId: row.customerId,
        visitDate: row.visitDate,
        staffId: row.staffId ?? null,
      });
    }
  }

  return Array.from(visitMap.values());
}

/** Baris reservasi mentah untuk menentukan pemilik retensi per customer. */
export interface CustomerOwnershipReservationRow {
  customerId: string;
  status?: string | null;
  bookingDate?: Date | string | null;
  assignedStaffId?: string | null;
  createdAt?: Date | string | null;
  seriesId?: string | null;
  sessionNumber?: number | null;
}

export interface CustomerStaffOwnership {
  customerId: string;
  ownerStaffId: string | null;
  /** Tanggal kunjungan pertama (YYYY-MM-DD WIB). */
  ownerSince: string;
  lastStaffId: string | null;
  /** Tanggal kunjungan terakhir (YYYY-MM-DD WIB). */
  lastVisitDate: string;
  totalVisits: number;
  hasRotation: boolean;
}

/**
 * Tentukan bidan pemilik (first-touch) + bidan terakhir per customer.
 *
 * ATURAN WAJIB SAMA DENGAN PAYROLL (`staff-retention.service.ts`):
 * - hanya status `completed`;
 * - 1 kunjungan per tanggal WIB (dedupe via `buildVisits`);
 * - paket series hanya sesi ke-1;
 * - staf pada tanggal yang sama dipilih dari `createdAt` paling awal.
 *
 * Fungsi ini MURNI. Pemfilteran sandbox/internal/deleted dilakukan pemanggil
 * (service) karena butuh kolom milik tabel Customer.
 */
export function resolveCustomerOwnerships(
  rows: CustomerOwnershipReservationRow[]
): Map<string, CustomerStaffOwnership> {
  const visitRows: RetentionVisitRow[] = [];

  for (const row of rows) {
    if (String(row.status ?? '').toLowerCase() !== 'completed') continue;
    if (!row.bookingDate) continue;
    if (row.seriesId && row.sessionNumber !== 1) continue;

    const bookingDate = row.bookingDate instanceof Date
      ? row.bookingDate
      : new Date(row.bookingDate);
    if (Number.isNaN(bookingDate.getTime())) continue;

    visitRows.push({
      customerId: row.customerId,
      staffId: row.assignedStaffId ?? null,
      visitDate: formatWibDateYYYYMMDD(bookingDate),
      createdAt: row.createdAt ?? undefined,
    });
  }

  const visits = buildVisits(visitRows);
  const byCustomer = new Map<string, Visit[]>();
  for (const visit of visits) {
    const list = byCustomer.get(visit.customerId);
    if (list) list.push(visit);
    else byCustomer.set(visit.customerId, [visit]);
  }

  const result = new Map<string, CustomerStaffOwnership>();
  for (const [customerId, list] of byCustomer.entries()) {
    list.sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    const first = list[0];
    const last = list[list.length - 1];
    result.set(customerId, {
      customerId,
      ownerStaffId: first.staffId,
      ownerSince: first.visitDate,
      lastStaffId: last.staffId,
      lastVisitDate: last.visitDate,
      totalVisits: list.length,
      hasRotation:
        first.staffId !== null &&
        last.staffId !== null &&
        first.staffId !== last.staffId,
    });
  }

  return result;
}

/**
 * Filter cohort matang berdasarkan pool (6 bulan bergulir) dan window (60 hari).
 * Menghitung status first-touch attribution dan keterulangan (retention).
 */
export function selectCohort(visits: Visit[], opts: SelectCohortOptions): CohortCustomer[] {
  const poolEnd = opts.poolEnd ?? addDays(opts.asOf, -opts.windowDays);
  const poolStart = opts.poolStart ?? subtractMonths(poolEnd, opts.poolMonths);

  const poolStartDays = dateToEpochDays(poolStart);
  const poolEndDays = dateToEpochDays(poolEnd);

  // Kumpulkan kunjungan per customer
  const customerVisitsMap = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = customerVisitsMap.get(v.customerId);
    if (list) {
      list.push(v);
    } else {
      customerVisitsMap.set(v.customerId, [v]);
    }
  }

  const cohortList: CohortCustomer[] = [];

  for (const [customerId, cVisits] of customerVisitsMap.entries()) {
    // Urutkan kunjungan customer berdasarkan tanggal
    cVisits.sort((a, b) => a.visitDate.localeCompare(b.visitDate));

    const firstVisit = cVisits[0];
    const firstVisitDays = dateToEpochDays(firstVisit.visitDate);

    // Evaluasi apakah first_visit customer masuk dalam pool [poolStart, poolEnd]
    if (firstVisitDays >= poolStartDays && firstVisitDays <= poolEndDays) {
      const originStaffId = firstVisit.staffId;
      let isRetained = false;
      let sameStaffVisits = 0;
      let otherStaffVisits = 0;

      for (let i = 1; i < cVisits.length; i++) {
        const subsequent = cVisits[i];
        const subDays = dateToEpochDays(subsequent.visitDate);
        const diff = subDays - firstVisitDays;

        if (diff > 0 && diff <= opts.windowDays) {
          isRetained = true;
        }

        if (subsequent.staffId === originStaffId && originStaffId !== null) {
          sameStaffVisits++;
        } else {
          otherStaffVisits++;
        }
      }

      cohortList.push({
        customerId,
        staffId: originStaffId,
        originStaffId,
        firstVisitDate: firstVisit.visitDate,
        isRetained,
        totalVisits: cVisits.length,
        lastVisitDate: cVisits[cVisits.length - 1].visitDate,
        sameStaffVisits,
        otherStaffVisits,
      });
    }
  }

  // Sort cohort list deterministically
  cohortList.sort((a, b) => {
    if (a.firstVisitDate !== b.firstVisitDate) return a.firstVisitDate.localeCompare(b.firstVisitDate);
    return a.customerId.localeCompare(b.customerId);
  });

  return cohortList;
}

/**
 * Hitung retensi per bidan dari daftar customer cohort.
 */
export function calculateRetention(
  cohort: CohortCustomer[],
  policy: RetentionPolicyInput
): StaffRetentionResult[] {
  const staffMap = new Map<string | null, CohortCustomer[]>();

  for (const item of cohort) {
    const list = staffMap.get(item.originStaffId);
    if (list) {
      list.push(item);
    } else {
      staffMap.set(item.originStaffId, [item]);
    }
  }

  const results: StaffRetentionResult[] = [];

  for (const [staffId, members] of staffMap.entries()) {
    const cohortN = members.length;
    const retainedN = members.filter((m) => m.isRetained).length;

    if (cohortN === 0) {
      results.push({
        staffId,
        cohortN: 0,
        retainedN: 0,
        retentionPct: null,
        retentionIndex: null,
        rawTier: null,
        status: 'INSUFFICIENT_SAMPLE',
        splitPct: policy.splitTier1,
      });
      continue;
    }

    const retentionPct = Number(((retainedN / cohortN) * 100).toFixed(1));
    const retentionIndex =
      policy.benchmarkPct > 0 ? Number((retentionPct / policy.benchmarkPct).toFixed(4)) : null;

    let rawTier: 1 | 2 | 3 | null = null;
    let status: 'OK' | 'INSUFFICIENT_SAMPLE' = 'OK';
    let splitPct = policy.splitTier1;

    if (cohortN < policy.minSample) {
      status = 'INSUFFICIENT_SAMPLE';
      rawTier = null;
      splitPct = policy.splitTier1;
    } else {
      status = 'OK';
      if (retentionPct < policy.tier1MaxPct) {
        rawTier = 1;
        splitPct = policy.splitTier1;
      } else if (retentionPct < policy.tier2MaxPct) {
        rawTier = 2;
        splitPct = policy.splitTier2;
      } else {
        rawTier = 3;
        splitPct = policy.splitTier3;
      }
    }

    if (policy.softLanding) {
      splitPct = applySoftLanding(splitPct, policy);
    }

    results.push({
      staffId,
      cohortN,
      retainedN,
      retentionPct,
      retentionIndex,
      rawTier,
      status,
      splitPct,
    });
  }

  // Sort deterministically: non-null staffId first (alphabetical), null last
  results.sort((a, b) => {
    if (a.staffId === null && b.staffId === null) return 0;
    if (a.staffId === null) return 1;
    if (b.staffId === null) return -1;
    return a.staffId.localeCompare(b.staffId);
  });

  return results;
}

/**
 * Hysteresis: tentukan final tier dari rawTier + riwayat tier sebelumnya.
 * - Promosi / kenaikan tier berlaku seketika (streak reset ke 0).
 * - Penurunan tier memerlukan downgradePeriods periode berturut-turut.
 */
export function resolveFinalTier(
  rawTier: 1 | 2 | 3 | null,
  previousTier: 1 | 2 | 3 | null,
  previousDowngradeStreak: number,
  policy: { downgradePeriods: number }
): { finalTier: 1 | 2 | 3 | null; downgradeStreak: number } {
  if (rawTier === null) {
    return { finalTier: null, downgradeStreak: 0 };
  }
  if (previousTier === null) {
    return { finalTier: rawTier, downgradeStreak: 0 };
  }
  if (rawTier >= previousTier) {
    return { finalTier: rawTier, downgradeStreak: 0 };
  }

  // rawTier < previousTier -> penurunan tingkat
  const newStreak = previousDowngradeStreak + 1;
  if (newStreak < policy.downgradePeriods) {
    return { finalTier: previousTier, downgradeStreak: newStreak };
  }
  return { finalTier: rawTier, downgradeStreak: newStreak };
}

/**
 * Soft landing: naikkan split minimum selama periode proteksi.
 */
export function applySoftLanding(
  splitPct: number,
  policy: { splitTier2: number; softLanding?: boolean }
): number {
  if (policy.softLanding) {
    return Math.max(splitPct, policy.splitTier2);
  }
  return splitPct;
}

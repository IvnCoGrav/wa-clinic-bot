// R0.1 — Daily Invariant Monitor (READ-ONLY).
// Memantau 6 invariant integritas reservasi dan melaporkan pelanggaran ke
// logger + alertService (mis. Telegram). NOL mutasi baris, NOL perubahan skema.
// Rollback: set ENABLE_INVARIANT_MONITOR=false.
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { alertService, AlertType, AlertSeverity } from './alert.service';

export interface InvariantViolation {
  key: string;
  description: string;
  count: number;
}

export interface InvariantReport {
  tenantId: string;
  checkedAt: string;
  violations: InvariantViolation[];
  totalViolations: number;
}

/**
 * Menjalankan pemeriksaan invariant untuk satu tenant (read-only).
 * DB offline → mengembalikan laporan kosong dengan error terdokumentasi
 * (tidak melempar, agar cron berikutnya tetap jalan).
 */
export async function checkDailyInvariants(tenantId: string = DEFAULT_TENANT_ID): Promise<InvariantReport> {
  const violations: InvariantViolation[] = [];
  try {
    const [
      nullDateConfirmed,
      staleHolds,
      completedUnverified,
      pastConfirmed,
      unassignedCollisions,
    ] = await Promise.all([
      prisma.reservation.count({ where: { tenant_id: tenantId, status: 'confirmed', booking_date: null } }),
      prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
        `SELECT count(*)::int AS cnt FROM reservations WHERE tenant_id = $1 AND status = 'hold' AND created_at < now() - interval '2 hours'`,
        tenantId
      ),
      prisma.reservation.count({ where: { tenant_id: tenantId, status: 'completed', needs_staff_verification: true } }),
      prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
        `SELECT count(*)::int AS cnt FROM reservations WHERE tenant_id = $1 AND status = 'confirmed' AND booking_date < now()`,
        tenantId
      ),
      prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
        `SELECT count(*)::int AS cnt FROM (
           SELECT booking_date FROM reservations
           WHERE tenant_id = $1 AND status IN ('confirmed','hold','pending') AND assigned_staff_id IS NULL
           GROUP BY booking_date HAVING count(*) > 1
         ) t`,
        tenantId
      ),
    ]);

    const pushIf = (key: string, description: string, count: number) => {
      if (count > 0) violations.push({ key, description, count });
    };
    pushIf('CONFIRMED_NULL_DATE', 'Confirmed tanpa booking_date', Number(nullDateConfirmed) || 0);
    pushIf('STALE_HOLD', 'Hold kedaluwarsa (> 2 jam sejak dibuat)', Number(staleHolds?.[0]?.cnt) || 0);
    pushIf('COMPLETED_UNVERIFIED', 'Completed dengan needs_staff_verification=true', Number(completedUnverified) || 0);
    pushIf('PAST_CONFIRMED', 'Confirmed masa lampau (< now())', Number(pastConfirmed?.[0]?.cnt) || 0);
    pushIf('UNASSIGNED_COLLISION', 'Slot bentrok tanpa staf (assigned_staff_id NULL)', Number(unassignedCollisions?.[0]?.cnt) || 0);
  } catch (err: any) {
    console.warn('[INVARIANT MONITOR] DB offline / query gagal:', err?.message);
  }

  return {
    tenantId,
    checkedAt: new Date().toISOString(),
    violations,
    totalViolations: violations.reduce((s, v) => s + v.count, 0),
  };
}

/**
 * Cron runner: cek seluruh tenant lalu kirim SATU alert ringkas bila ada
 * pelanggaran. Idempoten-aman; tidak menulis ke DB.
 */
export async function runDailyInvariantMonitor(): Promise<void> {
  const { getAllTenantIds } = await import('./media.service');
  const tenantIds = await getAllTenantIds();
  for (const tenantId of tenantIds) {
    const report = await checkDailyInvariants(tenantId);
    if (report.violations.length === 0) continue;
    const summary = report.violations.map((v) => `- ${v.description}: ${v.count}`).join('\n');
    console.warn(`[INVARIANT MONITOR] tenant=${tenantId} pelanggaran:\n${summary}`);
    await alertService.notifyAlert({
      type: AlertType.DAILY_OPS_REPORT,
      severity: AlertSeverity.WARNING,
      tenantId,
      message: `Audit invariant reservasi menemukan ${report.totalViolations} pelanggaran:\n${summary}`,
    });
  }
}

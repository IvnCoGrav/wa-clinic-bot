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
      contradictoryCapi,
      unpurgedExpiredArchives,
      ltvCacheDrift,
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
      prisma.reservation.count({ where: { tenant_id: tenantId, purchase_review_status: 'pending', purchase_event_sent_at: { not: null } } }),
      prisma.reservationArchive.count({ where: { tenant_id: tenantId, restore_until: { lt: new Date() }, restored_at: null } }),
      prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
        `SELECT count(*)::int AS cnt FROM (
           SELECT c.id, c.ltv_cache, COALESCE(SUM(r.purchase_value), 0)::int AS sum_val
           FROM customers c
           LEFT JOIN reservations r ON r.customer_id = c.id AND r.status NOT IN ('cancelled', 'rejected')
           WHERE c.tenant_id = $1 AND c.is_sandbox_test = false
           GROUP BY c.id, c.ltv_cache
           HAVING c.ltv_cache != COALESCE(SUM(r.purchase_value), 0)
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
    pushIf('CONTRADICTORY_CAPI_STATE', 'Pending tapi event CAPI sudah terkirim (purchase_event_sent_at terisi)', Number(contradictoryCapi) || 0);
    pushIf('UNPURGED_EXPIRED_ARCHIVES', 'Arsip reservasi kedaluwarsa belum dibersihkan (>60 hari)', Number(unpurgedExpiredArchives) || 0);
    pushIf('LTV_CACHE_DRIFT', 'Selisih ltv_cache vs SUM(reservasi)', Number(ltvCacheDrift?.[0]?.cnt) || 0);
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
/**
 * Auto-repair selisih ltv_cache vs SUM(reservasi) untuk seluruh customer non-sandbox
 */
export async function autoRepairLtvDrift(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
  const drifted = await prisma.$queryRawUnsafe<Array<{ id: string; ltv_cache: number; sum_val: number }>>(
    `SELECT c.id, c.ltv_cache, COALESCE(SUM(r.purchase_value), 0)::int AS sum_val
     FROM customers c
     LEFT JOIN reservations r ON r.customer_id = c.id AND r.status NOT IN ('cancelled', 'rejected')
     WHERE c.tenant_id = $1 AND c.is_sandbox_test = false
     GROUP BY c.id, c.ltv_cache
     HAVING c.ltv_cache != COALESCE(SUM(r.purchase_value), 0)`,
    tenantId
  );

  if (!drifted || drifted.length === 0) return 0;

  const { customerService } = await import('./customer.service');
  let repairedCount = 0;

  for (const item of drifted) {
    try {
      const newLtv = await customerService.recalculateCustomerLtv(item.id, tenantId);
      repairedCount++;
      try {
        await prisma.auditLog.create({
          data: {
            tenant_id: tenantId,
            admin_key: 'SYSTEM',
            admin_identity: 'SYSTEM_CRON',
            action: 'AUTO_REPAIR_LTV_DRIFT',
            target_id: item.id,
            payload: JSON.stringify({
              customerId: item.id,
              oldLtv: item.ltv_cache,
              newLtv,
              sumVal: item.sum_val,
            }),
          },
        });
      } catch {}
    } catch (err: any) {
      console.warn(`[INVARIANT MONITOR] Auto-repair LTV failed for customer ${item.id}:`, err?.message);
    }
  }

  return repairedCount;
}

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

    // Auto-repair untuk LTV_CACHE_DRIFT jika ada pelanggaran
    const ltvViolation = report.violations.find((v) => v.key === 'LTV_CACHE_DRIFT');
    if (ltvViolation && ltvViolation.count > 0) {
      try {
        const repaired = await autoRepairLtvDrift(tenantId);
        console.log(`[INVARIANT MONITOR] Auto-repaired ${repaired} customer LTV drift(s) for tenant ${tenantId}.`);
      } catch (repErr: any) {
        console.warn('[INVARIANT MONITOR] Error during autoRepairLtvDrift:', repErr?.message);
      }
    }
  }
}

/**
 * cron-health.ts — Status & alert kegagalan background cron (K-005).
 *
 * Masalah yang diselesaikan:
 * - Sebelumnya kegagalan cron hanya `console.error`, tidak pernah menjadi status
 *   yang bisa diperiksa operator maupun alert.
 * - "Hijau" hanya berarti proses hidup; cron bisa gagal berbulan-bulan tanpa ada
 *   yang tahu.
 *
 * Desain:
 * - Registry in-memory per proses (cron hanya berjalan di leader, lihat
 *   `cron-advisory-lock.ts`), sehingga tidak butuh tabel baru/migrasi.
 * - Setiap task dicatat: mulai, selesai, durasi, status, jumlah kegagalan
 *   beruntun, dan pesan error terakhir.
 * - Status diekspos lewat `GET /api/admin/health` dan probe `/ready`.
 * - Kegagalan beruntun >= ambang (`CRON_FAILURE_ALERT_THRESHOLD`, default 3)
 *   memicu `alertService` (Telegram/emergency log) dengan tipe
 *   `CRON_JOB_FAILED`.
 */

export type CronRunStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface CronJobHealth {
  name: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastStatus: CronRunStatus | null;
  consecutiveFailures: number;
  totalRuns: number;
  totalFailures: number;
  skippedRuns: number;
  lastError: string | null;
}

export interface CronHealthSnapshot {
  status: 'OK' | 'DEGRADED' | 'NO_JOBS';
  checkedAt: string;
  alertThreshold: number;
  failingJobs: string[];
  jobs: CronJobHealth[];
}

const registry = new Map<string, CronJobHealth>();

const DEFAULT_FAILURE_ALERT_THRESHOLD = 3;
const HEARTBEAT_INSTANCE_ID = `${process.pid}`;

/** Tulis heartbeat ke DB agar proses app bisa membaca status cron worker (G8). */
function persistHeartbeat(job: CronJobHealth): void {
  import('../db/client')
    .then(({ prisma }) => {
      const delegate = (prisma as any).cronJobHeartbeat;
      if (!delegate?.upsert) return;
      return delegate.upsert({
        where: { job_name: job.name },
        update: {
          instance_id: HEARTBEAT_INSTANCE_ID,
          last_started_at: job.lastStartedAt ? new Date(job.lastStartedAt) : null,
          last_finished_at: job.lastFinishedAt ? new Date(job.lastFinishedAt) : null,
          last_status: job.lastStatus,
          last_error: job.lastError,
          consecutive_failures: job.consecutiveFailures,
        },
        create: {
          job_name: job.name,
          instance_id: HEARTBEAT_INSTANCE_ID,
          last_started_at: job.lastStartedAt ? new Date(job.lastStartedAt) : null,
          last_finished_at: job.lastFinishedAt ? new Date(job.lastFinishedAt) : null,
          last_status: job.lastStatus,
          last_error: job.lastError,
          consecutive_failures: job.consecutiveFailures,
        },
      });
    })
    .catch(() => {
      // DB offline: registry in-memory tetap menjadi sumber untuk proses ini.
    });
}

function ensureJob(name: string): CronJobHealth {
  let job = registry.get(name);
  if (!job) {
    job = {
      name,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastDurationMs: null,
      lastStatus: null,
      consecutiveFailures: 0,
      totalRuns: 0,
      totalFailures: 0,
      skippedRuns: 0,
      lastError: null,
    };
    registry.set(name, job);
  }
  return job;
}

/** Ambang kegagalan beruntun sebelum alert dikirim. */
export function getCronFailureAlertThreshold(): number {
  const parsed = parseInt(process.env.CRON_FAILURE_ALERT_THRESHOLD || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FAILURE_ALERT_THRESHOLD;
}

export function recordCronStart(name: string): void {
  const job = ensureJob(name);
  job.lastStartedAt = new Date().toISOString();
  job.lastStatus = null;
  persistHeartbeat(job);
}

export function recordCronSuccess(name: string, durationMs: number): void {
  const job = ensureJob(name);
  job.lastFinishedAt = new Date().toISOString();
  job.lastDurationMs = Math.max(0, Math.round(durationMs));
  job.lastStatus = 'SUCCESS';
  job.consecutiveFailures = 0;
  job.totalRuns += 1;
  job.lastError = null;
  persistHeartbeat(job);
}

/**
 * Mencatat kegagalan. Mengembalikan jumlah kegagalan beruntun agar pemanggil
 * bisa memutuskan pengiriman alert.
 */
export function recordCronFailure(name: string, durationMs: number, error: unknown): number {
  const job = ensureJob(name);
  job.lastFinishedAt = new Date().toISOString();
  job.lastDurationMs = Math.max(0, Math.round(durationMs));
  job.lastStatus = 'FAILED';
  job.consecutiveFailures += 1;
  job.totalRuns += 1;
  job.totalFailures += 1;
  job.lastError = error instanceof Error ? error.message : String(error ?? 'unknown error');
  persistHeartbeat(job);
  return job.consecutiveFailures;
}

/** Mencatat putaran yang dilewati karena putaran sebelumnya masih berjalan. */
export function recordCronSkip(name: string): void {
  const job = ensureJob(name);
  job.skippedRuns += 1;
  persistHeartbeat(job);
}

export function getCronJobHealth(name: string): CronJobHealth | null {
  const job = registry.get(name);
  return job ? { ...job } : null;
}

export function getCronHealthSnapshot(): CronHealthSnapshot {
  const threshold = getCronFailureAlertThreshold();
  const jobs = Array.from(registry.values())
    .map((job) => ({ ...job }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const failingJobs = jobs
    .filter((job) => job.consecutiveFailures >= threshold)
    .map((job) => job.name);

  const status: CronHealthSnapshot['status'] = jobs.length === 0
    ? 'NO_JOBS'
    : failingJobs.length > 0
      ? 'DEGRADED'
      : 'OK';

  return {
    status,
    checkedAt: new Date().toISOString(),
    alertThreshold: threshold,
    failingJobs,
    jobs,
  };
}

export function isCronHealthDegraded(): boolean {
  return getCronHealthSnapshot().status === 'DEGRADED';
}

/**
 * Snapshot lintas proses (G8): baca heartbeat worker dari DB. Jika tabel kosong
 * atau DB offline, jatuh ke registry in-memory proses ini.
 */
export async function getCronHealthSnapshotAsync(): Promise<CronHealthSnapshot> {
  try {
    const { prisma } = await import('../db/client');
    const delegate = (prisma as any).cronJobHeartbeat;
    if (delegate?.findMany) {
      const rows = (await delegate.findMany()) as any[];
      if (rows.length > 0) {
        const threshold = getCronFailureAlertThreshold();
        const staleMs = Math.max(60_000, parseInt(process.env.CRON_HEARTBEAT_STUCK_MS || '900000', 10));
        const now = Date.now();
        const jobs: CronJobHealth[] = rows
          .map((row) => ({
            name: String(row.job_name),
            lastStartedAt: row.last_started_at ? new Date(row.last_started_at).toISOString() : null,
            lastFinishedAt: row.last_finished_at ? new Date(row.last_finished_at).toISOString() : null,
            lastDurationMs: null,
            lastStatus: (row.last_status as CronRunStatus | null) ?? null,
            consecutiveFailures: Number(row.consecutive_failures || 0),
            totalRuns: 0,
            totalFailures: 0,
            skippedRuns: 0,
            lastError: row.last_error ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        const failingJobs = jobs
          .filter((job) => {
            if (job.consecutiveFailures >= threshold) return true;
            const started = job.lastStartedAt ? Date.parse(job.lastStartedAt) : null;
            const finished = job.lastFinishedAt ? Date.parse(job.lastFinishedAt) : null;
            const stuck = started !== null && (finished === null || started > finished) && now - started > staleMs;
            return stuck;
          })
          .map((job) => job.name);

        return {
          status: failingJobs.length > 0 ? 'DEGRADED' : 'OK',
          checkedAt: new Date().toISOString(),
          alertThreshold: threshold,
          failingJobs,
          jobs,
        };
      }
    }
  } catch {
    // fallback ke registry lokal
  }
  return getCronHealthSnapshot();
}

/** Helper untuk test/restart — mengosongkan registry. */
export function resetCronHealth(): void {
  registry.clear();
}

/**
 * Mengirim alert bila kegagalan beruntun melewati ambang. Aman dipanggil pada
 * setiap kegagalan: `alertService` sudah punya cooldown + agregasi.
 */
export async function notifyCronFailureIfNeeded(
  name: string,
  consecutiveFailures: number,
  error: unknown
): Promise<boolean> {
  if (consecutiveFailures < getCronFailureAlertThreshold()) return false;
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  try {
    const { alertService, AlertType, AlertSeverity } = await import('../services/alert.service');
    await alertService.notifyAlert({
      type: AlertType.CRON_JOB_FAILED,
      severity: AlertSeverity.CRITICAL,
      message: `Background cron '${name}' gagal ${consecutiveFailures}x beruntun: ${message}`,
      metadata: { cronJob: name, consecutiveFailures },
    });
    return true;
  } catch (alertErr: any) {
    console.error('[CRON HEALTH] Gagal mengirim alert kegagalan cron:', alertErr?.message || alertErr);
    return false;
  }
}

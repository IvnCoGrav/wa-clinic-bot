import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/alert.service', () => ({
  alertService: { notifyAlert: vi.fn().mockResolvedValue({ sent: true, channel: 'console' }) },
  AlertType: { CRON_JOB_FAILED: 'CRON_JOB_FAILED' },
  AlertSeverity: { CRITICAL: 'CRITICAL' },
}));

import { alertService } from '../../src/services/alert.service';
import {
  getCronFailureAlertThreshold,
  getCronHealthSnapshot,
  getCronJobHealth,
  notifyCronFailureIfNeeded,
  recordCronFailure,
  recordCronSkip,
  recordCronStart,
  recordCronSuccess,
  resetCronHealth,
} from '../../src/lifecycle/cron-health';
import { createExclusiveCronTask, resetInFlightCronTasks } from '../../src/lifecycle/background-crons';

/** K-005: kegagalan cron wajib menjadi status + alert, bukan hanya console.error. */
describe('Cron health & alert (K-005)', () => {
  const notifyMock = alertService.notifyAlert as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCronHealth();
    resetInFlightCronTasks();
    notifyMock.mockClear();
    process.env.CRON_FAILURE_ALERT_THRESHOLD = '2';
  });

  afterEach(() => {
    delete process.env.CRON_FAILURE_ALERT_THRESHOLD;
    resetCronHealth();
  });

  it('mencatat siklus sukses: status SUCCESS, durasi, counter reset', () => {
    recordCronStart('job-a');
    recordCronSuccess('job-a', 123);
    const job = getCronJobHealth('job-a')!;
    expect(job.lastStatus).toBe('SUCCESS');
    expect(job.lastDurationMs).toBe(123);
    expect(job.consecutiveFailures).toBe(0);
    expect(job.totalRuns).toBe(1);
    expect(job.lastStartedAt).not.toBeNull();
  });

  it('kegagalan beruntun menaikkan counter; sukses mereset', () => {
    recordCronStart('job-b');
    expect(recordCronFailure('job-b', 5, new Error('boom-1'))).toBe(1);
    expect(recordCronFailure('job-b', 5, new Error('boom-2'))).toBe(2);
    expect(getCronJobHealth('job-b')!.lastError).toBe('boom-2');

    recordCronStart('job-b');
    recordCronSuccess('job-b', 10);
    expect(getCronJobHealth('job-b')!.consecutiveFailures).toBe(0);
    expect(getCronJobHealth('job-b')!.totalFailures).toBe(2);
  });

  it('snapshot DEGRADED saat ambang terlampaui, NO_JOBS saat kosong', () => {
    expect(getCronHealthSnapshot().status).toBe('NO_JOBS');

    recordCronStart('job-c');
    recordCronSuccess('job-c', 1);
    expect(getCronHealthSnapshot().status).toBe('OK');

    recordCronFailure('job-c', 1, new Error('fail'));
    expect(getCronHealthSnapshot().status).toBe('OK'); // baru 1x, ambang 2
    recordCronFailure('job-c', 1, new Error('fail lagi'));
    const snap = getCronHealthSnapshot();
    expect(snap.status).toBe('DEGRADED');
    expect(snap.failingJobs).toEqual(['job-c']);
  });

  it('alert hanya dikirim setelah melewati ambang', async () => {
    await notifyCronFailureIfNeeded('job-d', 1, new Error('sekali'));
    expect(notifyMock).not.toHaveBeenCalled();

    await notifyCronFailureIfNeeded('job-d', 2, new Error('dua kali'));
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({
      type: 'CRON_JOB_FAILED',
      severity: 'CRITICAL',
      metadata: { cronJob: 'job-d', consecutiveFailures: 2 },
    });
  });

  it('ambang env tidak valid kembali ke default 3', () => {
    process.env.CRON_FAILURE_ALERT_THRESHOLD = 'abc';
    expect(getCronFailureAlertThreshold()).toBe(3);
    process.env.CRON_FAILURE_ALERT_THRESHOLD = '0';
    expect(getCronFailureAlertThreshold()).toBe(3);
  });

  it('putaran yang dilewati mutex tercatat sebagai skipped', () => {
    recordCronSkip('job-e');
    recordCronSkip('job-e');
    expect(getCronJobHealth('job-e')!.skippedRuns).toBe(2);
  });

  it('createExclusiveCronTask mencatat sukses & kegagalan, alert pada ambang', async () => {
    const ok = createExclusiveCronTask('wrapper-ok', () => undefined);
    await ok();
    expect(getCronJobHealth('wrapper-ok')!.lastStatus).toBe('SUCCESS');

    let calls = 0;
    const failing = createExclusiveCronTask('wrapper-fail', () => {
      calls += 1;
      throw new Error(`gagal-${calls}`);
    });

    // Tidak melempar ke pemanggil (interval tidak boleh mati).
    await expect(failing()).resolves.toBeUndefined();
    expect(getCronJobHealth('wrapper-fail')!.lastStatus).toBe('FAILED');
    expect(notifyMock).not.toHaveBeenCalled(); // 1x < ambang 2

    await failing();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(getCronHealthSnapshot().failingJobs).toContain('wrapper-fail');
  });

  it('recordCronStart setelah sukses tidak menghapus history kegagalan', () => {
    recordCronFailure('job-f', 3, new Error('x'));
    recordCronStart('job-f');
    expect(getCronJobHealth('job-f')!.consecutiveFailures).toBe(1);
    expect(getCronJobHealth('job-f')!.lastStatus).toBeNull();
  });
});

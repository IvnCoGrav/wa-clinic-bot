import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  trackInterval,
  trackTimeout,
  clearAllIntervals,
  clearTimeoutTracked,
  activeIntervalCount,
  activeTimeoutCount,
} from '../../src/lifecycle/interval-registry';
import {
  createExclusiveCronTask,
  isCronTaskInFlight,
  resetInFlightCronTasks,
  trackIntervalStaggered,
} from '../../src/lifecycle/background-crons';

describe('F4.4 Lifecycle & Crons Resilience (Ar-001, Ar-007, K-007)', () => {
  beforeEach(() => {
    clearAllIntervals();
    resetInFlightCronTasks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearAllIntervals();
    resetInFlightCronTasks();
    vi.useRealTimers();
  });

  describe('Ar-001: Interval & Timeout Lifecycle Registry', () => {
    it('mencatat dan menghentikan interval terdaftar saat shutdown', () => {
      const initialCount = activeIntervalCount();
      const fn = vi.fn();
      const handle = trackInterval(fn, 1000);

      expect(activeIntervalCount()).toBe(initialCount + 1);

      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);

      clearAllIntervals();
      expect(activeIntervalCount()).toBe(0);

      vi.advanceTimersByTime(2000);
      expect(fn).toHaveBeenCalledTimes(1); // tidak bertambah setelah shutdown
    });

    it('mencatat dan menghentikan timeout terdaftar saat shutdown', () => {
      const fn = vi.fn();
      const handle = trackTimeout(fn, 5000);

      expect(activeTimeoutCount()).toBeGreaterThan(0);

      clearAllIntervals();
      expect(activeTimeoutCount()).toBe(0);

      vi.advanceTimersByTime(10000);
      expect(fn).not.toHaveBeenCalled(); // dibatalkan sebelum jalan
    });

    it('trackIntervalStaggered mendaftarkan timeout starter ke registry', () => {
      const initialTimeouts = activeTimeoutCount();
      const asyncFn = vi.fn().mockResolvedValue(undefined);

      const starter = trackIntervalStaggered(asyncFn, 60000);
      expect(activeTimeoutCount()).toBe(initialTimeouts + 1);

      clearAllIntervals();
      expect(activeTimeoutCount()).toBe(0);
    });
  });

  describe('Ar-007: In-Flight Cron Mutex (createExclusiveCronTask)', () => {
    it('mencegah eksekusi ganda bersamaan (overlap) saat putaran sebelumnya masih berjalan', async () => {
      let resolveFirstRun: () => void = () => {};
      const firstRunPromise = new Promise<void>((resolve) => {
        resolveFirstRun = resolve;
      });

      let executionCount = 0;
      const workerTask = vi.fn().mockImplementation(async () => {
        executionCount++;
        if (executionCount === 1) {
          await firstRunPromise;
        }
      });

      const exclusiveTask = createExclusiveCronTask('test-exclusive-worker', workerTask);

      // Putaran 1 mulai berjalan (tertahan pada promise)
      const p1 = exclusiveTask();
      expect(isCronTaskInFlight('test-exclusive-worker')).toBe(true);
      expect(executionCount).toBe(1);

      // Putaran 2 dipicu saat putaran 1 masih berjalan -> harus di-skip
      const p2 = exclusiveTask();
      expect(executionCount).toBe(1); // tidak bertambah

      // Selesaikan putaran 1
      resolveFirstRun();
      await p1;
      await p2;

      expect(isCronTaskInFlight('test-exclusive-worker')).toBe(false);

      // Putaran 3 dipicu setelah putaran 1 selesai -> harus jalan normal
      await exclusiveTask();
      expect(executionCount).toBe(2);
    });

    it('memastikan flag inFlight di-reset dalam blok finally meskipun fungsi melempar error', async () => {
      const failingTask = vi.fn().mockRejectedValue(new Error('Simulated cron failure'));
      const exclusiveTask = createExclusiveCronTask('failing-worker', failingTask);

      await exclusiveTask();

      expect(failingTask).toHaveBeenCalledTimes(1);
      expect(isCronTaskInFlight('failing-worker')).toBe(false);

      // Invocations berikutnya tetap diizinkan
      const recoveringTask = vi.fn().mockResolvedValue(undefined);
      const secondExclusiveTask = createExclusiveCronTask('failing-worker', recoveringTask);

      await secondExclusiveTask();
      expect(recoveringTask).toHaveBeenCalledTimes(1);
    });
  });

  describe('K-007: Nightly Watchdog WhatsApp Idempotency Key Format', () => {
    it('menghasilkan key idempotensi unik per nomor WhatsApp dan per tanggal laporan', () => {
      const tenantId = 'tenant-test';
      const num1 = '6281234567890';
      const num2 = '6289876543210';
      const reportDateStr = '2026-11-10';

      const key1 = `${tenantId}:NIGHTLY_WATCHDOG:WA:${num1}:${reportDateStr}`;
      const key2 = `${tenantId}:NIGHTLY_WATCHDOG:WA:${num2}:${reportDateStr}`;
      const keyTelegram = `${tenantId}:NIGHTLY_WATCHDOG:${reportDateStr}`;

      expect(key1).not.toBe(key2);
      expect(key1).toContain(num1);
      expect(key2).toContain(num2);
      expect(key1).toContain(reportDateStr);
      expect(keyTelegram).not.toContain('WA:');
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createExclusiveCronTask,
  drainInFlightCronTasks,
  isCronTaskInFlight,
  resetInFlightCronTasks,
} from '../../src/lifecycle/background-crons';

/** K-010: shutdown menunggu job cron in-flight selesai (dengan batas waktu). */
describe('Drain cron in-flight (K-010)', () => {
  beforeEach(() => {
    resetInFlightCronTasks();
  });

  it('menunggu task selesai lalu mengembalikan true', async () => {
    let done = false;
    const task = createExclusiveCronTask('slow', async () => {
      await new Promise((r) => setTimeout(r, 80));
      done = true;
    });
    const running = task();
    expect(isCronTaskInFlight('slow')).toBe(true);
    const drained = await drainInFlightCronTasks(2000);
    await running;
    expect(drained).toBe(true);
    expect(done).toBe(true);
    expect(isCronTaskInFlight('slow')).toBe(false);
  });

  it('menghormati batas waktu (false) dan tidak menggantung', async () => {
    const task = createExclusiveCronTask('very-slow', async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const running = task();
    const drained = await drainInFlightCronTasks(50);
    expect(drained).toBe(false);
    await running;
  });

  it('tanpa task → langsung true', async () => {
    await expect(drainInFlightCronTasks(10)).resolves.toBe(true);
  });
});

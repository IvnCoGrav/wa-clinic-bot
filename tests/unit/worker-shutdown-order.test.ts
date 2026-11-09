import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shutdownWorker, __resetWorkerShuttingDownForTest } from '../../src/worker';
import * as intervalRegistry from '../../src/lifecycle/interval-registry';
import { burstCoalesceService } from '../../src/services/burst-coalesce.service';
import { queueService } from '../../src/services/queue.service';
import { cronAdvisoryLock } from '../../src/lifecycle/cron-advisory-lock';
import { prisma } from '../../src/db/client';

describe('Task S2.5 — Worker Graceful Shutdown Order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkerShuttingDownForTest();
  });

  it('mengeksekusi shutdown dengan urutan: intervals -> burst flush -> queue close -> cron lock -> prisma disconnect', async () => {
    const executionOrder: string[] = [];

    vi.spyOn(intervalRegistry, 'clearAllIntervals').mockImplementation(() => {
      executionOrder.push('clearAllIntervals');
    });

    vi.spyOn(burstCoalesceService, 'flushAll').mockImplementation(async () => {
      executionOrder.push('burstCoalesceService.flushAll');
    });

    vi.spyOn(queueService, 'close').mockImplementation(async () => {
      executionOrder.push('queueService.close');
    });

    vi.spyOn(cronAdvisoryLock, 'releaseLock').mockImplementation(async () => {
      executionOrder.push('cronAdvisoryLock.releaseLock');
    });

    vi.spyOn(prisma, '$disconnect').mockImplementation(async () => {
      executionOrder.push('prisma.$disconnect');
    });

    await shutdownWorker('SIGTERM', false);

    expect(executionOrder).toEqual([
      'clearAllIntervals',
      'burstCoalesceService.flushAll',
      'queueService.close',
      'cronAdvisoryLock.releaseLock',
      'prisma.$disconnect',
    ]);

    // Verifikasi kritis: burstCoalesce WAJIB di-flush sebelum queue ditutup
    const burstIndex = executionOrder.indexOf('burstCoalesceService.flushAll');
    const queueIndex = executionOrder.indexOf('queueService.close');
    expect(burstIndex).toBeLessThan(queueIndex);
  });
});

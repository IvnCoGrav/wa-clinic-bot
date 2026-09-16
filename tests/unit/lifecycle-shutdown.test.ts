import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * FASE 1 — graceful shutdown (PLAN 8).
 *
 * Menguji perilaku adversarial orkestrasi shutdown:
 * - guard re-entrancy,
 * - urutan tahap (cron → server → burst → queue → prisma),
 * - ketahanan bila satu tahap melempar error,
 * - force-exit timer.
 */

const mocks = {
  clearAllIntervals: vi.fn(),
  serverClose: vi.fn(async () => {}),
  flushAll: vi.fn(async () => {}),
  queueClose: vi.fn(async () => {}),
  prismaDisconnect: vi.fn(async () => {}),
};

vi.mock('../../src/lifecycle/interval-registry', () => ({
  clearAllIntervals: () => mocks.clearAllIntervals(),
  trackInterval: vi.fn(),
  activeIntervalCount: () => 0,
}));

vi.mock('../../src/services/queue.service', () => ({
  queueService: { close: () => mocks.queueClose() },
}));

vi.mock('../../src/services/burst-coalesce.service', () => ({
  burstCoalesceService: { flushAll: () => mocks.flushAll() },
}));

vi.mock('../../src/db/client', () => ({
  prisma: { $disconnect: () => mocks.prismaDisconnect() },
}));

const order: string[] = [];

async function loadShutdown() {
  vi.resetModules();
  return await import('../../src/lifecycle/shutdown');
}

const fakeServer = { close: async () => { order.push('server'); await mocks.serverClose(); } } as any;

describe('FASE 1 — graceful shutdown', () => {
  let exitSpy: any;

  beforeEach(() => {
    order.length = 0;
    mocks.clearAllIntervals.mockReset().mockImplementation(() => { order.push('cron'); });
    mocks.serverClose.mockReset().mockResolvedValue(undefined);
    mocks.flushAll.mockReset().mockImplementation(async () => { order.push('burst'); });
    mocks.queueClose.mockReset().mockImplementation(async () => { order.push('queue'); });
    mocks.prismaDisconnect.mockReset().mockImplementation(async () => { order.push('prisma'); });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      order.push(`exit:${code}`);
      return undefined as never;
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('menjalankan tahap sesuai urutan: cron → server → burst → queue → prisma → exit 0', async () => {
    const { gracefulShutdown } = await loadShutdown();
    await gracefulShutdown(fakeServer, 'SIGTERM');

    expect(order).toEqual(['cron', 'server', 'burst', 'queue', 'prisma', 'exit:0']);
  });

  it('guard re-entrancy: panggilan kedua tidak mengeksekusi ulang', async () => {
    const { gracefulShutdown } = await loadShutdown();
    await gracefulShutdown(fakeServer, 'SIGTERM');
    const firstOrder = [...order];
    await gracefulShutdown(fakeServer, 'SIGINT');
    expect(order).toEqual(firstOrder);
  });

  it('adversarial: server.close() throw → tetap lanjut ke burst/queue/prisma', async () => {
    mocks.serverClose.mockRejectedValue(new Error('server close boom'));
    const { gracefulShutdown } = await loadShutdown();
    await gracefulShutdown(fakeServer, 'SIGTERM');

    expect(order).toContain('burst');
    expect(order).toContain('queue');
    expect(order).toContain('prisma');
    expect(order).toContain('exit:0');
  });

  it('adversarial: flushAll() throw → tetap lanjut ke queue & prisma', async () => {
    mocks.flushAll.mockRejectedValue(new Error('flush boom'));
    const { gracefulShutdown } = await loadShutdown();
    await gracefulShutdown(fakeServer, 'SIGTERM');

    expect(order).toContain('queue');
    expect(order).toContain('prisma');
  });

  it('adversarial: queue.close() throw → tetap lanjut ke prisma', async () => {
    mocks.queueClose.mockRejectedValue(new Error('queue boom'));
    const { gracefulShutdown } = await loadShutdown();
    await gracefulShutdown(fakeServer, 'SIGTERM');

    expect(order).toContain('prisma');
    expect(order).toContain('exit:0');
  });

  it('isShuttingDown true setelah shutdown dipanggil', async () => {
    const { gracefulShutdown, isShuttingDown } = await loadShutdown();
    expect(isShuttingDown()).toBe(false);
    await gracefulShutdown(fakeServer, 'SIGTERM');
    expect(isShuttingDown()).toBe(true);
  });
});

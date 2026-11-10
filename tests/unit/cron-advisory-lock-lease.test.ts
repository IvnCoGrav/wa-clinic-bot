import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CronAdvisoryLock } from '../../src/lifecycle/cron-advisory-lock';
import { prisma } from '../../src/db/client';

/**
 * K-001/K-002: cron runner WAJIB punya lock/lease tunggal lintas proses.
 * Tanpa lease, dua container/worker menjalankan cron yang sama (dobel kirim,
 * dobel backup) dan worker mati tidak pernah terdeteksi.
 *
 * Uji ini mengunci kontrak DB lease:
 *  - hanya satu pemegang lease (claim `ON CONFLICT ... WHERE expires_at < now`),
 *  - fail-closed saat DB bermasalah di produksi (bukan fail-open),
 *  - release mengosongkan status leader.
 */
describe('CronAdvisoryLock — lease tunggal & fail-closed (K-001/K-002)', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = 'production';
    (prisma as any).$executeRaw = vi.fn().mockRejectedValue(new Error('Database offline'));
    (prisma as any).$queryRaw = vi.fn().mockRejectedValue(new Error('Database offline'));
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
  });

  it('produksi + DB gagal total → TIDAK menjadi leader (fail-closed)', async () => {
    const lock = new CronAdvisoryLock();
    await expect(lock.tryAcquireLock()).resolves.toBe(false);
    expect(lock.isLeader()).toBe(false);
  });

  it('claim lease berhasil (1 baris) → leader; instance lain yang claim 0 baris → standby', async () => {
    const leader = new CronAdvisoryLock();
    const standby = new CronAdvisoryLock();

    (prisma as any).$executeRaw = vi.fn().mockResolvedValueOnce(1);
    await expect(leader.tryAcquireLock()).resolves.toBe(true);
    expect(leader.isLeader()).toBe(true);

    (prisma as any).$executeRaw = vi.fn().mockResolvedValueOnce(0);
    await expect(standby.tryAcquireLock()).resolves.toBe(false);
    expect(standby.isLeader()).toBe(false);

    await leader.releaseLock();
    expect(leader.isLeader()).toBe(false);
  });

  it('releaseLock tanpa lease tidak melempar (shutdown aman)', async () => {
    const lock = new CronAdvisoryLock();
    await expect(lock.releaseLock()).resolves.toBeUndefined();
    expect(lock.isLeader()).toBe(false);
  });

  it('non-produksi (dev/test offline) tetap fail-open agar developer bisa jalan', async () => {
    process.env.NODE_ENV = 'test';
    const lock = new CronAdvisoryLock();
    await expect(lock.tryAcquireLock()).resolves.toBe(true);
    expect(lock.isLeader()).toBe(true);
    await lock.releaseLock();
  });
});

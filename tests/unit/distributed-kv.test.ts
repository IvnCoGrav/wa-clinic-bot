import { describe, it, expect } from 'vitest';
import {
  DistributedKv,
  MemoryKvBackend,
  type KvBackend,
} from '../../src/utils/distributed-kv';

/** W-006/UTL-15/CFG-17: KV bersama wajib punya TTL, lock, dan fallback jujur. */
describe('MemoryKvBackend', () => {
  it('menghormati TTL berdasarkan jam yang diinjeksi', async () => {
    let now = 1_000;
    const kv = new MemoryKvBackend(() => now);
    await kv.set('k', 'v', 100);
    expect(await kv.get('k')).toBe('v');

    now += 99;
    expect(await kv.get('k')).toBe('v');

    now += 2;
    expect(await kv.get('k')).toBeNull();
  });

  it('setNx hanya berhasil sekali sampai TTL habis', async () => {
    let now = 0;
    const kv = new MemoryKvBackend(() => now);
    expect(await kv.setNx('lock', 'a', 50)).toBe(true);
    expect(await kv.setNx('lock', 'b', 50)).toBe(false);
    expect(await kv.get('lock')).toBe('a');

    now += 60;
    expect(await kv.setNx('lock', 'c', 50)).toBe(true);
  });

  it('operasi set (burst) mendukung sadd/smembers/rename/mget', async () => {
    const kv = new MemoryKvBackend();
    await kv.sadd('msgs', 'm1', 10_000);
    await kv.sadd('msgs', 'm1', 10_000);
    await kv.sadd('msgs', 'm2', 10_000);
    expect((await kv.smembers('msgs')).sort()).toEqual(['m1', 'm2']);

    await kv.set('payload:m1', '{"seq":1}', 10_000);
    await kv.set('payload:m2', '{"seq":2}', 10_000);
    expect(await kv.mget(['payload:m1', 'payload:m2'])).toEqual(['{"seq":1}', '{"seq":2}']);

    expect(await kv.rename('msgs', 'claimed')).toBe(true);
    expect(await kv.smembers('msgs')).toEqual([]);
    expect((await kv.smembers('claimed')).sort()).toEqual(['m1', 'm2']);
    expect(await kv.rename('tidak-ada', 'x')).toBe(false);
  });

  it('incr menyimpan TTL hanya pada hitungan pertama', async () => {
    let now = 0;
    const kv = new MemoryKvBackend(() => now);
    expect(await kv.incr('counter', 100)).toBe(1);
    now += 50;
    expect(await kv.incr('counter', 100)).toBe(2);
    now += 60; // total 110 > 100 → kedaluwarsa
    expect(await kv.incr('counter', 100)).toBe(1);
  });
});

describe('DistributedKv', () => {
  it('jatuh ke memori saat Redis tidak dapat dibuat (tanpa melempar)', async () => {
    const kv = new DistributedKv({
      redisFactory: () => {
        throw new Error('redis mati');
      },
    });
    await expect(kv.set('k', 'v', 1000)).resolves.toBeUndefined();
    expect(await kv.get('k')).toBe('v');
    expect(kv.isShared()).toBe(false);
  });

  it('fallback ke memori saat operasi Redis gagal di tengah jalan', async () => {
    const fakeRedis = {
      status: 'ready',
      connect: async () => undefined,
      get: async () => {
        throw new Error('connection reset');
      },
      set: async () => {
        throw new Error('connection reset');
      },
      del: async () => 0,
      sadd: async () => 0,
      smembers: async () => [],
      srem: async () => 0,
      rename: async () => 'OK',
      mget: async () => [],
      incr: async () => 1,
      pexpire: async () => 1,
      exists: async () => 0,
      quit: async () => 'OK',
      disconnect: () => undefined,
      on: () => undefined,
    };
    const kv = new DistributedKv({ redisFactory: () => fakeRedis as any });
    await kv.set('k', 'v', 1000);
    expect(await kv.get('k')).toBe('v');
    expect(kv.isShared()).toBe(false);
  });

  it('withLock menjalankan fn tepat satu kali untuk pemanggil bersamaan', async () => {
    const kv = new DistributedKv({ forceMemory: true });
    let executions = 0;
    const task = () =>
      kv.withLock('lock:a', 5000, async () => {
        executions += 1;
        await new Promise((r) => setTimeout(r, 30));
        return 'selesai';
      });

    const results = await Promise.all([task(), task(), task()]);
    expect(executions).toBe(1);
    expect(results.filter((r) => r === 'selesai')).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(2);
  });

  it('withLock melepas lock setelah fn selesai', async () => {
    const kv = new DistributedKv({ forceMemory: true });
    await kv.withLock('lock:b', 5000, async () => 'x');
    expect(await kv.exists('lock:b')).toBe(false);
    expect(await kv.withLock('lock:b', 5000, async () => 'y')).toBe('y');
  });

  it('withLock fail-open saat waitMs habis (konfigurasi tidak boleh hilang)', async () => {
    const kv = new DistributedKv({ forceMemory: true });
    const holder = kv.withLock('lock:c', 5000, async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const result = await kv.withLock('lock:c', 5000, async () => 'fallback', { waitMs: 30 });
    expect(result).toBe('fallback');
    await holder;
  });

  it('mode() melaporkan memory saat dipaksa', () => {
    const kv = new DistributedKv({ forceMemory: true });
    expect(kv.mode()).toBe('memory');
    expect(kv.isShared()).toBe(false);
  });

  it('backend injeksi dipakai apa adanya oleh withLock (kontrak lock)', async () => {
    const backend: KvBackend = new MemoryKvBackend();
    expect(backend.mode).toBe('memory');
  });
});

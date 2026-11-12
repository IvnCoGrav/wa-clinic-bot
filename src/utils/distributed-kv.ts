/**
 * distributed-kv.ts — KV kecil dengan TTL + lock lintas proses.
 *
 * Latar (W-006, UTL-15, CFG-17): beberapa koordinasi masih `Map` per proses
 * (idempotensi balasan, buffer burst, antrean simpan konfigurasi). Saat app dan
 * worker berjalan di dua proses/container, koordinasi itu hilang → balasan bisa
 * dobel dan konfigurasi bisa saling menimpa.
 *
 * Desain:
 * - Backend Redis memakai `ioredis` yang SUDAH menjadi dependency (tanpa paket baru).
 * - Fallback memori otomatis: bila Redis mati, operasi tetap jalan dalam proses
 *   (degradasi jujur, bukan crash). `isShared()` memberi tahu pemanggil bahwa
 *   koordinasi lintas proses sedang tidak tersedia.
 * - Default memori saat `NODE_ENV=test` / `DISABLE_REDIS=true` agar test
 *   deterministik dan tidak menyentuh Redis nyata.
 * - Lock memakai `SET NX PX` + token pemilik; pelepasan hanya oleh pemilik.
 */

import Redis from 'ioredis';

export type KvMode = 'redis' | 'memory';

export interface KvBackend {
  readonly mode: KvMode;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  sadd(key: string, member: string, ttlMs: number): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, member: string): Promise<number>;
  rename(from: string, to: string): Promise<boolean>;
  mget(keys: string[]): Promise<Array<string | null>>;
  incr(key: string, ttlMs: number): Promise<number>;
  exists(key: string): Promise<boolean>;
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/** Backend memori: dipakai untuk test, fallback Redis, dan mode single-process. */
export class MemoryKvBackend implements KvBackend {
  readonly mode: KvMode = 'memory';
  private values = new Map<string, MemoryEntry>();
  private sets = new Map<string, Map<string, number>>();

  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.values) {
      if (entry.expiresAt <= now) this.values.delete(key);
    }
    for (const [key, members] of this.sets) {
      for (const [member, expiresAt] of members) {
        if (expiresAt <= now) members.delete(member);
      }
      if (members.size === 0) this.sets.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.prune();
    const entry = this.values.get(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.values.set(key, { value, expiresAt: this.now() + Math.max(1, ttlMs) });
  }

  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    this.prune();
    if (this.values.has(key)) return false;
    this.values.set(key, { value, expiresAt: this.now() + Math.max(1, ttlMs) });
    return true;
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.values.delete(key);
      this.sets.delete(key);
    }
  }

  async sadd(key: string, member: string, ttlMs: number): Promise<number> {
    this.prune();
    let members = this.sets.get(key);
    if (!members) {
      members = new Map();
      this.sets.set(key, members);
    }
    const isNew = !members.has(member);
    members.set(member, this.now() + Math.max(1, ttlMs));
    return isNew ? 1 : 0;
  }

  async smembers(key: string): Promise<string[]> {
    this.prune();
    return Array.from(this.sets.get(key)?.keys() ?? []);
  }

  async srem(key: string, member: string): Promise<number> {
    const members = this.sets.get(key);
    if (!members) return 0;
    const removed = members.delete(member) ? 1 : 0;
    if (members.size === 0) this.sets.delete(key);
    return removed;
  }

  async rename(from: string, to: string): Promise<boolean> {
    this.prune();
    const entry = this.values.get(from);
    const members = this.sets.get(from);
    if (!entry && !members) return false;
    if (entry) this.values.set(to, entry);
    if (members) this.sets.set(to, members);
    this.values.delete(from);
    this.sets.delete(from);
    return true;
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    this.prune();
    return keys.map((key) => this.values.get(key)?.value ?? null);
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    this.prune();
    const current = Number(this.values.get(key)?.value ?? '0');
    const next = Number.isFinite(current) ? current + 1 : 1;
    const existing = this.values.get(key);
    this.values.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt ?? this.now() + Math.max(1, ttlMs),
    });
    return next;
  }

  async exists(key: string): Promise<boolean> {
    this.prune();
    return this.values.has(key) || this.sets.has(key);
  }

  /** Hanya untuk test: kosongkan seluruh isi. */
  clear(): void {
    this.values.clear();
    this.sets.clear();
  }
}

/** Error penanda Redis tidak dapat dipakai pada operasi ini. */
export class KvUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KvUnavailableError';
  }
}

type RedisLike = {
  status: string;
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, member: string): Promise<number>;
  rename(from: string, to: string): Promise<string>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  quit(): Promise<string>;
  disconnect(): void;
  on(event: string, handler: (...args: any[]) => void): unknown;
};

export interface DistributedKvOptions {
  /** Paksa backend memori (test/rollback). */
  forceMemory?: boolean;
  /** URL Redis; default REDIS_URL lalu localhost. */
  url?: string;
  /** Interval percobaan ulang Redis setelah gagal (ms). */
  retryAfterMs?: number;
  /** Factory injeksi untuk test. */
  redisFactory?: (url: string) => RedisLike;
}

function shouldUseMemoryByDefault(): boolean {
  if (process.env.DISTRIBUTED_KV_DISABLED === 'true') return true;
  if (process.env.DISABLE_REDIS === 'true') return true;
  if (process.env.NODE_ENV === 'test') return true;
  return false;
}

/**
 * Facade KV: Redis bila tersedia, fallback memori transparan.
 * `isShared()` = true hanya ketika backend bersama (Redis) sedang sehat.
 */
export class DistributedKv {
  private readonly memory = new MemoryKvBackend();
  private redis: RedisLike | null = null;
  private redisHealthy = false;
  private nextRedisAttemptAt = 0;
  private readonly retryAfterMs: number;

  constructor(private readonly options: DistributedKvOptions = {}) {
    this.retryAfterMs = options.retryAfterMs ?? 30_000;
    if (this.options.forceMemory || shouldUseMemoryByDefault()) {
      this.redisHealthy = false;
      return;
    }
    this.ensureRedis();
  }

  isShared(): boolean {
    return this.redisHealthy && this.redis !== null;
  }

  /**
   * Apakah Redis boleh dicoba pada operasi ini. Berbeda dari isShared():
   * percobaan pertama tetap dilakukan walau status sehat belum diketahui
   * (lazy connect), sehingga backend bersama benar-benar terpakai.
   */
  private canTryRedis(): boolean {
    return this.redis !== null && Date.now() >= this.nextRedisAttemptAt;
  }

  mode(): KvMode {
    return this.isShared() ? 'redis' : 'memory';
  }

  private ensureRedis(): void {
    if (this.redis) return;
    const url = this.options.url || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    try {
      this.redis = this.options.redisFactory
        ? this.options.redisFactory(url)
        : (new Redis(url, {
            lazyConnect: true,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 1000)),
          }) as unknown as RedisLike);
      this.redis.on('error', () => {
        this.redisHealthy = false;
      });
    } catch {
      this.redisHealthy = false;
      this.nextRedisAttemptAt = Date.now() + this.retryAfterMs;
    }
  }

  private async withRedis<T>(fn: (redis: RedisLike) => Promise<T>): Promise<T> {
    if (!this.redis) this.ensureRedis();
    if (!this.redis) throw new KvUnavailableError('Redis tidak tersedia');
    if (Date.now() < this.nextRedisAttemptAt) {
      throw new KvUnavailableError('Redis sedang cooldown setelah gagal');
    }
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') {
        await this.redis.connect();
      }
      const result = await fn(this.redis);
      this.redisHealthy = true;
      return result;
    } catch (err: any) {
      this.redisHealthy = false;
      this.nextRedisAttemptAt = Date.now() + this.retryAfterMs;
      throw new KvUnavailableError(err?.message || 'Operasi Redis gagal');
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.canTryRedis()) {
      try {
        return await this.withRedis((r) => r.get(key));
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.get(key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    if (this.canTryRedis()) {
      try {
        await this.withRedis((r) => r.set(key, value, 'PX', Math.max(1, ttlMs)));
        return;
      } catch {
        /* fallback memori */
      }
    }
    await this.memory.set(key, value, ttlMs);
  }

  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.canTryRedis()) {
      try {
        const res = await this.withRedis((r) => r.set(key, value, 'PX', Math.max(1, ttlMs), 'NX'));
        return res === 'OK';
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.setNx(key, value, ttlMs);
  }

  async del(...keys: string[]): Promise<void> {
    if (this.canTryRedis()) {
      try {
        await this.withRedis((r) => r.del(...keys));
        return;
      } catch {
        /* fallback memori */
      }
    }
    await this.memory.del(...keys);
  }

  async sadd(key: string, member: string, ttlMs: number): Promise<number> {
    if (this.canTryRedis()) {
      try {
        const added = await this.withRedis(async (r) => {
          const res = await r.sadd(key, member);
          if (res === 1) await r.pexpire(key, Math.max(1, ttlMs));
          return res;
        });
        return added;
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.sadd(key, member, ttlMs);
  }

  async smembers(key: string): Promise<string[]> {
    if (this.canTryRedis()) {
      try {
        return await this.withRedis((r) => r.smembers(key));
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.smembers(key);
  }

  async srem(key: string, member: string): Promise<number> {
    if (this.canTryRedis()) {
      try {
        return await this.withRedis((r) => r.srem(key, member));
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.srem(key, member);
  }

  async rename(from: string, to: string): Promise<boolean> {
    if (this.canTryRedis()) {
      try {
        return await this.withRedis(async (r) => {
          if ((await r.exists(from)) === 0) return false;
          await r.rename(from, to);
          return true;
        });
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.rename(from, to);
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];
    if (this.canTryRedis()) {
      try {
        return await this.withRedis((r) => r.mget(...keys));
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.mget(keys);
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    if (this.canTryRedis()) {
      try {
        return await this.withRedis(async (r) => {
          const next = await r.incr(key);
          if (next === 1) await r.pexpire(key, Math.max(1, ttlMs));
          return next;
        });
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.incr(key, ttlMs);
  }

  async exists(key: string): Promise<boolean> {
    if (this.canTryRedis()) {
      try {
        return (await this.withRedis((r) => r.exists(key))) > 0;
      } catch {
        /* fallback memori */
      }
    }
    return this.memory.exists(key);
  }

  /**
   * Jalankan `fn` hanya oleh satu pemilik lock lintas proses.
   * - `waitMs` > 0: menunggu lock sampai batas waktu (untuk operasi yang tidak
   *   boleh hilang, mis. simpan konfigurasi), lalu fail-open agar data tidak
   *   hilang permanen.
   * - `waitMs` = 0 (default): langsung return null bila lock dipegang proses lain.
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
    opts: { waitMs?: number } = {}
  ): Promise<T | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + Math.max(0, opts.waitMs ?? 0);
    // Lock selalu di backend yang sama dengan data; saat mode memori ini hanya
    // menyerialkan proses ini (perilaku lama), saat Redis aktif lintas proses.
    for (;;) {
      if (await this.setNx(key, token, ttlMs)) {
        try {
          return await fn();
        } finally {
          if ((await this.get(key)) === token) await this.del(key);
        }
      }
      if (Date.now() >= deadline) {
        if ((opts.waitMs ?? 0) > 0) {
          // Fail-open: lebih baik menyimpan (dengan transaksi DB) daripada
          // kehilangan konfigurasi karena lock basi.
          return await fn();
        }
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Tutup koneksi Redis (dipakai shutdown/test). */
  async close(): Promise<void> {
    if (this.redis) {
      try {
        if (this.redis.status !== 'end') this.redis.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.redisHealthy = false;
  }
}

/** Singleton untuk pemakaian produksi. */
export const distributedKv = new DistributedKv();

export const KV_LOCK_TTL_MS = 15_000;

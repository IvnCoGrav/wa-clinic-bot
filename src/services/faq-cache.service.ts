import Redis from 'ioredis';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class FaqCacheService {
  private redisClient: Redis | null = null;
  private redisEnabled: boolean = false;
  private memoryMap: Map<string, CacheEntry> = new Map();
  private maxMemoryEntries: number = 500;

  constructor() {
    this.initRedis();
  }

  private initRedis(): void {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    try {
      this.redisClient = new Redis({
        host,
        port,
        connectTimeout: 3000,
        lazyConnect: true,
      });

      this.redisClient.on('error', (err) => {
        if (this.redisEnabled) {
          console.warn(`[FAQ CACHE] Redis error at runtime: ${err.message}. Beralih ke In-Memory Fallback.`);
          this.redisEnabled = false;
        }
      });

      this.redisClient.connect().then(() => {
        this.redisEnabled = true;
        console.log('[FAQ CACHE] Redis connected successfully.');
      }).catch((err) => {
        this.redisEnabled = false;
      });
    } catch (err: any) {
      this.redisEnabled = false;
    }
  }

  public getTTL(): number {
    return parseInt(process.env.FAQ_CACHE_TTL_SECONDS || '21600', 10);
  }

  public generateKey(tenantId: string, userQuestion: string, contextChunks: any[], contextText: string): string {
    const normalizedQuestion = userQuestion.toLowerCase().trim().replace(/\s+/g, ' ');
    const chunkIds = (contextChunks || [])
      .map(c => c.id)
      .filter(Boolean)
      .sort()
      .join(',');
    const chunkHashPart = chunkIds.length > 0 
      ? chunkIds 
      : crypto.createHash('sha256').update(contextText || '').digest('hex');
    
    const combined = `${normalizedQuestion}|${chunkHashPart}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    return `faq:${tenantId}:${hash}`;
  }

  public async get(key: string): Promise<string | null> {
    if (this.redisEnabled && this.redisClient) {
      try {
        const val = await this.redisClient.get(key);
        if (val !== null) return val;
      } catch (err) {
        this.redisEnabled = false;
      }
    }

    // Fallback In-Memory
    const entry = this.memoryMap.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryMap.delete(key);
      return null;
    }
    return entry.value;
  }

  public async set(key: string, value: string, ttlSeconds: number = this.getTTL()): Promise<void> {
    if (this.redisEnabled && this.redisClient) {
      try {
        await this.redisClient.set(key, value, 'EX', ttlSeconds);
        return;
      } catch (err) {
        this.redisEnabled = false;
      }
    }

    // In-Memory evict lowest expiresAt if size >= maxMemoryEntries (500)
    if (this.memoryMap.size >= this.maxMemoryEntries) {
      let oldestKey: string | null = null;
      let oldestExpires = Infinity;
      for (const [k, entry] of this.memoryMap.entries()) {
        if (entry.expiresAt < oldestExpires) {
          oldestExpires = entry.expiresAt;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.memoryMap.delete(oldestKey);
      }
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryMap.set(key, { value, expiresAt });
  }

  public async invalidateAll(tenantId: string): Promise<void> {
    const prefix = `faq:${tenantId}:`;

    // 1. In-Memory Eviction
    for (const k of Array.from(this.memoryMap.keys())) {
      if (k.startsWith(prefix)) {
        this.memoryMap.delete(k);
      }
    }

    // 2. Redis Eviction (SCAN + DEL in batches)
    if (this.redisEnabled && this.redisClient) {
      try {
        let cursor = '0';
        do {
          const res = await this.redisClient.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
          cursor = res[0];
          const keys = res[1];
          if (keys.length > 0) {
            await this.redisClient.del(...keys);
          }
        } while (cursor !== '0');
      } catch (err: any) {
        console.warn(`[FAQ CACHE] Gagal invalidate Redis keys untuk tenant ${tenantId}:`, err.message);
      }
    }
  }

  /**
   * Memory store clear method for testing purposes.
   */
  public clearMemoryCache(): void {
    this.memoryMap.clear();
  }

  /**
   * Status koneksi Redis (dipakai health endpoint untuk deteksi degradasi).
   */
  public isRedisEnabled(): boolean {
    return this.redisEnabled;
  }
}

export const faqCacheService = new FaqCacheService();

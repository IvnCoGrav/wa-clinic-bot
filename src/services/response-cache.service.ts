interface CacheItem<T = any> {
  data: T;
  expiresAt: number;
}

/**
 * Server-Side Response & Aggregate Cache Service
 * Menyimpan snapshot query berat (seperti agregasi status reservasi, unread counts, dan daftar live chat)
 * dalam memori untuk merespons dalam < 1ms pada request berulang, dengan invalidasi instan saat mutasi.
 */
export class ResponseCacheService {
  private cache = new Map<string, CacheItem>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodik cleanup tiap 30 detik untuk membersihkan entry kadaluarsa dari memori
    this.cleanupTimer = setInterval(() => this.cleanup(), 30000);
    if (this.cleanupTimer && this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Mengambil data dari cache jika belum kadaluarsa
   */
  public get<T = any>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.data as T;
  }

  /**
   * Menyimpan data ke cache dengan TTL tertentu (dalam detik)
   */
  public set<T = any>(key: string, data: T, ttlSeconds: number = 10): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
    });
  }

  /**
   * Menghapus cache berdasarkan prefix (misal: 'livechat:', 'reservations:', 'customers:')
   */
  public invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) || key.includes(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Menghapus seluruh cache
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Helper pembersihan memori kadaluarsa
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

export const responseCacheService = new ResponseCacheService();

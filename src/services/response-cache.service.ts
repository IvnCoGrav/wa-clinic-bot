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
  private readonly maxEntries = 500;

  constructor() {
    // Periodik cleanup tiap 30 detik untuk membersihkan entry kadaluarsa dari memori
    this.cleanupTimer = setInterval(() => this.cleanup(), 30000);
    if (this.cleanupTimer && this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Mengambil data dari cache jika belum kadaluarsa
   * LRU: entry yang diakses dipindah ke akhir (paling baru) agar tidak mudah ter-evict.
   */
  public get<T = any>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // LRU touch: pindah ke akhir untuk menandai baru dipakai
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.data as T;
  }

  /**
   * Menyimpan data ke cache dengan TTL tertentu (dalam detik)
   * Bounded: jika melebihi maxEntries, evict entri tertua (FIFO/LRU) segera.
   */
  public set<T = any>(key: string, data: T, ttlSeconds: number = 10): void {
    // Jika key sudah ada, hapus dulu agar urutan LRU diperbarui
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
    });
    this.pruneIfNeeded();
  }

  /** Evict entri tertua hingga size <= maxEntries (FIFO/LRU). */
  private pruneIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
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
   * Helper pembersihan memori kadaluarsa + bounded eviction
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
    // Bounded eviction jika masih melebihi maxEntries setelah hapus expired
    this.pruneIfNeeded();
  }

  /** Untuk testing/diagnostik: ukuran cache saat ini. */
  public size(): number {
    return this.cache.size;
  }

  /** Stop timer (untuk testing / graceful shutdown). */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export const responseCacheService = new ResponseCacheService();

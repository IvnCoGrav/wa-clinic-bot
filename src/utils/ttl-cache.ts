/**
 * TtlCache — cache in-memory sederhana dengan masa berlaku (TTL).
 *
 * Dipakai untuk data konfigurasi tenant (mis. pemetaan
 * `waba_phone_number_id -> tenant_id`) agar perubahan di database tidak
 * tertahan selamanya di proses yang sudah berjalan. Tanpa TTL, reassignment
 * nomor WhatsApp antar-tenant tidak pernah terbaca sampai proses restart.
 *
 * `now` dapat diinjeksi untuk pengujian deterministik (tanpa timer nyata).
 */
export interface TtlCacheOptions {
  ttlMs: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly store = new Map<K, Entry<V>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    const ttl = Number(options?.ttlMs);
    this.ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : 300_000;
    this.now = options?.now ?? Date.now;
  }

  public get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  public set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  public delete(key: K): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public get size(): number {
    return this.store.size;
  }
}

/** Membaca TTL dari env dengan batas aman (default 5 menit). */
export function resolveTtlMs(envValue: string | undefined, fallbackMs = 300_000): number {
  const parsed = Number.parseInt(envValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

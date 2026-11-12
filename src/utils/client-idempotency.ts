import { distributedKv, type DistributedKv } from './distributed-kv';

/**
 * client-idempotency.ts
 *
 * Fase 1.2 — penyimpan idempotensi balasan berbasis `clientTempId` dari HP terapis.
 *
 * Latar: di sinyal 1-bar, permintaan kirim bisa timeout di sisi klien padahal
 * server sudah meneruskan pesan ke WhatsApp. Saat terapis menekan "Coba Kirim
 * Lagi", `clientTempId` yang SAMA dikirim ulang. Store ini mengingat hasil
 * pengiriman pertama (dalam TTL) sehingga retry mengembalikan hasil yang sama
 * TANPA menggandakan bubble ke pasien.
 *
 * Murni & tanpa dependensi → deterministik untuk diuji.
 */
export interface CachedReplyResult {
  at: number;
  messageId?: string;
  id?: string;
}

export class ClientIdempotencyStore {
  private map = new Map<string, CachedReplyResult>();

  constructor(
    private readonly ttlMs: number = 5 * 60 * 1000,
    private readonly maxEntries: number = 500,
    /**
     * UTL-15: backend KV bersama. Bila Redis aktif, hasil pengiriman pertama
     * terlihat oleh proses lain (app vs worker) sehingga retry tidak dobel.
     * Saat Redis mati, `distributedKv` otomatis memakai memori proses ini.
     */
    private readonly kv: DistributedKv = distributedKv,
    private readonly namespace: string = 'idem'
  ) {}

  private kvKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /** Ambil hasil tersimpan bila masih dalam TTL; selain itu null. */
  get(key: string | null | undefined, now: number = Date.now()): CachedReplyResult | null {
    if (!key) return null;
    this.prune(now);
    const hit = this.map.get(key);
    if (!hit) return null;
    if (now - hit.at >= this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    return hit;
  }

  /** Simpan hasil pengiriman sukses untuk retry berikutnya. */
  set(
    key: string | null | undefined,
    value: Omit<CachedReplyResult, 'at'>,
    now: number = Date.now()
  ): void {
    if (!key) return;
    this.map.set(key, { ...value, at: now });
    this.prune(now);
  }

  /**
   * UTL-15: versi lintas proses. Memeriksa cache lokal dulu (murah), lalu KV
   * bersama; hasil dari proses lain disalin ke cache lokal.
   */
  async getAsync(key: string | null | undefined, now: number = Date.now()): Promise<CachedReplyResult | null> {
    if (!key) return null;
    const local = this.get(key, now);
    if (local) return local;
    try {
      const raw = await this.kv.get(this.kvKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedReplyResult;
      if (!parsed || typeof parsed.at !== 'number') return null;
      if (now - parsed.at >= this.ttlMs) return null;
      this.map.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  /** UTL-15: tulis ke cache lokal + KV bersama (TTL sama). */
  async setAsync(
    key: string | null | undefined,
    value: Omit<CachedReplyResult, 'at'>,
    now: number = Date.now()
  ): Promise<void> {
    if (!key) return;
    this.set(key, value, now);
    try {
      await this.kv.set(this.kvKey(key), JSON.stringify({ ...value, at: now }), this.ttlMs);
    } catch {
      // Fallback lokal sudah tersimpan; KV bersama opsional.
    }
  }

  private prune(now: number): void {
    if (this.map.size <= this.maxEntries) {
      // tetap buang entri kedaluwarsa agar tidak menumpuk (murah untuk <=500)
      for (const [k, v] of this.map) {
        if (now - v.at >= this.ttlMs) this.map.delete(k);
      }
      return;
    }
    for (const [k, v] of this.map) {
      if (now - v.at >= this.ttlMs) this.map.delete(k);
    }
    // masih penuh → buang yang paling tua
    if (this.map.size > this.maxEntries) {
      const sorted = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at);
      const excess = this.map.size - this.maxEntries;
      for (let i = 0; i < excess; i++) this.map.delete(sorted[i][0]);
    }
  }

  size(): number {
    return this.map.size;
  }
}

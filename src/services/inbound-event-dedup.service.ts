import { distributedKv, DistributedKv } from '../utils/distributed-kv';

/**
 * Klaim sekali-pakai untuk event inbound NON-PESAN (reaction, ack, dsb).
 *
 * WAHA maupun Meta Cloud API dapat mengirim ulang webhook yang sama (retry,
 * reconnect, reconnect+sync). Event pesan sudah dilindungi idempotensi
 * `wa_message_id`, tetapi event reaction/ack dimutasi SEBELUM jalur itu —
 * sehingga retry dapat menulis ulang payload dan mem-broadcast ulang SSE.
 *
 * Backend: DistributedKv (Redis) agar klaim berlaku lintas app/worker; bila Redis
 * mati, fallback memori per-proses (degradasi jujur, bukan crash).
 */
class InboundEventDedupService {
  private memory = new Map<string, number>();

  constructor(private readonly kv: DistributedKv = distributedKv) {}

  private prune(now: number): void {
    if (this.memory.size < 500) return;
    for (const [key, expiresAt] of this.memory) {
      if (expiresAt <= now) this.memory.delete(key);
    }
  }

  /**
   * @returns true = event pertama (boleh mutasi), false = duplikat (abaikan).
   */
  public async claimOnce(key: string, ttlMs: number = 10 * 60_000): Promise<boolean> {
    if (!key) return true;
    const now = Date.now();
    this.prune(now);

    const memExpiry = this.memory.get(key);
    if (memExpiry && memExpiry > now) return false;

    try {
      if (this.kv.isShared()) {
        const claimed = await this.kv.setNx(`dedup:${key}`, '1', ttlMs);
        if (!claimed) {
          // Catat juga di memori agar pengecekan lokal berikutnya murah.
          this.memory.set(key, now + ttlMs);
          return false;
        }
      }
    } catch {
      /* Redis error → lanjut dengan memori (jangan blokir event) */
    }

    this.memory.set(key, now + ttlMs);
    return true;
  }

  /** Test helper. */
  public reset(): void {
    this.memory.clear();
  }
}

export const inboundEventDedup = new InboundEventDedupService();

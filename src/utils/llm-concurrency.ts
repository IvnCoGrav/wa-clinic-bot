/**
 * llm-concurrency.ts — Pembatas jumlah panggilan LLM yang berjalan SERENTAK dalam
 * satu instance. Mencegah burst request (mis. 50 chat datang bersamaan) memicu
 * 429 Too Many Requests / rate-limit dari provider, yang membuat Circuit Breaker
 * ikut terbuka dan menurunkan rasio keberhasilan.
 *
 * Implementasi semaphore berbasis promise sederhana — TANPA dependency eksternal
 * (p-limit tidak diinstal di repo ini). Batch berikutnya diantre di memori sampai
 * ada slot kosong.
 *
 * Max concurrency default 4, bisa di-override via env `LLM_MAX_CONCURRENCY`.
 */

export class LlmConcurrencyLimiter {
  private queue: Array<() => void> = [];
  private active = 0;
  private readonly max: number;

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  /**
   * Jalankan task dengan slot concurrency terbatas. Task yang melewati batas
   * menunggu di antrean FIFO sampai slot tersedia.
   */
  public async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  public get activeCount(): number {
    return this.active;
  }

  public get queuedCount(): number {
    return this.queue.length;
  }
}

function resolveMaxFromEnv(): number {
  const raw = Number(process.env.LLM_MAX_CONCURRENCY);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 4;
}

/**
 * Limiter global yang dipakai generator LLM (llmResponseGenerator). Dibuat
 * module-level agar seluruh panggilan CHAT_REPLY berbagi pool yang sama.
 */
export const llmConcurrencyLimiter = new LlmConcurrencyLimiter(resolveMaxFromEnv());

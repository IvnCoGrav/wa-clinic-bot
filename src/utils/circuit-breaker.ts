export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker<TArgs extends any[], TResult> {
  private state: CircuitState = 'CLOSED';
  private failureThreshold = 0.5; // 50%
  private slidingWindowSize = 10;
  private cooldownPeriodMs = 30000; // 30 seconds
  private lastStateChange: number = Date.now();
  private requestHistory: boolean[] = []; // true = success, false = failure
  private name: string = 'Unnamed Service';
  private usedFallback = false;

  constructor(
    private requestFunction: (...args: TArgs) => Promise<TResult>,
    private fallbackFunction: (...args: TArgs) => Promise<TResult>,
    options?: {
      name?: string;
      failureThreshold?: number;
      slidingWindowSize?: number;
      cooldownPeriodMs?: number;
    }
  ) {
    if (options) {
      if (options.name !== undefined) this.name = options.name;
      if (options.failureThreshold !== undefined) this.failureThreshold = options.failureThreshold;
      if (options.slidingWindowSize !== undefined) this.slidingWindowSize = options.slidingWindowSize;
      if (options.cooldownPeriodMs !== undefined) this.cooldownPeriodMs = options.cooldownPeriodMs;
    }
  }

  public getState(): CircuitState {
    this.checkCooldown();
    return this.state;
  }

  /** Apakah hasil eksekusi terakhir berasal dari fallbackFunction (bukan requestFunction). */
  public wasFallbackUsed(): boolean {
    return this.usedFallback;
  }

  private checkCooldown(): void {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastStateChange >= this.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
        console.log(`[Circuit Breaker: ${this.name}] Transitioning to HALF_OPEN after cooldown.`);
      }
    }
  }

  private recordResult(success: boolean): void {
    this.requestHistory.push(success);
    if (this.requestHistory.length > this.slidingWindowSize) {
      this.requestHistory.shift();
    }

    if (this.state === 'CLOSED') {
      if (this.requestHistory.length >= this.slidingWindowSize) {
        const failures = this.requestHistory.filter(res => !res).length;
        const failureRate = failures / this.requestHistory.length;
        if (failureRate >= this.failureThreshold) {
          this.state = 'OPEN';
          this.lastStateChange = Date.now();
          console.warn(`[Circuit Breaker: ${this.name}] Trip! Failure rate is ${(failureRate * 100).toFixed(0)}% (${failures}/${this.requestHistory.length}). Circuit is OPEN.`);
        }
      }
    } else if (this.state === 'HALF_OPEN') {
      if (success) {
        this.state = 'CLOSED';
        this.requestHistory = []; // Reset history
        this.lastStateChange = Date.now();
        console.log(`[Circuit Breaker: ${this.name}] Probe success! Circuit returned to CLOSED.`);
      } else {
        this.state = 'OPEN';
        this.lastStateChange = Date.now();
        console.warn(`[Circuit Breaker: ${this.name}] Probe failed! Circuit returned to OPEN.`);
      }
    }
  }

  public async execute(...args: TArgs): Promise<TResult> {
    this.checkCooldown();
    this.usedFallback = false;

    if (this.state === 'OPEN') {
      console.warn(`[Circuit Breaker: ${this.name}] Blocked request (circuit is OPEN). Triggering fallback.`);
      this.usedFallback = true;
      return this.fallbackFunction(...args);
    }

    try {
      const result = await this.requestFunction(...args);
      this.recordResult(true);
      return result;
    } catch (err: any) {
      const status = err?.response?.status || err?.status || 'N/A';
      const code = err?.code || 'NONE';
      const errMsg = err?.message || String(err);
      
      let reasonCategory = 'UNKNOWN';
      if (code === 'ECONNABORTED' || errMsg.toLowerCase().includes('timeout')) {
        reasonCategory = 'TIMEOUT (API Pihak Ketiga Lambat / Lambat Merespons)';
      } else if (status === 429) {
        reasonCategory = 'RATE_LIMIT (Kuota API Habis / Terlalu Banyak Request)';
      } else if (status >= 500) {
        reasonCategory = `SERVER_ERROR (Server Pihak Ketiga Error ${status})`;
      } else if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
        reasonCategory = 'NETWORK_ERROR (Koneksi Server / DNS bermasalah)';
      }

      console.error(
        `[Circuit Breaker: ${this.name}] Request Failure! Reason: [${reasonCategory}] | HTTP Status: ${status} | Code: ${code} | Message: ${errMsg}` +
        this.formatResponseBody(err)
      );
      this.recordResult(false);
      this.usedFallback = true;
      return this.fallbackFunction(...args);
    }
  }

  /**
   * Lampirkan body response error (mis. JSON error asli dari Meta/Google) ke log,
   * agar root cause (contohnya pesan validasi 400 Meta CAPI) bisa dibaca langsung.
   */
  private formatResponseBody(err: any): string {
    const body = err?.response?.data;
    if (body === undefined || body === null) return '';
    try {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      return bodyStr ? ` | Response Body: ${bodyStr.length > 500 ? bodyStr.substring(0, 500) + '…' : bodyStr}` : '';
    } catch {
      return '';
    }
  }
}

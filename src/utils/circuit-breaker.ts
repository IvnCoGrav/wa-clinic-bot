export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker<TArgs extends any[], TResult> {
  private state: CircuitState = 'CLOSED';
  private failureThreshold = 0.5; // 50%
  private slidingWindowSize = 10;
  private cooldownPeriodMs = 30000; // 30 seconds
  private lastStateChange: number = Date.now();
  private requestHistory: boolean[] = []; // true = success, false = failure

  constructor(
    private requestFunction: (...args: TArgs) => Promise<TResult>,
    private fallbackFunction: (...args: TArgs) => Promise<TResult>,
    options?: {
      failureThreshold?: number;
      slidingWindowSize?: number;
      cooldownPeriodMs?: number;
    }
  ) {
    if (options) {
      if (options.failureThreshold !== undefined) this.failureThreshold = options.failureThreshold;
      if (options.slidingWindowSize !== undefined) this.slidingWindowSize = options.slidingWindowSize;
      if (options.cooldownPeriodMs !== undefined) this.cooldownPeriodMs = options.cooldownPeriodMs;
    }
  }

  public getState(): CircuitState {
    this.checkCooldown();
    return this.state;
  }

  private checkCooldown(): void {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastStateChange >= this.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
        console.log(`[Circuit Breaker] Transitioning to HALF_OPEN after cooldown.`);
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
          console.warn(`[Circuit Breaker] Trip! Failure rate is ${(failureRate * 100).toFixed(0)}%. Circuit is OPEN.`);
        }
      }
    } else if (this.state === 'HALF_OPEN') {
      if (success) {
        this.state = 'CLOSED';
        this.requestHistory = []; // Reset history
        this.lastStateChange = Date.now();
        console.log(`[Circuit Breaker] Probe success! Circuit returned to CLOSED.`);
      } else {
        this.state = 'OPEN';
        this.lastStateChange = Date.now();
        console.warn(`[Circuit Breaker] Probe failed! Circuit returned to OPEN.`);
      }
    }
  }

  public async execute(...args: TArgs): Promise<TResult> {
    this.checkCooldown();

    if (this.state === 'OPEN') {
      console.warn(`[Circuit Breaker] Blocked request (circuit is OPEN). Triggering fallback.`);
      return this.fallbackFunction(...args);
    }

    try {
      const result = await this.requestFunction(...args);
      this.recordResult(true);
      return result;
    } catch (err: any) {
      console.error(`[Circuit Breaker] Request failure:`, err.message);
      this.recordResult(false);
      return this.fallbackFunction(...args);
    }
  }
}

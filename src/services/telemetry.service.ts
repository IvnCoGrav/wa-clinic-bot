import { TurnQualityMetrics, AiHealthSummary } from '../types/telemetry';

const MAX_BUFFER = 5000;

class TelemetryService {
  private buffer: TurnQualityMetrics[] = [];
  private nluErrorTimestamps: number[] = [];
  private rsqrTimestamps: number[] = [];
  private lastMutilationMap = new Map<string, { ratio: number; raw: string | null; sanitized: string | null }>();
  private lastNluErrorMap = new Map<string, string | null>();
  private lastModelMap = new Map<string, string>();

  calculateMutilationRatio(raw: string | null, sanitized: string | null): number {
    if (!raw || raw.length === 0) return 0;
    if (!sanitized) return 1;
    const rawLen = raw.length;
    const sanLen = sanitized.length;
    if (sanLen >= rawLen) return 0;
    return (rawLen - sanLen) / rawLen;
  }

  checkUnjustifiedRsqr(isLocationConfirmed: boolean, dynamicCloserInstruction: string | null | undefined): boolean {
    if (!isLocationConfirmed) return false;
    if (!dynamicCloserInstruction) return false;
    const asksKelurahan = /kelurahan mana|alamat mana|daerah mana/i.test(dynamicCloserInstruction);
    return asksKelurahan;
  }

  recordTurn(metrics: TurnQualityMetrics): void {
    const t0 = Date.now();
    // Simpan ke buffer (ring, max 5000)
    this.buffer.push(metrics);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();

    // Sliding window untuk alerting (1 jam)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (metrics.isUnjustifiedRsqr) {
      this.rsqrTimestamps.push(metrics.timestamp);
      this.rsqrTimestamps = this.rsqrTimestamps.filter(t => t >= oneHourAgo);
    }
    if (metrics.nluErrorCode) {
      this.nluErrorTimestamps.push(metrics.timestamp);
      this.nluErrorTimestamps = this.nluErrorTimestamps.filter(t => t >= oneHourAgo);
    }

    // Overhead check (harus <2ms)
    const elapsed = Date.now() - t0;
    if (elapsed > 5) {
      console.warn(`[TELEMETRY] recordTurn overhead ${elapsed}ms >5ms`);
    }
  }

  getHealthSummary(windowHours = 24): AiHealthSummary {
    const now = Date.now();
    const windowMs = windowHours * 60 * 60 * 1000;
    const windowStart = now - windowMs;
    const windowMetrics = this.buffer.filter(m => m.timestamp >= windowStart);

    const totalTurns = windowMetrics.length;
    if (totalTurns === 0) {
      return {
        windowHours, totalTurns: 0, silentDropRate: 0, unjustifiedRsqrRate: 0,
        sanitizerMutilationRate: 0, nluErrorRate: 0,
        p50LatencyMs: 0, p90LatencyMs: 0, p95LatencyMs: 0,
        status: 'HEALTHY', generatedAt: new Date().toISOString(),
      };
    }

    // SDR: HUMAN_HANDLING tanpa balasan, di luar kejang/pendarahan (isMedicalEmergency sudah di-filter di slot-engine, jadi di sini hitung semua isSilentDrop)
    const silentDrops = windowMetrics.filter(m => m.isSilentDrop).length;
    const silentDropRate = (silentDrops / totalTurns) * 100;

    const rsqrCount = windowMetrics.filter(m => m.isUnjustifiedRsqr).length;
    const unjustifiedRsqrRate = (rsqrCount / totalTurns) * 100;

    const mutilated = windowMetrics.filter(m => m.mutilationRatio > 0.3).length;
    const sanitizerMutilationRate = (mutilated / totalTurns) * 100;

    const nluErrors = windowMetrics.filter(m => m.nluErrorCode).length;
    const nluErrorRate = (nluErrors / totalTurns) * 100;

    // Latensi P50/P90/P95
    const latencies = windowMetrics.map(m => m.latencyMs).sort((a, b) => a - b);
    const p50 = this.percentile(latencies, 50);
    const p90 = this.percentile(latencies, 90);
    const p95 = this.percentile(latencies, 95);

    // Per-model
    const perModel: Record<string, number[]> = {};
    for (const m of windowMetrics) {
      const key = m.modelName || 'unknown';
      if (!perModel[key]) perModel[key] = [];
      perModel[key].push(m.latencyMs);
    }
    const perModelLatency: Record<string, { p50: number; p90: number; p95: number; count: number }> = {};
    for (const [model, arr] of Object.entries(perModel)) {
      const sorted = arr.sort((a, b) => a - b);
      perModelLatency[model] = { p50: this.percentile(sorted, 50), p90: this.percentile(sorted, 90), p95: this.percentile(sorted, 95), count: arr.length };
    }

    // Status berdasarkan SLA
    let status: AiHealthSummary['status'] = 'HEALTHY';
    if (unjustifiedRsqrRate > 0 || silentDropRate >= 0.5 || nluErrorRate >= 1.5 || p95 > 8000) {
      // Critical jika RSQR >0 (zero tolerance) atau SDR >=0.5
      if (unjustifiedRsqrRate > 0 || silentDropRate >= 0.5) status = 'CRITICAL';
      else if (sanitizerMutilationRate >= 1 || nluErrorRate >= 1.5 || p95 > 8000) status = 'DEGRADED';
    }
    // SMR <1.0 adalah target, tapi tidak critical jika sedikit di atas
    if (status === 'HEALTHY' && sanitizerMutilationRate >= 1) status = 'DEGRADED';

    return {
      windowHours, totalTurns, silentDropRate, unjustifiedRsqrRate, sanitizerMutilationRate, nluErrorRate,
      p50LatencyMs: p50, p90LatencyMs: p90, p95LatencyMs: p95,
      status, perModelLatency, generatedAt: new Date().toISOString(),
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  // Untuk alert-daemon: cek threshold dalam 1 jam terakhir
  getRecentCounts(): { rsqrInLastHour: number; nluErrorsConsecutive: number; lastNluErrors: number[] } {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const rsqrInLastHour = this.rsqrTimestamps.filter(t => t >= oneHourAgo).length;
    // consecutive NLU 400 dalam buffer terbaru
    let consecutive = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].nluErrorCode) consecutive++;
      else break;
    }
    return { rsqrInLastHour, nluErrorsConsecutive: consecutive, lastNluErrors: [...this.nluErrorTimestamps] };
  }

  setLastMutilation(phone: string, ratio: number, raw: string | null, sanitized: string | null): void {
    this.lastMutilationMap.set(phone, { ratio, raw, sanitized });
  }
  getLastMutilation(phone: string): { ratio: number; raw: string | null; sanitized: string | null } | undefined {
    return this.lastMutilationMap.get(phone);
  }
  clearLastMutilation(phone: string): void {
    this.lastMutilationMap.delete(phone);
  }

  setLastNluError(phone: string, code: string | null): void {
    if (code) this.lastNluErrorMap.set(phone, code);
    else this.lastNluErrorMap.delete(phone);
  }
  getLastNluError(phone: string): string | null {
    return this.lastNluErrorMap.get(phone) || null;
  }
  setLastModel(phone: string, model: string): void {
    if (model) this.lastModelMap.set(phone, model);
  }
  getLastModel(phone: string): string | undefined {
    return this.lastModelMap.get(phone);
  }
  clearLastModel(phone: string): void {
    this.lastModelMap.delete(phone);
  }

  // Untuk testing: clear buffer
  clear(): void {
    this.buffer = [];
    this.nluErrorTimestamps = [];
    this.rsqrTimestamps = [];
    this.lastMutilationMap.clear();
    this.lastNluErrorMap.clear();
  }

  // Untuk testing: akses buffer
  getBuffer(): TurnQualityMetrics[] {
    return [...this.buffer];
  }
}

export const telemetryService = new TelemetryService();

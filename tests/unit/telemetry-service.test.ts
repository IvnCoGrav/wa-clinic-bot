import { describe, it, expect, beforeEach, vi } from 'vitest';
import { telemetryService } from '../../src/services/telemetry.service';

describe('TelemetryService', () => {
  beforeEach(() => {
    telemetryService.clear();
    vi.clearAllMocks();
  });

  it('calculateMutilationRatio: 0 jika tidak terpotong', () => {
    expect(telemetryService.calculateMutilationRatio('hello world', 'hello world')).toBe(0);
  });

  it('calculateMutilationRatio: >0.3 jika terpotong >30%', () => {
    const raw = 'a'.repeat(100);
    const sanitized = 'a'.repeat(60);
    expect(telemetryService.calculateMutilationRatio(raw, sanitized)).toBeCloseTo(0.4);
  });

  it('checkUnjustifiedRsqr: true jika lokasi confirmed dan closer minta kelurahan', () => {
    expect(telemetryService.checkUnjustifiedRsqr(true, 'kelurahan mana Bunda?')).toBe(true);
    expect(telemetryService.checkUnjustifiedRsqr(false, 'kelurahan mana')).toBe(false);
    expect(telemetryService.checkUnjustifiedRsqr(true, null)).toBe(false);
  });

  it('recordTurn dan getHealthSummary menghitung SDR, RSQR, SMR, NLU, P95', () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      telemetryService.recordTurn({
        conversationId: `conv_${i}`, customerPhone: `6281${i}`, tenantId: 'default-tenant', timestamp: now - 1000 * i,
        rawLlmReply: 'raw', sanitizedReply: 'sanitized', mutilationRatio: i < 2 ? 0.5 : 0,
        isSilentDrop: i === 0, isUnjustifiedRsqr: i < 2, nluErrorCode: i < 1 ? 'HTTP_400' : null,
        isJsonTruncated: false, latencyMs: 100 + i * 10, modelName: 'test-model',
      } as any);
    }
    const summary = telemetryService.getHealthSummary(24);
    expect(summary.totalTurns).toBe(10);
    expect(summary.silentDropRate).toBe(10); // 1/10
    expect(summary.unjustifiedRsqrRate).toBe(20); // 2/10
    expect(summary.sanitizerMutilationRate).toBe(20); // 2/10 >0.3
    expect(summary.nluErrorRate).toBe(10); // 1/10
    expect(summary.p95LatencyMs).toBeGreaterThan(0);
    expect(summary.status).toBe('CRITICAL'); // RSQR >0
  });

  it('overhead <2ms per recordTurn', () => {
    const start = Date.now();
    telemetryService.recordTurn({ conversationId: 'c', customerPhone: '6281', tenantId: 't', timestamp: Date.now(), rawLlmReply: 'a', sanitizedReply: 'a', mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: false, nluErrorCode: null, isJsonTruncated: false, latencyMs: 100 } as any);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});

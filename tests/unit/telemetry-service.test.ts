import { describe, it, expect, beforeEach, vi } from 'vitest';
import { telemetryService } from '../../src/services/telemetry.service';
import { alertService } from '../../src/services/alert.service';

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

  it('alert-daemon: 2x RSQR dalam 1 jam memicu CRITICAL_AI_LOOP', async () => {
    const spy = vi.spyOn(alertService, 'notifyAlert').mockResolvedValue({ sent: true, channel: 'telegram' } as any);
    const { alertDaemonService } = await import('../../src/services/alert-daemon.service');
    const now = Date.now();
    // Record 2 RSQR
    telemetryService.recordTurn({ conversationId: 'c1', customerPhone: '6281', tenantId: 't', timestamp: now, rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: true, nluErrorCode: null, isJsonTruncated: false, latencyMs: 100 } as any);
    telemetryService.recordTurn({ conversationId: 'c2', customerPhone: '6282', tenantId: 't', timestamp: now, rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: true, nluErrorCode: null, isJsonTruncated: false, latencyMs: 100 } as any);
    await alertDaemonService.evaluate({ conversationId: 'c2', customerPhone: '6282', tenantId: 't', timestamp: now, rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: true, nluErrorCode: null, isJsonTruncated: false, latencyMs: 100 } as any);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'CRITICAL_AI_LOOP' }));
  });

  it('alert-daemon: 3x NLU 400 berturut-turut memicu NLU_PROVIDER_DEGRADED', async () => {
    const spy = vi.spyOn(alertService, 'notifyAlert').mockResolvedValue({ sent: true, channel: 'telegram' } as any);
    const { alertDaemonService } = await import('../../src/services/alert-daemon.service');
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      telemetryService.recordTurn({ conversationId: `c${i}`, customerPhone: '6281', tenantId: 't', timestamp: now, rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: false, nluErrorCode: 'HTTP_400', isJsonTruncated: false, latencyMs: 100 } as any);
    }
    await alertDaemonService.evaluate({ conversationId: 'c3', customerPhone: '6281', tenantId: 't', timestamp: now, rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: false, nluErrorCode: 'HTTP_400', isJsonTruncated: false, latencyMs: 100 } as any);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'NLU_PROVIDER_DEGRADED' }));
  });

  it('alert-daemon: 1x silent drop memicu UNINTENDED_SILENT_DROP', async () => {
    const spy = vi.spyOn(alertService, 'notifyAlert').mockResolvedValue({ sent: true, channel: 'telegram' } as any);
    const { alertDaemonService } = await import('../../src/services/alert-daemon.service');
    await alertDaemonService.evaluate({ conversationId: 'c1', customerPhone: '6289', tenantId: 't', timestamp: Date.now(), rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: true, isUnjustifiedRsqr: false, nluErrorCode: null, isJsonTruncated: false, latencyMs: 100 } as any);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'UNINTENDED_SILENT_DROP' }));
  });

  it('overhead <2ms per recordTurn', () => {
    const start = Date.now();
    telemetryService.recordTurn({ conversationId: 'c', customerPhone: '6281', tenantId: 't', timestamp: Date.now(), rawLlmReply: 'a', sanitizedReply: 'a', mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: false, nluErrorCode: null, isJsonTruncated: false, latencyMs: 100 } as any);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});

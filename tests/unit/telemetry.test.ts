import { describe, it, expect, beforeEach } from 'vitest';
import { telemetryService } from '../../src/services/telemetry.service';

describe('TelemetryService Quality & Health Monitoring (T0.1)', () => {
  beforeEach(() => {
    telemetryService.clear();
  });

  it('Buffer kosong -> status === "NO_DATA"', () => {
    const summary = telemetryService.getHealthSummary(24);
    expect(summary.totalTurns).toBe(0);
    expect(summary.status).toBe('NO_DATA');
  });

  it('Setelah recordTurn dengan latency dan SDR normal -> status === "HEALTHY"', () => {
    const now = Date.now();
    telemetryService.recordTurn({
      conversationId: 'c1',
      customerPhone: '628123456789',
      tenantId: 'default-tenant',
      timestamp: now,
      rawLlmReply: 'Halo Bunda, ada yang bisa dibantu?',
      sanitizedReply: 'Halo Bunda, ada yang bisa dibantu?',
      mutilationRatio: 0,
      isSilentDrop: false,
      isUnjustifiedRsqr: false,
      nluErrorCode: null,
      isJsonTruncated: false,
      latencyMs: 1200,
      modelName: 'gpt-4o-mini',
    });

    const summary = telemetryService.getHealthSummary(24);
    expect(summary.totalTurns).toBe(1);
    expect(summary.status).toBe('HEALTHY');
    expect(summary.silentDropRate).toBe(0);
    expect(summary.unjustifiedRsqrRate).toBe(0);
    expect(summary.p50LatencyMs).toBe(1200);
  });

  it('SDR >= 0.5% -> status === "CRITICAL"', () => {
    const now = Date.now();
    // 1 drop out of 2 turns = 50% SDR
    telemetryService.recordTurn({
      conversationId: 'c1',
      customerPhone: '628123456789',
      tenantId: 'default-tenant',
      timestamp: now,
      rawLlmReply: null,
      sanitizedReply: null,
      mutilationRatio: 0,
      isSilentDrop: true,
      isUnjustifiedRsqr: false,
      nluErrorCode: null,
      isJsonTruncated: false,
      latencyMs: 500,
      modelName: 'gpt-4o-mini',
    });

    telemetryService.recordTurn({
      conversationId: 'c2',
      customerPhone: '628123456780',
      tenantId: 'default-tenant',
      timestamp: now,
      rawLlmReply: 'Halo Bunda',
      sanitizedReply: 'Halo Bunda',
      mutilationRatio: 0,
      isSilentDrop: false,
      isUnjustifiedRsqr: false,
      nluErrorCode: null,
      isJsonTruncated: false,
      latencyMs: 600,
      modelName: 'gpt-4o-mini',
    });

    const summary = telemetryService.getHealthSummary(24);
    expect(summary.totalTurns).toBe(2);
    expect(summary.silentDropRate).toBe(50);
    expect(summary.status).toBe('CRITICAL');
  });

  it('Unjustified RSQR > 0 -> status === "CRITICAL"', () => {
    const now = Date.now();
    telemetryService.recordTurn({
      conversationId: 'c1',
      customerPhone: '628123456789',
      tenantId: 'default-tenant',
      timestamp: now,
      rawLlmReply: 'Rumah Bunda di kelurahan mana ya?',
      sanitizedReply: 'Rumah Bunda di kelurahan mana ya?',
      mutilationRatio: 0,
      isSilentDrop: false,
      isUnjustifiedRsqr: true,
      nluErrorCode: null,
      isJsonTruncated: false,
      latencyMs: 800,
      modelName: 'gpt-4o-mini',
    });

    const summary = telemetryService.getHealthSummary(24);
    expect(summary.unjustifiedRsqrRate).toBe(100);
    expect(summary.status).toBe('CRITICAL');
  });

  it('calculateMutilationRatio menghitung proporsi pemotongan string dengan benar', () => {
    expect(telemetryService.calculateMutilationRatio(null, null)).toBe(0);
    expect(telemetryService.calculateMutilationRatio('abc', 'abc')).toBe(0);
    expect(telemetryService.calculateMutilationRatio('abcdefghij', 'abcde')).toBe(0.5);
    expect(telemetryService.calculateMutilationRatio('abc', null)).toBe(1);
  });
});

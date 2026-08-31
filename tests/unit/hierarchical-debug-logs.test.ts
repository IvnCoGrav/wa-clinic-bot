import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordLlmExecution,
  getGroupedLlmExecutionLogs,
  clearLlmExecutionLogs,
} from '../../src/utils/llm-execution-logger';

describe('Hierarchical 3-Level LLM Debug Logger (Slot Engine)', () => {
  beforeEach(() => {
    clearLlmExecutionLogs();
  });

  it('should group SLOT_EXTRACTOR + SLOT_GENERATOR under one bubble via correlationId', () => {
    const correlationId = 'corr_slot_001';
    const phone = '6289620099380';
    const customerName = 'Hanif fatimatuzzahro';
    const customerInput = 'Adek nyaa gk pilek kak tp agak grok², kayak buntu mau pijat sama sinar moksa';
    const now = Date.now();

    recordLlmExecution({
      timestamp: new Date(now).toISOString(),
      flowType: 'SLOT_EXTRACTOR',
      customerPhone: phone,
      customerName,
      customerInput,
      bubbleCorrelationId: correlationId,
      reasoning: 'Extract: keluhan grok-grok, minta pijat + sinar moksa',
      finalReply: 'Slots: {keluhan: grok-grok}',
      modelUsed: 'MiniMax-M2.7',
      durationMs: 250,
      status: 'SUCCESS',
    });

    recordLlmExecution({
      timestamp: new Date(now + 200).toISOString(),
      flowType: 'SLOT_GENERATOR',
      customerPhone: phone,
      customerName,
      customerInput,
      bubbleCorrelationId: correlationId,
      reasoning: 'Generate: rekomendasikan Pulih Ceria + Sinar Moksa',
      finalReply: 'Halo Bunda! Untuk grok-grok kami rekomendasikan Pijat Pulih Ceria + Sinar Moksa ya Bunda 😊',
      modelUsed: 'MiniMax-M2.7',
      durationMs: 850,
      status: 'SUCCESS',
    });

    const grouped = getGroupedLlmExecutionLogs();
    expect(grouped.length).toBe(1);
    expect(grouped[0].customerPhone).toBe(phone);
    expect(grouped[0].totalBubbles).toBe(1);
    expect(grouped[0].totalAiCalls).toBe(2);
    expect(grouped[0].bubbles[0].correlationId).toBe(correlationId);
    expect(grouped[0].bubbles[0].aiCalls.length).toBe(2);
    expect(grouped[0].bubbles[0].aiCalls[0].flowType).toBe('SLOT_EXTRACTOR');
    expect(grouped[0].bubbles[0].aiCalls[1].flowType).toBe('SLOT_GENERATOR');
  });

  it('should auto-cluster SLOT_EXTRACTOR + SLOT_FAST_FAQ without correlationId via time/input heuristic', () => {
    const phone = '6281234567890';
    const rawText = 'Halo min, mau reservasi baby spa besok sore jam 3 ya';
    const now = Date.now();

    recordLlmExecution({
      timestamp: new Date(now).toISOString(),
      flowType: 'SLOT_EXTRACTOR',
      customerPhone: phone,
      customerInput: rawText,
      reasoning: 'Extract: reservasi baby spa besok jam 3',
      finalReply: 'Slots extracted',
      status: 'SUCCESS',
    });

    recordLlmExecution({
      timestamp: new Date(now + 600).toISOString(),
      flowType: 'SLOT_FAST_FAQ',
      customerPhone: phone,
      customerInput: rawText,
      reasoning: 'Fast FAQ: jadwal jam 3 tersedia',
      finalReply: 'Halo Bunda! Reservasi baby spa besok jam 3 sore tersedia ya Bunda 😊',
      status: 'SUCCESS',
    });

    const grouped = getGroupedLlmExecutionLogs();
    expect(grouped.length).toBe(1);
    expect(grouped[0].totalBubbles).toBe(1);
    expect(grouped[0].bubbles[0].aiCalls.map((c) => c.flowType)).toEqual(['SLOT_EXTRACTOR', 'SLOT_FAST_FAQ']);
  });

  it('should track FALLBACK status accurately within slot flow', () => {
    const correlationId = 'corr_slot_fallback_002';
    const phone = '628991234567';
    const rawText = 'Ongkir ke Rungkut berapa ya?';
    const now = Date.now();

    recordLlmExecution({
      timestamp: new Date(now).toISOString(),
      flowType: 'SLOT_EXTRACTOR',
      customerPhone: phone,
      customerInput: rawText,
      bubbleCorrelationId: correlationId,
      reasoning: '[FALLBACK] low confidence extraction',
      finalReply: 'Slots partial',
      status: 'FALLBACK',
    });

    recordLlmExecution({
      timestamp: new Date(now + 500).toISOString(),
      flowType: 'SLOT_GENERATOR',
      customerPhone: phone,
      customerInput: rawText,
      bubbleCorrelationId: correlationId,
      reasoning: 'Generator fallback to FAQ',
      groundTruthUsed: { kecamatan: 'Rungkut', ongkir: 15000 },
      finalReply: 'Untuk Bunda di Rungkut, ongkir homecare kami hanya Rp 15.000 ya Bunda 🌸',
      status: 'SUCCESS',
    });

    const grouped = getGroupedLlmExecutionLogs();
    expect(grouped.length).toBe(1);
    const bubble = grouped[0].bubbles[0];
    expect(bubble.aiCalls[0].status).toBe('FALLBACK');
    expect(bubble.aiCalls[1].status).toBe('SUCCESS');
    expect(bubble.aiCalls[1].groundTruthUsed).toEqual({ kecamatan: 'Rungkut', ongkir: 15000 });
  });
});

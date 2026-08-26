import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordLlmExecution,
  getGroupedLlmExecutionLogs,
  clearLlmExecutionLogs,
} from '../../src/utils/llm-execution-logger';

describe('Hierarchical 3-Level LLM Debug Logger', () => {
  beforeEach(() => {
    clearLlmExecutionLogs();
  });

  it('should group multiple AI calls for the same chat bubble under a single customer phone and correlation ID', () => {
    const correlationId = 'corr_test_bubble_001';
    const phone = '6289620099380';
    const customerName = 'Hanif fatimatuzzahro';
    const customerInput = 'Adek nyaa gk pilek kak tp agak grok², kayak buntu mau pijat sama sinar moksa';

    const now = Date.now();

    // Step 1: NLU Intent Classification
    recordLlmExecution({
      timestamp: new Date(now).toISOString(),
      flowType: 'NLU_CLASSIFICATION',
      customerPhone: phone,
      customerName,
      customerInput,
      bubbleCorrelationId: correlationId,
      reasoning: 'Customer mengeluhkan pernapasan grok-grok dan minta pijat + sinar moksa',
      finalReply: 'INTENT: treatment_inquiry',
      modelUsed: 'MiniMax-M2.7-highspeed',
      durationMs: 250,
      status: 'SUCCESS',
    });

    // Step 2: AI Router Decision
    recordLlmExecution({
      timestamp: new Date(now + 100).toISOString(),
      flowType: 'AI_ROUTER',
      customerPhone: phone,
      customerName,
      customerInput,
      bubbleCorrelationId: correlationId,
      reasoning: 'Rute ke FAQ / treatment handler untuk penjelasan Pulih Ceria + Sinar Moksa',
      finalReply: 'ROUTE: CHATBOT_AUTO',
      modelUsed: 'MiniMax-M2.7-highspeed',
      durationMs: 310,
      status: 'SUCCESS',
    });

    // Step 3: Chatbot Generator
    recordLlmExecution({
      timestamp: new Date(now + 200).toISOString(),
      flowType: 'CHATBOT_AUTO',
      customerPhone: phone,
      customerName,
      customerInput,
      bubbleCorrelationId: correlationId,
      reasoning: 'Rekomendasikan Pijat Pulih Ceria + Sinar Moksa untuk grok-grok',
      finalReply: 'Halo Bunda! Untuk keluhan si kecil yang grok-grok, kami rekomendasikan Pijat Pulih Ceria + Sinar Moksa ya Bunda 😊',
      modelUsed: 'MiniMax-M2.7-highspeed',
      durationMs: 850,
      status: 'SUCCESS',
    });

    // Step 4: AI Verifier QC
    recordLlmExecution({
      timestamp: new Date(now + 300).toISOString(),
      flowType: 'AI_VERIFIER',
      customerPhone: phone,
      customerName,
      customerInput: `[DRAFT QC] "Halo Bunda! Untuk keluhan..." (User: "${customerInput}")`,
      bubbleCorrelationId: correlationId,
      reasoning: 'QC PASSED: Sinar Moksa tepat untuk grok-grok, emoji senyum ada.',
      rawReasoning: '{"is_valid": true, "reasoning": "QC PASSED"}',
      finalReply: 'Halo Bunda! Untuk keluhan si kecil yang grok-grok, kami rekomendasikan Pijat Pulih Ceria + Sinar Moksa ya Bunda 😊',
      modelUsed: 'MiniMax-M2.7-highspeed',
      durationMs: 400,
      status: 'SUCCESS',
    });

 // Fetch grouped logs
 const grouped = getGroupedLlmExecutionLogs();
 expect(grouped.length).toBe(1);

 const customerGroup = grouped[0];
 expect(customerGroup.customerPhone).toBe(phone);
 expect(customerGroup.customerName).toBe(customerName);
 expect(customerGroup.totalBubbles).toBe(1);
 expect(customerGroup.totalAiCalls).toBe(4);

 const bubble = customerGroup.bubbles[0];
 expect(bubble.correlationId).toBe(correlationId);
 expect(bubble.customerInput).toBe(customerInput);
 expect(bubble.aiCalls.length).toBe(4);

 expect(bubble.aiCalls[0].flowType).toBe('NLU_CLASSIFICATION');
 expect(bubble.aiCalls[1].flowType).toBe('AI_ROUTER');
 expect(bubble.aiCalls[2].flowType).toBe('CHATBOT_AUTO');
 expect(bubble.aiCalls[3].flowType).toBe('AI_VERIFIER');
    expect(bubble.aiCalls[3].rawReasoning).toContain('"is_valid": true');
  });

  it('should auto-cluster NLU, Router with [State: ...], Generator, and Verifier with [DRAFT QC] into a single bubble even without bubbleCorrelationId', () => {
    const phone = '6281234567890';
    const rawText = 'Halo min, mau reservasi baby spa besok sore jam 3 ya';
    const now = Date.now();

    // 1. NLU
    recordLlmExecution({
      timestamp: new Date(now).toISOString(),
      flowType: 'NLU_CLASSIFICATION',
      customerPhone: phone,
      customerInput: rawText,
      reasoning: 'Intent: reservation_request',
      finalReply: 'INTENT: reservation_request',
      status: 'SUCCESS',
    });

    // 2. AI Router (with [State: INITIAL] prefix)
    recordLlmExecution({
      timestamp: new Date(now + 200).toISOString(),
      flowType: 'AI_ROUTER',
      customerPhone: phone,
      customerInput: `[State: INITIAL] "${rawText}"`,
      reasoning: 'Rute ke handling reservasi',
      finalReply: 'ROUTE: CHATBOT_AUTO',
      status: 'SUCCESS',
    });

    // 3. Generator
    recordLlmExecution({
      timestamp: new Date(now + 600).toISOString(),
      flowType: 'CHATBOT_AUTO',
      customerPhone: phone,
      customerInput: rawText,
      reasoning: 'Draft penawaran slot jam 3',
      finalReply: 'Halo Bunda! Baik untuk reservasi baby spa besok jam 3 sore tersedia ya Bunda 😊',
      status: 'SUCCESS',
    });

    // 4. Verifier (with [DRAFT QC] prefix)
    recordLlmExecution({
      timestamp: new Date(now + 900).toISOString(),
      flowType: 'AI_VERIFIER',
      customerPhone: phone,
      customerInput: `[DRAFT QC] "Halo Bunda! Baik untuk reservasi..." (User: "${rawText}")`,
      reasoning: 'QC PASSED: Aman',
      finalReply: 'Halo Bunda! Baik untuk reservasi baby spa besok jam 3 sore tersedia ya Bunda 😊',
      status: 'SUCCESS',
    });

    const grouped = getGroupedLlmExecutionLogs();
    expect(grouped.length).toBe(1);
    expect(grouped[0].customerPhone).toBe(phone);
    expect(grouped[0].totalBubbles).toBe(1);
    expect(grouped[0].bubbles[0].customerInput).toBe(rawText);
    expect(grouped[0].bubbles[0].aiCalls.length).toBe(4);
    expect(grouped[0].bubbles[0].aiCalls.map((c) => c.flowType)).toEqual([
      'NLU_CLASSIFICATION',
      'AI_ROUTER',
      'CHATBOT_AUTO',
      'AI_VERIFIER',
    ]);
  });

  it('should track PHRASING and FALLBACK statuses accurately under correlation ID', () => {
    const correlationId = 'corr_phrasing_fallback_002';
    const phone = '628991234567';
    const rawText = 'Ongkir ke Rungkut berapa ya?';
    const now = Date.now();

    // 1. NLU (Low Confidence Fallback)
    recordLlmExecution({
      timestamp: new Date(now).toISOString(),
      flowType: 'NLU_CLASSIFICATION',
      customerPhone: phone,
      customerInput: rawText,
      bubbleCorrelationId: correlationId,
      reasoning: '[LOW CONFIDENCE FALLBACK] Confidence 0.3 < 0.6',
      finalReply: 'Intents: [faq_question] [FALLBACK]',
      confidenceScore: 0.3,
      status: 'FALLBACK',
    });

    // 2. Phrasing Service
    recordLlmExecution({
      timestamp: new Date(now + 500).toISOString(),
      flowType: 'PHRASING',
      customerPhone: phone,
      customerInput: '[Intent: ongkir_info] Template: "Untuk ke Rungkut ongkirnya..."',
      bubbleCorrelationId: correlationId,
      reasoning: 'Variasi natural untuk intent: ongkir_info',
      groundTruthUsed: { kecamatan: 'Rungkut', ongkir: 15000 },
      finalReply: 'Untuk Bunda di Rungkut, ongkir homecare kami hanya Rp 15.000 ya Bunda 🌸',
      status: 'SUCCESS',
    });

    const grouped = getGroupedLlmExecutionLogs();
    expect(grouped.length).toBe(1);
    const bubble = grouped[0].bubbles[0];
    expect(bubble.correlationId).toBe(correlationId);
    expect(bubble.aiCalls.length).toBe(2);
    expect(bubble.aiCalls[0].status).toBe('FALLBACK');
    expect(bubble.aiCalls[1].status).toBe('SUCCESS');
    expect(bubble.aiCalls[1].flowType).toBe('PHRASING');
    expect(bubble.aiCalls[1].groundTruthUsed).toEqual({ kecamatan: 'Rungkut', ongkir: 15000 });
  });
});

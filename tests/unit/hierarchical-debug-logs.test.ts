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
});

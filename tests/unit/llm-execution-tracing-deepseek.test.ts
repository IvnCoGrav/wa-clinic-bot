import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordLlmExecution,
  getLlmExecutionLogs,
  getGroupedLlmExecutionLogs,
  clearLlmExecutionLogs,
} from '../../src/utils/llm-execution-logger';
import {
  extractReasoningAndCleanContent,
  extractUsageTelemetry,
  reportTurnError,
  type TurnState,
} from '../../src/v3/agent/pipeline/generation-stage';
import { calculateLlmCost } from '../../src/utils/cost-calculator';

describe('Fase 1 — LlmExecutionRecord: errorMessage / cachedPromptTokens / reasoningTokens', () => {
  beforeEach(() => {
    clearLlmExecutionLogs();
  });

  it('menyimpan errorMessage, cachedPromptTokens, dan reasoningTokens di buffer', () => {
    recordLlmExecution({
      flowType: 'V3_ROUTING',
      customerPhone: '628111222333',
      customerInput: 'halo',
      finalReply: '',
      status: 'ERROR',
      errorMessage: 'Request failed with status code 401 (invalid key)',
      promptTokens: 1200,
      completionTokens: 0,
      cachedPromptTokens: 900,
      reasoningTokens: 0,
    });

    const logs = getLlmExecutionLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].errorMessage).toBe('Request failed with status code 401 (invalid key)');
    expect(logs[0].cachedPromptTokens).toBe(900);
    expect(logs[0].status).toBe('ERROR');
  });

  it('tidak mengisi field opsional bila tidak diberikan (backward-compatible)', () => {
    recordLlmExecution({
      flowType: 'V3_GENERATION',
      customerInput: 'test',
      finalReply: 'ok',
      status: 'SUCCESS',
    });
    const logs = getLlmExecutionLogs();
    expect(logs[0].errorMessage).toBeUndefined();
    expect(logs[0].cachedPromptTokens).toBeUndefined();
    expect(logs[0].reasoningTokens).toBeUndefined();
  });
});

describe('Fase 2 — extractReasoningAndCleanContent (CoT universal, adversarial)', () => {
  it('mengambil reasoning_content native tanpa mengubah content', () => {
    const { reasoning, cleanContent } = extractReasoningAndCleanContent({
      reasoning_content: '  Pikirkan dulu langkah A  ',
      content: 'Halo Bunda!',
    });
    expect(reasoning).toBe('Pikirkan dulu langkah A');
    expect(cleanContent).toBe('Halo Bunda!');
  });

  it('memisahkan tag <think>...</think> dari content', () => {
    const { reasoning, cleanContent } = extractReasoningAndCleanContent({
      content: '<think>user minta harga pijat</think>Baik Bunda, ini informasinya.',
    });
    expect(reasoning).toBe('user minta harga pijat');
    expect(cleanContent).toBe('Baik Bunda, ini informasinya.');
  });

  it('menghapus SEMUA tag <think> (multi-blok) tanpa menyisakan artefak', () => {
    const { cleanContent } = extractReasoningAndCleanContent({
      content: '<think>a</think>Hasil A<think>b</think> Hasil B',
    });
    expect(cleanContent).not.toContain('<think>');
    expect(cleanContent).not.toContain('</think>');
    expect(cleanContent).toBe('Hasil A Hasil B');
  });

  it('tidak menimpa reasoning_content dengan tag <think> bila keduanya ada', () => {
    const { reasoning, cleanContent } = extractReasoningAndCleanContent({
      reasoning_content: 'native reasoning',
      content: '<think>inline reasoning</think>jawaban',
    });
    expect(reasoning).toBe('native reasoning');
    expect(cleanContent).toBe('jawaban');
  });

  it('tahan terhadap content null / tag tidak tertutup / casing berbeda', () => {
    expect(extractReasoningAndCleanContent({ content: null }).cleanContent).toBe('');
    expect(extractReasoningAndCleanContent({}).reasoning).toBeNull();

    const unclosed = extractReasoningAndCleanContent({ content: '<think>belum ditutup jawaban' });
    expect(unclosed.reasoning).toBeNull();
    expect(unclosed.cleanContent).toBe('<think>belum ditutup jawaban');

    const upper = extractReasoningAndCleanContent({ content: '<THINK>x</THINK>halo' });
    expect(upper.reasoning).toBe('x');
    expect(upper.cleanContent).toBe('halo');
  });
});

describe('Fase 3 — extractUsageTelemetry (dual shape cache & reasoning tokens)', () => {
  it('membaca prompt_cache_hit_tokens native DeepSeek', () => {
    const t = extractUsageTelemetry({
      prompt_tokens: 2000,
      completion_tokens: 300,
      prompt_cache_hit_tokens: 1500,
      completion_tokens_details: { reasoning_tokens: 120 },
    });
    expect(t.cachedPromptTokens).toBe(1500);
    expect(t.reasoningTokens).toBe(120);
  });

  it('membaca prompt_tokens_details.cached_tokens gaya OpenAI-compatible (proxy SumoPod)', () => {
    const t = extractUsageTelemetry({
      prompt_tokens: 2000,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 1024 },
    });
    expect(t.cachedPromptTokens).toBe(1024);
  });

  it('mengembalikan undefined untuk cache/reasoning ketika 0 atau usage kosong', () => {
    expect(extractUsageTelemetry(undefined).cachedPromptTokens).toBeUndefined();
    const t = extractUsageTelemetry({ prompt_tokens: 10, completion_tokens: 5 });
    expect(t.cachedPromptTokens).toBeUndefined();
    expect(t.reasoningTokens).toBeUndefined();
    expect(t.promptTokens).toBe(10);
  });

  it('hitungan biaya DeepSeek mencerminkan diskon cache-hit', () => {
    // Kunci waktu ke off-peak (20:00 UTC) agar tarif deterministik,
    // lepas dari jam saat test dijalankan (peak-hour bernilai dinamis).
    const offPeak = new Date('2026-01-01T20:00:00Z');
    const withoutCache = calculateLlmCost('deepseek-v4-flash', 1000, 0, 0, offPeak).totalCostIdr;
    const withCache = calculateLlmCost('deepseek-v4-flash', 1000, 0, 1000, offPeak).totalCostIdr;
    // off-peak: miss $0.22/1M, hit $0.007/1M → rasio hit/miss ≪ 1
    expect(withCache).toBeLessThan(withoutCache);
    expect(withCache / withoutCache).toBeCloseTo(0.007 / 0.22, 4);
  });
});

describe('Fase 4 (kontrak filter) — Direct Reply single-call & multi-call grouping', () => {
  beforeEach(() => {
    clearLlmExecutionLogs();
  });

  it('mengelompokkan Direct Reply 1-call dengan stabil di bubble yang sama', () => {
    const correlationId = 'corr_direct_1';
    recordLlmExecution({
      flowType: 'V3_ROUTING',
      customerPhone: '628555000111',
      customerInput: 'halo kak',
      bubbleCorrelationId: correlationId,
      finalReply: 'Halo Bunda! Ada yang bisa dibantu?',
      reasoning: 'sapaan pembuka',
      status: 'SUCCESS',
      toolsCalled: [],
      callSequence: 1,
    });

    const grouped = getGroupedLlmExecutionLogs();
    expect(grouped.length).toBe(1);
    expect(grouped[0].totalBubbles).toBe(1);
    expect(grouped[0].bubbles[0].aiCalls.length).toBe(1);
    expect(grouped[0].bubbles[0].aiCalls[0].flowType).toBe('V3_ROUTING');
    expect(grouped[0].bubbles[0].aiCalls[0].toolsCalled).toEqual([]);
  });

  it('mengelompokkan multi-call Routing -> Generation di bubble yang sama', () => {
    const correlationId = 'corr_multi_2';
    recordLlmExecution({
      flowType: 'V3_ROUTING',
      customerPhone: '628555000222',
      customerInput: 'berapa ongkir ke Rungkut?',
      bubbleCorrelationId: correlationId,
      finalReply: '[Memanggil Tool: calculate_delivery]',
      status: 'SUCCESS',
      toolsCalled: [{ name: 'calculate_delivery', args: { location: 'Rungkut' } }],
      callSequence: 1,
    });
    recordLlmExecution({
      flowType: 'V3_GENERATION',
      customerPhone: '628555000222',
      customerInput: 'berapa ongkir ke Rungkut?',
      bubbleCorrelationId: correlationId,
      finalReply: 'Ongkir ke Rungkut Rp 15.000 ya Bunda 🌸',
      status: 'SUCCESS',
      callSequence: 2,
    });

    const grouped = getGroupedLlmExecutionLogs();
    expect(grouped[0].bubbles[0].aiCalls.map((c) => c.flowType)).toEqual(['V3_ROUTING', 'V3_GENERATION']);
  });

  it('filter V3_GENERATION ikut menyertakan Direct Reply (V3_ROUTING tanpa tool) namun bukan tool-call', () => {
    const phone = '628555000333';
    recordLlmExecution({
      flowType: 'V3_ROUTING',
      customerPhone: phone,
      customerInput: 'terima kasih',
      finalReply: 'Sama-sama Bunda 😊',
      status: 'SUCCESS',
      toolsCalled: [],
    });
    recordLlmExecution({
      flowType: 'V3_ROUTING',
      customerPhone: phone,
      customerInput: 'lokasi saya rungkut',
      finalReply: '[Memanggil Tool: calculate_delivery]',
      status: 'SUCCESS',
      toolsCalled: [{ name: 'calculate_delivery', args: {} }],
    });

    const filtered = getLlmExecutionLogs(100, 'V3_GENERATION');
    expect(filtered.length).toBe(1);
    expect(filtered[0].finalReply).toBe('Sama-sama Bunda 😊');
  });
});

describe('Fase 1/2 — reportTurnError merekam pesan error teknis konkret', () => {
  beforeEach(() => {
    clearLlmExecutionLogs();
  });

  const makeTurn = (): TurnState => ({
    tenantId: 'default-tenant',
    phone: '628999000111',
    conversationId: 'conv_err_1',
    incomingText: 'halo',
    selectedModel: 'deepseek-v4-flash',
    baseUrl: 'https://ai.sumopod.com/v1',
    apiKey: 'x',
    turnStartedAt: Date.now() - 500,
    correlationId: 'corr_err_1',
    totalTokens: { prompt: 10, completion: 5, total: 15 },
    currentSystemPrompt: 'sys',
    messages: [],
    executedTools: [],
    retrievedChunks: [],
    fewShotExemplars: [],
    reasoning: null,
    perCallLogged: false,
  });

  it('mengekstrak error.message dari Error object', async () => {
    await reportTurnError(makeTurn(), { genderGreeting: 'Bunda' } as any, new Error('boom timeout'), 'halo');
    const logs = getLlmExecutionLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('ERROR');
    expect(logs[0].errorMessage).toBe('boom timeout');
  });

  it('mengekstrak error API dari response.data.error.message (axios 401)', async () => {
    const axiosErr: any = new Error('Request failed with status code 401');
    axiosErr.response = { status: 401, data: { error: { message: 'invalid api key' } } };
    await reportTurnError(makeTurn(), { genderGreeting: 'Bunda' } as any, axiosErr, 'halo');
    const logs = getLlmExecutionLogs();
    expect(logs[0].errorMessage).toBe('invalid api key');
  });

  it('tahan terhadap error tanpa pesan (fallback generik)', async () => {
    await reportTurnError(makeTurn(), { genderGreeting: 'Bunda' } as any, {}, 'halo');
    const logs = getLlmExecutionLogs();
    expect(logs[0].status).toBe('ERROR');
    expect(logs[0].errorMessage).toBe('Unknown LLM execution error');
  });
});

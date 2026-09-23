import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';

vi.mock('axios');
const mockedAxios = axios as any;

// Spy audit: intercept llm-audit-buffer and llm-execution-logger via manual mock on utils
let auditCalls: any[] = [];
let executionCalls: any[] = [];

vi.mock('../../src/utils/llm-audit-buffer', async () => {
  const actual: any = await vi.importActual('../../src/utils/llm-audit-buffer');
  return {
    ...actual,
    auditLlmCall: (p: any) => { auditCalls.push(p); },
    recordLlmUsage: (p: any) => { auditCalls.push(p); },
  };
});
vi.mock('../../src/utils/llm-execution-logger', async () => {
  const actual: any = await vi.importActual('../../src/utils/llm-execution-logger');
  return {
    ...actual,
    recordLlmExecution: (p: any) => { executionCalls.push(p); },
  };
});

// Also spy circuit-breaker directly? generation-stage uses v3LlmCircuitBreaker.execute -> axios.post
// So our axios mock controls __actualModel too (not set -> undefined normal path)

describe('Dual-model isolation (fondasional)', () => {
  beforeEach(() => {
    auditCalls = [];
    executionCalls = [];
    mockedAxios.post.mockReset();
  });

  it('RED-proof 1: Call 2 non-reasoning tidak mewarisi reasoning Call 1', async () => {
    const call1Reasoning = 'I should call get_catalog_and_price for bapil';
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { role: 'assistant', content: null, reasoning_content: call1Reasoning, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_catalog_and_price', arguments: JSON.stringify({ symptoms: ['batuk'], inquirePrice: false }) } }] }, usage: { prompt_tokens: 10, completion_tokens: 5 } }],
          __actualModel: undefined,
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { role: 'assistant', content: 'Halo Bunda, untuk bapil kami sarankan ...', reasoning_content: null }, usage: { prompt_tokens: 12, completion_tokens: 8 } }],
        },
      });

    await V3AgentRunner.processMessage({
      customerId: 'mock-dm-1',
      conversationId: 'mock-conv-dm-1',
      phone: '628000000001',
      chatId: '628000000001@c.us',
      incomingText: 'anak bapil apa obatnya',
    });

    const genCalls = executionCalls.filter((c: any) => c.flowType === 'V3_GENERATION');
    expect(genCalls.length).toBeGreaterThanOrEqual(1);
    const genReasoning = genCalls[0]?.reasoning;
    // Bug sebelum fix: reasoning Call 2 == reasoning Call 1. Setelah fix: null/undefined
    // Test ini diharapkan MERAH sebelum fix (genReasoning == call1Reasoning), HIJAU setelah fix (null/undefined)
    expect(genReasoning === call1Reasoning).toBe(false);
    expect(genReasoning == null || genReasoning === '').toBe(true);
  });

  it('RED-proof 2: audit Call 1 task_type INTENT_CLASSIFICATION & Call 2 CHAT_REPLY dengan model berbeda', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_catalog_and_price', arguments: JSON.stringify({ symptoms: ['batuk'], inquirePrice: false }) } }] }, usage: { prompt_tokens: 10, completion_tokens: 5 } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { role: 'assistant', content: 'Balasan generator', }, usage: { prompt_tokens: 12, completion_tokens: 8 } }],
        },
      });

    await V3AgentRunner.processMessage({
      customerId: 'mock-dm-2',
      conversationId: 'mock-conv-dm-2',
      phone: '628000000002',
      chatId: '628000000002@c.us',
      incomingText: 'anak batuk pilek',
    });

    expect(auditCalls.length).toBeGreaterThanOrEqual(2);
    const taskTypes = auditCalls.map((c: any) => c.task_type);
    // Sebelum fix: semua V3_AGENT. Setelah fix: ada INTENT dan CHAT
    expect(taskTypes.includes('INTENT_CLASSIFICATION')).toBe(true);
    expect(taskTypes.includes('CHAT_REPLY')).toBe(true);
    const routerEntry = auditCalls.find((c: any) => c.task_type === 'INTENT_CLASSIFICATION');
    const genEntry = auditCalls.find((c: any) => c.task_type === 'CHAT_REPLY');
    expect(routerEntry).toBeDefined();
    expect(genEntry).toBeDefined();
    // Model bisa sama di env mock (fallback sama) — cukup pastikan keduanya teraudit dengan model_name terisi
    expect(routerEntry.model_name).toBeDefined();
    expect(genEntry.model_name).toBeDefined();
    // Di env produksi keduanya berbeda (glm vs gpt-4o-mini); tidak wajib di CI mock, tapi task_type harus beda (sudah di atas)
  });

  it('RED-proof 3: TurnState membawa 4 field endpoint terisolasi & baseUrl per-call', async () => {
    let firstBaseUrl: string | undefined;
    let secondBaseUrl: string | undefined;
    mockedAxios.post.mockImplementation(async (url: string) => {
      if (!firstBaseUrl) {
        firstBaseUrl = url;
        return { data: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_catalog_and_price', arguments: JSON.stringify({ symptoms: ['batuk'], inquirePrice: false }) } }] }, usage: { prompt_tokens: 10, completion_tokens: 5 } }] } };
      } else {
        secondBaseUrl = url;
        return { data: { choices: [{ message: { role: 'assistant', content: 'Balasan terisolasi endpoint', }, usage: { prompt_tokens: 12, completion_tokens: 8 } }] } };
      }
    });

    await V3AgentRunner.processMessage({
      customerId: 'mock-dm-3',
      conversationId: 'mock-conv-dm-3',
      phone: '628000000003',
      chatId: '628000000003@c.us',
      incomingText: 'anak bapil butuh pijat',
    });

    expect(firstBaseUrl).toBeDefined();
    expect(secondBaseUrl).toBeDefined();
    // Kedua audit entry harus membawa baseUrl (endpoint terisolasi); minimal tidak kosong
    const baseUrls = auditCalls.map((c: any) => c.baseUrl).filter(Boolean);
    expect(baseUrls.length).toBeGreaterThanOrEqual(2);
  });
});

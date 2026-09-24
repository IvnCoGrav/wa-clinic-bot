import { describe, it, expect } from 'vitest';
import {
  createTelemetry,
  resolveMaxTokensForTask,
  TurnState,
} from '../../../src/v3/agent/pipeline/generation-stage';
import { calculateLlmCost } from '../../../src/utils/cost-calculator';

function baseTurn(): TurnState {
  return {
    tenantId: 'default-tenant',
    phone: '6280000000000',
    conversationId: 'conv-test',
    incomingText: 'halo',
    selectedModel: 'gpt-4o-mini',
    baseUrl: '',
    apiKey: '',
    turnStartedAt: Date.now(),
    correlationId: 'corr-test',
    totalTokens: { prompt: 0, completion: 0, total: 0 },
    currentSystemPrompt: '',
    messages: [],
    executedTools: [],
    retrievedChunks: [],
    fewShotExemplars: [],
    reasoning: null,
    perCallLogged: false,
  };
}

describe('E1 resolveMaxTokensForTask', () => {
  it('mengembalikan batas positif dari registry untuk kedua task', () => {
    expect(resolveMaxTokensForTask('INTENT_CLASSIFICATION', 'default-tenant')).toBeGreaterThan(0);
    expect(resolveMaxTokensForTask('CHAT_REPLY', 'default-tenant')).toBeGreaterThan(0);
  });
});

describe('E3 cachedPrompt plumbing', () => {
  it('addUsage mengakumulasi cache-hit dan finishCost memakai tarif diskon', async () => {
    const turn = baseTurn();
    const tel = createTelemetry(turn);
    tel.addUsage({ prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 800 });
    expect(turn.totalTokens.cachedPrompt).toBe(800);
    const cost = await tel.finishCost();
    const expected = calculateLlmCost('gpt-4o-mini', 1000, 100, 800, { baseUrl: '' }).totalCostIdr;
    expect(cost).toBe(expected);
    const noCache = calculateLlmCost('gpt-4o-mini', 1000, 100, 0, { baseUrl: '' }).totalCostIdr;
    expect(cost).toBeLessThan(noCache);
  });

  it('mendukung varian provider prompt_tokens_details.cached_tokens', async () => {
    const turn = baseTurn();
    const tel = createTelemetry(turn);
    tel.addUsage({ prompt_tokens: 500, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 200 } });
    expect(turn.totalTokens.cachedPrompt).toBe(200);
  });

  it('tanpa cache-hit perilaku sama seperti sebelumnya (nol)', async () => {
    const turn = baseTurn();
    const tel = createTelemetry(turn);
    tel.addUsage({ prompt_tokens: 500, completion_tokens: 50 });
    expect(turn.totalTokens.cachedPrompt).toBe(0);
    const cost = await tel.finishCost();
    expect(cost).toBe(calculateLlmCost('gpt-4o-mini', 500, 50, 0, { baseUrl: '' }).totalCostIdr);
  });
});

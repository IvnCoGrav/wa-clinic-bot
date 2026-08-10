import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { callChatCompletionsWithFallback, getFallbackChain } from '../../src/integrations/llm/model-fallback';

// ============================================================================
// Rantai fallback LLM: primary → chain dalam provider SAMA (SumoPod) →
// penyelamat terakhir provider EKSTERNAL (DeepSeek Direct) → throw (breaker/regex).
// Semua konfigurasi env-driven (AI_MODEL_FALLBACK_CHAIN, LLM_FALLBACK_BASE_URL),
// tidak ada hardcode nama model/provider di kode.
// ============================================================================

const CLEANUP_ENV = ['AI_MODEL_FALLBACK_CHAIN', 'LLM_FALLBACK_BASE_URL', 'LLM_FALLBACK_API_KEY', 'AI_MODEL_FALLBACK'];

function cleanup() {
  for (const k of CLEANUP_ENV) delete process.env[k];
}

const okPayload = (model: string) => ({
  data: { choices: [{ message: { content: `ok-${model}` } }] },
});

function setupChainEnv() {
  process.env.AI_MODEL_FALLBACK_CHAIN = 'deepseek-v4-flash,qwen3.7-flash-2026-07-15';
  process.env.LLM_FALLBACK_BASE_URL = 'https://api.deepseek.com';
  process.env.LLM_FALLBACK_API_KEY = 'sk-external-test';
  process.env.AI_MODEL_FALLBACK = 'deepseek-v4-flash';
}

describe('getFallbackChain', () => {
  afterEach(cleanup);

  it('parse AI_MODEL_FALLBACK_CHAIN menjadi list model (trim + skip kosong)', () => {
    process.env.AI_MODEL_FALLBACK_CHAIN = ' deepseek-v4-flash , qwen3.7-flash-2026-07-15 , ';
    expect(getFallbackChain()).toEqual(['deepseek-v4-flash', 'qwen3.7-flash-2026-07-15']);
  });

  it('env kosong → rantai kosong (perilaku legacy fallback tunggal)', () => {
    expect(getFallbackChain()).toEqual([]);
  });
});

describe('callChatCompletionsWithFallback — rantai 4-lapis', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('primary gagal → chain deepseek-v4-flash via provider SAMA (SumoPod) sukses', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockResolvedValueOnce(okPayload('deepseek-v4-flash'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      payload: { messages: [] },
    });

    expect(res.usedFallback).toBe(true);
    expect(res.model).toBe('deepseek-v4-flash');
    expect(res.baseUrl).toBe('https://ai.sumopod.com/v1');
    expect(postSpy).toHaveBeenCalledTimes(2);
    const chainCall = postSpy.mock.calls[1];
    expect(String(chainCall[0])).toBe('https://ai.sumopod.com/v1/chat/completions');
    expect((chainCall[2] as any).headers.Authorization).toBe('Bearer sk-main');
  });

  it('primary + deepseek gagal → qwen3.7-flash sukses (masih provider sama)', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(okPayload('qwen3.7-flash-2026-07-15'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      payload: { messages: [] },
    });

    expect(res.model).toBe('qwen3.7-flash-2026-07-15');
    expect(res.usedFallback).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(3);
  });

  it('seluruh rantai SumoPod gagal → penyelamat terakhir DeepSeek EKSTERNAL (baseUrl+key beda)', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(okPayload('deepseek-v4-flash'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      payload: { messages: [] },
    });

    expect(res.model).toBe('deepseek-v4-flash');
    expect(res.baseUrl).toBe('https://api.deepseek.com');
    expect(postSpy).toHaveBeenCalledTimes(4);
    const externalCall = postSpy.mock.calls[3];
    expect(String(externalCall[0])).toBe('https://api.deepseek.com/chat/completions');
    expect((externalCall[2] as any).headers.Authorization).toBe('Bearer sk-external-test');
  });

  it('semua 4 lapis gagal → throw (upstream: breaker → regex fallback)', async () => {
    setupChainEnv();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('timeout of 12000ms exceeded'));
    await expect(
      callChatCompletionsWithFallback({
        baseUrl: 'https://ai.sumopod.com/v1',
        apiKey: 'sk-main',
        model: 'MiniMax-M2.7-highspeed',
        fallbackModel: 'deepseek-v4-flash',
        timeoutMs: 12000,
        payload: { messages: [] },
      })
    ).rejects.toThrow('timeout');
    expect(axios.post).toHaveBeenCalledTimes(4);
  });
});
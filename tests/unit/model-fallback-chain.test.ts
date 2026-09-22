import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { callChatCompletionsWithFallback, getFallbackChain, resolveFallbackTiers } from '../../src/integrations/llm/model-fallback';

// ============================================================================
// Fallback LLM 3-TIER (katalog live 2026-09-21):
//   Tier 1 SumoPod utama (glm-5.3-flash) → Tier 2 Kenari cadangan
//   (deepseek-v4-1-flash) → Tier 3 DeepSeek Direct API langsung (deepseek-chat).
// Chain internal dalam provider yang sama tetap didukung via AI_MODEL_FALLBACK_CHAIN.
// ============================================================================

const CLEANUP_ENV = [
  'AI_MODEL_FALLBACK_CHAIN',
  'LLM_FALLBACK_BASE_URL',
  'LLM_FALLBACK_API_KEY',
  'AI_MODEL_FALLBACK',
  'KENARI_BASE_URL',
  'KENARI_API_KEY',
  'KENARI_DEFAULT_MODEL',
  'SUMOPOD_BASE_URL',
  'SUMOPOD_API_KEY',
  'SUMOPOD_DEFAULT_MODEL',
  'OPENAI_BASE_URL',
];

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
  process.env.AI_MODEL_FALLBACK = 'deepseek-chat';
  // Tier 2 Kenari cadangan aktif.
  process.env.KENARI_BASE_URL = 'https://kenari.id/v1';
  process.env.KENARI_API_KEY = 'sk-kenari-tier2';
  process.env.KENARI_DEFAULT_MODEL = 'deepseek-v4-1-flash';
  delete process.env.OPENAI_BASE_URL;
}

describe('getFallbackChain', () => {
  afterEach(cleanup);

  it('parse AI_MODEL_FALLBACK_CHAIN menjadi list model (trim + skip kosong)', () => {
    process.env.AI_MODEL_FALLBACK_CHAIN = ' deepseek-v4-flash , qwen3.7-flash-2026-07-15 , ';
    expect(getFallbackChain()).toEqual(['deepseek-v4-flash', 'qwen3.7-flash-2026-07-15']);
  });

  it('env kosong → DEFAULT_FALLBACK_CHAIN = model primer SumoPod utama', () => {
    expect(getFallbackChain()).toEqual(['glm-5.3-flash']);
  });
});

describe('resolveFallbackTiers — resolusi tier provider dari env', () => {
  afterEach(cleanup);

  it('Kenari + DeepSeek Direct terkonfigurasi → 2 tier berurutan', () => {
    process.env.KENARI_BASE_URL = 'https://kenari.id/v1';
    process.env.KENARI_API_KEY = 'sk-kenari';
    process.env.KENARI_DEFAULT_MODEL = 'deepseek-v4-1-flash';
    process.env.LLM_FALLBACK_BASE_URL = 'https://api.deepseek.com';
    process.env.LLM_FALLBACK_API_KEY = 'sk-direct';
    process.env.AI_MODEL_FALLBACK = 'deepseek-chat';

    const tiers = resolveFallbackTiers();
    expect(tiers.map((t) => t.name)).toEqual(['Kenari', 'DeepSeek Direct']);
    expect(tiers[0].model).toBe('deepseek-v4-1-flash');
    expect(tiers[1].model).toBe('deepseek-chat');
  });

  it('tanpa kredensial → tidak ada tier (guard skip, cegah 400)', () => {
    process.env.OPENAI_BASE_URL = 'https://kenari.id/v1';
    expect(resolveFallbackTiers()).toEqual([]);
  });

  it('hanya DeepSeek Direct terkonfigurasi → 1 tier', () => {
    process.env.LLM_FALLBACK_BASE_URL = 'https://api.deepseek.com';
    process.env.LLM_FALLBACK_API_KEY = 'sk-direct';
    const tiers = resolveFallbackTiers();
    expect(tiers.map((t) => t.name)).toEqual(['DeepSeek Direct']);
  });
});

describe('callChatCompletionsWithFallback — rantai 4-lapis', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('primary gagal → transient retry (2×) → chain deepseek-v4-flash via provider SAMA (SumoPod) sukses', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    // Transient retry: error timeout di-retry (2× default) sebelum pindah ke chain.
    postSpy
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockResolvedValueOnce(okPayload('deepseek-v4-flash'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 2 },
      payload: { messages: [] },
    });

    expect(res.usedFallback).toBe(true);
    expect(res.model).toBe('deepseek-v4-flash');
    expect(res.baseUrl).toBe('https://ai.sumopod.com/v1');
    // primary: 1 initial + 2 transient retry = 3, then chain deepseek = 1
    expect(postSpy).toHaveBeenCalledTimes(4);
    const chainCall = postSpy.mock.calls[3];
    expect(String(chainCall[0])).toBe('https://ai.sumopod.com/v1/chat/completions');
    expect((chainCall[2] as any).headers.Authorization).toBe('Bearer sk-main');
  });

  it('transient error (429) pulih setelah retry → kembali ke model primary tanpa ganti model', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce({ response: { status: 429, data: {} }, message: 'Rate limit exceeded' })
      .mockResolvedValueOnce(okPayload('MiniMax-M2.7-highspeed'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 2 },
      payload: { messages: [] },
    });

    expect(res.model).toBe('MiniMax-M2.7-highspeed');
    expect(res.usedFallback).toBe(true); // recovery via retry
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('transientRetry dinonaktifkan ({ maxRetries: 0 }) → langsung masuk chain (perilaku lama)', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(okPayload('deepseek-v4-flash'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 0 },
      payload: { messages: [] },
    });

    expect(res.model).toBe('deepseek-v4-flash');
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('primary + deepseek gagal → qwen3.7-flash sukses (masih provider sama)', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    // primary: 3× (1 + 2 retry transient) + deepseek: 1× + qwen: 1× sukses = 5 calls.
    for (let i = 0; i < 3; i++) postSpy.mockRejectedValueOnce(new Error('timeout'));
    postSpy.mockRejectedValueOnce(new Error('timeout')); // deepseek
    postSpy.mockResolvedValueOnce(okPayload('qwen3.7-flash-2026-07-15'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 2 },
      payload: { messages: [] },
    });

    expect(res.model).toBe('qwen3.7-flash-2026-07-15');
    expect(res.usedFallback).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(5);
  });

  it('seluruh rantai SumoPod gagal → Tier Kenari gagal → penyelamat terakhir DeepSeek Direct API langsung', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    // primary: 3× (1 + 2 retry) + chain deepseek: 1× + chain qwen: 1× + Tier Kenari: 1× = 6 gagal → Direct sukses.
    for (let i = 0; i < 6; i++) postSpy.mockRejectedValueOnce(new Error('timeout'));
    postSpy.mockResolvedValueOnce(okPayload('deepseek-chat'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 2 },
      payload: { messages: [] },
    });

    expect(res.model).toBe('deepseek-chat');
    expect(res.baseUrl).toBe('https://api.deepseek.com');
    expect(postSpy).toHaveBeenCalledTimes(7);
    const externalCall = postSpy.mock.calls[6];
    expect(String(externalCall[0])).toBe('https://api.deepseek.com/chat/completions');
    expect((externalCall[2] as any).headers.Authorization).toBe('Bearer sk-external-test');
  });

  it('semua lapis gagal → throw (upstream: breaker → regex fallback)', async () => {
    setupChainEnv();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('timeout of 12000ms exceeded'));
    await expect(
      callChatCompletionsWithFallback({
        baseUrl: 'https://ai.sumopod.com/v1',
        apiKey: 'sk-main',
        model: 'MiniMax-M2.7-highspeed',
        fallbackModel: 'deepseek-v4-flash',
        timeoutMs: 12000,
        transientRetry: { maxRetries: 2 },
        payload: { messages: [] },
      })
    ).rejects.toThrow('timeout');
    // 3 primary + 2 chain + 1 Kenari + 1 Direct = 7
    expect(axios.post).toHaveBeenCalledTimes(7);
  });

  it('transientRetry maxRetries=0 → chain + Tier Kenari gagal → Direct sukses', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce(new Error('timeout')) // primary
      .mockRejectedValueOnce(new Error('timeout')) // chain deepseek
      .mockRejectedValueOnce(new Error('timeout')) // chain qwen
      .mockRejectedValueOnce(new Error('timeout')) // Tier Kenari
      .mockResolvedValueOnce(okPayload('deepseek-chat')); // Tier Direct

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 0 },
      payload: { messages: [] },
    });

    expect(res.model).toBe('deepseek-chat');
    expect(res.baseUrl).toBe('https://api.deepseek.com');
    expect(postSpy).toHaveBeenCalledTimes(5);
  });

  it('provider menolak response_format → retry sekali TANPA response_format (bukan gagal total)', async () => {
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce({
        response: {
          status: 400,
          data: { error: { message: 'Unrecognized request argument supplied: response_format' } },
        },
        message: 'Request failed with status code 400',
      })
      .mockResolvedValueOnce(okPayload('primary-ok'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      payload: { messages: [], response_format: { type: 'json_object' } },
    });

    expect(res.usedFallback).toBe(false);
    expect(res.model).toBe('MiniMax-M2.7-highspeed');
    expect(postSpy).toHaveBeenCalledTimes(2);
    const retryBody = (postSpy.mock.calls[1][1] as any);
    expect(retryBody.response_format).toBeUndefined();
    expect(retryBody.messages).toEqual([]);
  });

  it('error NON-response_format → tidak ada retry extra (perilaku 4-lapis tetap utuh)', async () => {
    setupChainEnv();
    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockResolvedValueOnce(okPayload('deepseek-v4-flash'));

    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'MiniMax-M2.7-highspeed',
      fallbackModel: 'deepseek-v4-flash',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 2 },
      payload: { messages: [], response_format: { type: 'json_object' } },
    });

    expect(postSpy).toHaveBeenCalledTimes(4);
  });
});

// ============================================================================
// Skenario 3-TIER sesungguhnya: primary SUMOPOD gagal → Tier 2 Kenari sukses.
// ============================================================================
describe('callChatCompletionsWithFallback — fallback 3-tier (SumoPod → Kenari → DeepSeek Direct)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('SumoPod primary gagal → Tier 2 Kenari (deepseek-v4-1-flash) sukses', async () => {
    // Tanpa chain internal (default hanya primer), tanpa Tier 3 agar fokus Tier 2.
    delete process.env.AI_MODEL_FALLBACK_CHAIN;
    delete process.env.LLM_FALLBACK_BASE_URL;
    delete process.env.LLM_FALLBACK_API_KEY;
    process.env.KENARI_BASE_URL = 'https://kenari.id/v1';
    process.env.KENARI_API_KEY = 'sk-kenari-tier2';
    process.env.KENARI_DEFAULT_MODEL = 'deepseek-v4-1-flash';
    delete process.env.OPENAI_BASE_URL;

    const postSpy = vi.spyOn(axios, 'post');
    postSpy
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockRejectedValueOnce(new Error('timeout of 12000ms exceeded'))
      .mockResolvedValueOnce(okPayload('deepseek-v4-1-flash'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sp-main',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 2 },
      payload: { messages: [] },
    });

    expect(res.usedFallback).toBe(true);
    expect(res.model).toBe('deepseek-v4-1-flash');
    expect(res.baseUrl).toBe('https://kenari.id/v1');
    // primary: 1 + 2 retry = 3, Tier 2 Kenari = 1
    expect(postSpy).toHaveBeenCalledTimes(4);
    const tier2Call = postSpy.mock.calls[3];
    expect(String(tier2Call[0])).toBe('https://kenari.id/v1/chat/completions');
    expect((tier2Call[2] as any).headers.Authorization).toBe('Bearer sk-kenari-tier2');
  });

  it('SumoPod + Kenari gagal → Tier 3 DeepSeek Direct API langsung (deepseek-chat) sukses', async () => {
    delete process.env.AI_MODEL_FALLBACK_CHAIN;
    process.env.KENARI_BASE_URL = 'https://kenari.id/v1';
    process.env.KENARI_API_KEY = 'sk-kenari-tier2';
    process.env.KENARI_DEFAULT_MODEL = 'deepseek-v4-1-flash';
    process.env.LLM_FALLBACK_BASE_URL = 'https://api.deepseek.com';
    process.env.LLM_FALLBACK_API_KEY = 'sk-direct-tier3';
    process.env.AI_MODEL_FALLBACK = 'deepseek-chat';
    delete process.env.OPENAI_BASE_URL;

    const postSpy = vi.spyOn(axios, 'post');
    // primary: 3× + Tier2: 1× gagal → Tier3 sukses.
    for (let i = 0; i < 4; i++) postSpy.mockRejectedValueOnce(new Error('timeout'));
    postSpy.mockResolvedValueOnce(okPayload('deepseek-chat'));

    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sp-main',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 12000,
      transientRetry: { maxRetries: 2 },
      payload: { messages: [] },
    });

    expect(res.model).toBe('deepseek-chat');
    expect(res.baseUrl).toBe('https://api.deepseek.com');
    expect(postSpy).toHaveBeenCalledTimes(5);
    const tier3Call = postSpy.mock.calls[4];
    expect(String(tier3Call[0])).toBe('https://api.deepseek.com/chat/completions');
    expect((tier3Call[2] as any).headers.Authorization).toBe('Bearer sk-direct-tier3');
  });
});

// ============================================================================
// Injeksi reasoning_effort GLM (hemat reasoning tak terlihat; terukur live 2026-09-22:
// prompt router realistis: default 21 dtk/232 chunk vs low 4,7 dtk/11 chunk, output identik).
// ============================================================================
describe('callChatCompletionsWithFallback — injeksi reasoning_effort GLM via SumoPod', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    delete process.env.LLM_REASONING_EFFORT;
  });

  it('model glm via SumoPod otomatis disisipi reasoning_effort=low (default kode)', async () => {
    delete process.env.LLM_REASONING_EFFORT; // hermetik: uji default kode, bukan .env lokal
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload('glm-ok'));
    const res = await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 12000,
      payload: { messages: [] },
    });
    expect(res.usedFallback).toBe(false);
    const sentBody = postSpy.mock.calls[0][1] as any;
    expect(sentBody.model).toBe('glm-5.3-flash');
    expect(sentBody.reasoning_effort).toBe('low');
  });

  it('env LLM_REASONING_EFFORT meng-override default (mis. high untuk deep consult)', async () => {
    process.env.LLM_REASONING_EFFORT = 'high';
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload('glm-ok'));
    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 12000,
      payload: { messages: [] },
    });
    expect((postSpy.mock.calls[0][1] as any).reasoning_effort).toBe('high');
  });

  it('reasoning_effort eksplisit dari pemanggil dihormati (tidak ditimpa injeksi)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload('glm-ok'));
    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 12000,
      payload: { messages: [], reasoning_effort: 'max' },
    });
    expect((postSpy.mock.calls[0][1] as any).reasoning_effort).toBe('max');
  });

  it('model non-GLM tidak disisipi reasoning_effort', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload('ds-ok'));
    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'sk-main',
      model: 'deepseek-v4-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 12000,
      payload: { messages: [] },
    });
    expect((postSpy.mock.calls[0][1] as any).reasoning_effort).toBeUndefined();
  });

  it('model glm via NON-SumoPod tidak disisipi (param belum terverifikasi di provider lain)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload('glm-ok'));
    await callChatCompletionsWithFallback({
      baseUrl: 'https://kenari.id/v1',
      apiKey: 'kn-main',
      model: 'glm-5-3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 12000,
      payload: { messages: [] },
    });
    expect((postSpy.mock.calls[0][1] as any).reasoning_effort).toBeUndefined();
  });
});
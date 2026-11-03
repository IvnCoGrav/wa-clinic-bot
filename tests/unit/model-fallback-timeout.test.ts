import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import axios from 'axios';
import { callChatCompletionsWithFallback } from '../../src/integrations/llm/model-fallback';

describe('model-fallback timeout cap (Fase 1 — plumbing model & timeout)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.KENARI_BASE_URL;
    delete process.env.KENARI_API_KEY;
    delete process.env.LLM_FALLBACK_BASE_URL;
    delete process.env.LLM_FALLBACK_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  const okPayload = { data: { choices: [{ message: { content: 'jawaban valid lebih dari tiga karakter' } }] } };

  it('default cap 25 detik tetap berlaku untuk pemanggil biasa tanpa attemptTimeoutCapMs', async () => {
    delete process.env.LLM_ATTEMPT_TIMEOUT_MS;
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload);

    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 90_000, // Pemanggil minta 90s, tetapi cap default 25s
      transientRetry: { maxRetries: 0 },
      payload: { messages: [] },
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const config = postSpy.mock.calls[0][2];
    expect(config?.timeout).toBe(25_000);
  });

  it('attemptTimeoutCapMs kustom dihormati ketika disediakan (mis. Copilot 90s)', async () => {
    delete process.env.LLM_ATTEMPT_TIMEOUT_MS;
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload);

    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'test-key',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 90_000,
      attemptTimeoutCapMs: 90_000, // Copilot cap
      transientRetry: { maxRetries: 0 },
      payload: { messages: [] },
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const config = postSpy.mock.calls[0][2];
    expect(config?.timeout).toBe(90_000);
  });

  it('timeoutMs lebih kecil dari attemptTimeoutCapMs tetap dihormati (Math.min)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload);

    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'test-key',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 15_000, // Sisa anggaran hanya 15s
      attemptTimeoutCapMs: 90_000,
      transientRetry: { maxRetries: 0 },
      payload: { messages: [] },
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const config = postSpy.mock.calls[0][2];
    expect(config?.timeout).toBe(15_000);
  });

  it('LLM_ATTEMPT_TIMEOUT_MS dihormati sebagai defaultCap baru', async () => {
    process.env.LLM_ATTEMPT_TIMEOUT_MS = '45000';
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload);

    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 120_000,
      transientRetry: { maxRetries: 0 },
      payload: { messages: [] },
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const config = postSpy.mock.calls[0][2];
    expect(config?.timeout).toBe(45_000);
  });

  it('meneruskan AbortSignal ke axios agar pembatalan benar-benar menghentikan request', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(okPayload);
    const ac = new AbortController();

    await callChatCompletionsWithFallback({
      baseUrl: 'https://ai.sumopod.com/v1',
      apiKey: 'test-key',
      model: 'glm-5.3-flash',
      fallbackModel: 'deepseek-chat',
      timeoutMs: 90_000,
      attemptTimeoutCapMs: 90_000,
      signal: ac.signal,
      transientRetry: { maxRetries: 0 },
      payload: { messages: [] },
    });

    const config = postSpy.mock.calls[0][2];
    expect((config as any)?.signal).toBe(ac.signal);
  });
});

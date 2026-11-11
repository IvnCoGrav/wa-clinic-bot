import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramService } from '../../src/services/telegram.service';

/**
 * I-008: Telegram WAJIB punya timeout, retry terbatas, dan penanganan 429.
 * Tanpa itu, satu gangguan API bisa menggantung worker / menelan alert.
 */
describe('Telegram sendMessage — timeout & retry (I-008)', () => {
  const svc = new TelegramService();
  const originalFetch = globalThis.fetch;
  const base = {
    botToken: 'bot-token-test',
    chatId: 123,
    text: 'halo',
    __testOptions: { timeoutMs: 50, maxRetries: 2, retryDelayMs: 1 },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockResponse = (status: number, body: any = {}) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body, statusText: `HTTP ${status}` }) as any;

  it('429 lalu sukses → retry dan berhasil', async () => {
    const calls: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      calls.push(Date.now());
      return calls.length === 1
        ? mockResponse(429, { description: 'Too Many Requests', parameters: { retry_after: 0 } })
        : mockResponse(200, { ok: true });
    }) as any;

    const res = await svc.sendMessage(base);
    expect(res.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('5xx berulang → retry sampai batas lalu gagal jujur', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return mockResponse(502, { description: 'Bad Gateway' });
    }) as any;

    const res = await svc.sendMessage(base);
    expect(res.ok).toBe(false);
    expect(calls).toBe(3); // initial + 2 retry
    expect(res.description).toContain('Bad Gateway');
  });

  it('4xx non-429 (401) TIDAK di-retry', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return mockResponse(401, { description: 'Unauthorized' });
    }) as any;

    const res = await svc.sendMessage(base);
    expect(res.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('timeout/abort → gagal setelah retry terbatas (tidak menggantung)', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    }) as any;

    const res = await svc.sendMessage(base);
    expect(res.ok).toBe(false);
    expect(calls).toBe(3);
  });
});

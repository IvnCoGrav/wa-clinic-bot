import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { v3LlmCircuitBreaker } from '../../../src/v3/agent/agent-runner';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

describe('V3 LLM CircuitBreaker fail-fast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset circuit breaker to CLOSED by accessing private fields via any
    (v3LlmCircuitBreaker as any).state = 'CLOSED';
    (v3LlmCircuitBreaker as any).requestHistory = [];
    (v3LlmCircuitBreaker as any).lastStateChange = Date.now();
    process.env.LLM_FALLBACK_API_KEY = 'fallback_key';
    process.env.LLM_FALLBACK_BASE_URL = 'https://fallback.test';
    process.env.AI_MODEL_FALLBACK = 'fallback-model';
  });

  it('fail-fast aktif setelah 3 gagal beruntun, panggilan ke-4 langsung fallback <50ms', async () => {
    // Mock primary to always reject, fallback to resolve
    const primaryError = { response: { status: 500 }, message: 'primary down', code: 'SERVER_ERROR' };
    mockedAxios.post.mockImplementation(async (url: string) => {
      if (url.includes('fallback.test')) {
        return { data: { choices: [{ message: { content: 'fallback ok' } }] } };
      }
      return Promise.reject(primaryError);
    });

    const payload = { model: 'test', messages: [] };
    const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };

    // 3 panggilan gagal beruntun — akan trip setelah 6 request dengan 50% gagal, slidingWindow 6
    // Untuk mempercepat, kita set failureThreshold 0.5 dan window 6, jadi butuh 3 gagal dari 6
    // Kita akan panggil 6 kali dengan gagal, maka OPEN
    for (let i = 0; i < 6; i++) {
      await v3LlmCircuitBreaker.execute('https://primary.test/chat/completions', payload, headers);
    }

    expect(v3LlmCircuitBreaker.getState()).toBe('OPEN');

    // Panggilan ke-4 (ke-7 total) harus langsung fallback tanpa menyentuh primary
    mockedAxios.post.mockClear();
    mockedAxios.post.mockImplementation(async (url: string) => {
      if (url.includes('fallback.test')) {
        return { data: { choices: [{ message: { content: 'fallback fast' } }] } };
      }
      // Jika primary dipanggil, fail test
      throw new Error('Primary should not be called when OPEN');
    });

    const start = Date.now();
    const result = await v3LlmCircuitBreaker.execute('https://primary.test/chat/completions', payload, headers);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(result).toBeDefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post.mock.calls[0][0]).toContain('fallback.test');

    // Reset untuk test lain
    (v3LlmCircuitBreaker as any).state = 'CLOSED';
    (v3LlmCircuitBreaker as any).requestHistory = [];
  });
});

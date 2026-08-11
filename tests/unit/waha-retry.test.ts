import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WahaClient } from '../../src/integrations/waha/client';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

function forceRealHttp() {
  vi.spyOn(WahaClient.prototype as any, 'shouldMock', 'get').mockReturnValue(false);
}

function timeoutError(): any {
  const err: any = new Error('timeout of 10000ms exceeded');
  err.code = 'ECONNABORTED';
  return err;
}

function http400Error(): any {
  const err: any = new Error('Request failed with status code 400');
  err.response = { status: 400, data: { error: { message: 'Invalid OAuth access token' } } };
  return err;
}

describe('WahaClient — retry transien & concurrency limiter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.WAHA_BASE_URL;
    delete process.env.WAHA_RETRY_ATTEMPTS;
    delete process.env.WAHA_RETRY_BACKOFF_MS;
    delete process.env.WAHA_MAX_CONCURRENT_CALLS;
  });

  it('sendText: timeout → retry → sukses di percobaan kedua', async () => {
    forceRealHttp();
    mockedAxios.post
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce({ status: 200 });

    const client = new WahaClient();
    const ok = await client.sendText('628123456789@c.us', 'halo');

    expect(ok).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[0][0]).toContain('/api/sendText');
  });

  it('sendText: status 400 TIDAK di-retry (langsung gagal)', async () => {
    forceRealHttp();
    mockedAxios.post.mockRejectedValue(http400Error());

    const client = new WahaClient();
    const ok = await client.sendText('628123456789@c.us', 'halo');

    expect(ok).toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('sendText: retry habis (WAHA_RETRY_ATTEMPTS=2) → return false', async () => {
    forceRealHttp();
    process.env.WAHA_RETRY_ATTEMPTS = '2';
    process.env.WAHA_RETRY_BACKOFF_MS = '0';
    mockedAxios.post.mockRejectedValue(timeoutError());

    const client = new WahaClient();
    const ok = await client.sendText('628123456789@c.us', 'halo');

    expect(ok).toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('limiter: call bersamaan dibatasi sesuai WAHA_MAX_CONCURRENT_CALLS', async () => {
    forceRealHttp();
    process.env.WAHA_MAX_CONCURRENT_CALLS = '1';

    let active = 0;
    let maxActive = 0;
    mockedAxios.post.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return { status: 200 };
    });

    const client = new WahaClient();
    await Promise.all([
      client.sendText('628111111111@c.us', 'a'),
      client.sendText('628222222222@c.us', 'b'),
      client.sendText('628333333333@c.us', 'c'),
    ]);

    expect(maxActive).toBe(1);
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('sendSeen ikut di-retry saat timeout transien', async () => {
    forceRealHttp();
    mockedAxios.post
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce({ status: 200 });

    const client = new WahaClient();
    const ok = await client.sendSeen('628123456789@c.us', 'msg-1');

    expect(ok).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[0][0]).toContain('/api/sendSeen');
  });
});

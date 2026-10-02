import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// File ini SENGAJA tidak me-mock hermes-adapter: menguji kontrak HTTP asli
// dengan fetch yang di-stub (tanpa network nyata).
import {
  requestHermesRouter,
  requestHermesSummarize,
  resolveHermesConfig,
  HERMES_ASK_PATH,
} from '../../src/services/copilot/hermes-adapter';

const REAL_FETCH = globalThis.fetch;

function stubFetchOnce(payload: any, status = 200) {
  const fake = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }));
  globalThis.fetch = fake as any;
  return fake;
}

describe('hermes-adapter — kontrak POST /ask (tanpa network nyata)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COPILOT_ENGINE;
    delete process.env.HERMES_BRIDGE_URL;
    delete process.env.HERMES_BRIDGE_SECRET;
  });
  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    delete process.env.COPILOT_ENGINE;
    delete process.env.HERMES_BRIDGE_URL;
    delete process.env.HERMES_BRIDGE_SECRET;
  });

  it('tanpa secret → fail-closed (fetch tidak dipanggil, null)', async () => {
    const fake = stubFetchOnce({ tool: 'x', args: {} });
    const res = await requestHermesRouter('p', { baseUrl: 'http://h:9119', secret: '', timeoutMs: 1000 });
    expect(res).toBeNull();
    expect(fake).not.toHaveBeenCalled();
  });

  it('router 200 {tool,args} → diteruskan + header Bearer + kind router', async () => {
    const fake = stubFetchOnce({ tool: 'query_unreplied_chats', args: {} });
    const res = await requestHermesRouter('PROMPT', { baseUrl: 'http://h:9119/', secret: 's3cr3t', timeoutMs: 1000 });
    expect(res).toEqual({ tool: 'query_unreplied_chats', args: {} });
    expect(fake).toHaveBeenCalledTimes(1);
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe('http://h:9119' + HERMES_ASK_PATH);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer s3cr3t');
    expect(JSON.parse(init.body).kind).toBe('router');
    expect(JSON.parse(init.body).prompt).toBe('PROMPT');
  });

  it('router {tool:null} → keputusan null terstruktur (bukan gagal)', async () => {
    stubFetchOnce({ tool: null, args: {} });
    await expect(
      requestHermesRouter('p', { baseUrl: 'http://h', secret: 's', timeoutMs: 500 })
    ).resolves.toEqual({ tool: null, args: {} });
  });

  it('router non-200 → null (sinyal fallback)', async () => {
    stubFetchOnce({ error: 'x' }, 500);
    await expect(
      requestHermesRouter('p', { baseUrl: 'http://h', secret: 's', timeoutMs: 500 })
    ).resolves.toBeNull();
  });

  it('router payload cacat → null', async () => {
    stubFetchOnce({ nonsense: 1 });
    await expect(
      requestHermesRouter('p', { baseUrl: 'http://h', secret: 's', timeoutMs: 500 })
    ).resolves.toBeNull();
  });

  it('router menggantung → null dalam budget (tidak menggantung)', async () => {
    globalThis.fetch = (async () => new Promise(() => {})) as any;
    await expect(
      requestHermesRouter('p', { baseUrl: 'http://h', secret: 's', timeoutMs: 40 })
    ).resolves.toBeNull();
  });

  it('summarize 200 {text} → text; tanpa text → null', async () => {
    stubFetchOnce({ text: 'Ringkasan.' });
    await expect(
      requestHermesSummarize('p', { baseUrl: 'http://h', secret: 's', timeoutMs: 500 })
    ).resolves.toBe('Ringkasan.');
    stubFetchOnce({ nope: 1 });
    await expect(
      requestHermesSummarize('p', { baseUrl: 'http://h', secret: 's', timeoutMs: 500 })
    ).resolves.toBeNull();
  });

  it('resolveHermesConfig: default internal + URL kanonis tanpa trailing slash', () => {
    expect(resolveHermesConfig().engine).toBe('internal');
    process.env.COPILOT_ENGINE = 'hermes';
    const c = resolveHermesConfig();
    expect(c.engine).toBe('hermes');
    expect(c.baseUrl).toBe('http://hermes-agent:9119');
  });

  it('resolveHermesConfig: mode default openai; bridge bila diminta eksplisit', () => {
    expect(resolveHermesConfig().mode).toBe('openai');
    process.env.HERMES_BRAIN_MODE = 'bridge';
    expect(resolveHermesConfig().mode).toBe('bridge');
    delete process.env.HERMES_BRAIN_MODE;
  });

  it('resolveHermesConfig: model default = satu-satunya model :8642 (terverifikasi)', () => {
    expect(resolveHermesConfig().openaiModel).toBe('hermes-agent');
    process.env.HERMES_OPENAI_MODEL = 'lain';
    expect(resolveHermesConfig().openaiModel).toBe('lain');
    delete process.env.HERMES_OPENAI_MODEL;
  });
});

describe('hermes-adapter mode openai — :8642/v1/chat/completions (tanpa network nyata)', () => {
  const openaiOpts = {
    baseUrl: 'http://h:9119',
    secret: 's3cr3t',
    timeoutMs: 500,
    mode: 'openai' as const,
    openaiUrl: 'http://h:8642/',
    openaiKey: 'k64hex',
    openaiModel: 'm-test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
  });

  function stubFetchOnce(payload: any, status = 200) {
    const fake = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }));
    globalThis.fetch = fake as any;
    return fake;
  }

  const completion = (content: string) => ({ choices: [{ message: { content } }] });

  it('router via openai: URL/ Bearer / body model+messages benar; JSON diteruskan', async () => {
    const fake = stubFetchOnce(completion('{"tool":"query_unreplied_chats","args":{}}'));
    const res = await requestHermesRouter('PROMPT', openaiOpts);
    expect(res).toEqual({ tool: 'query_unreplied_chats', args: {} });
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe('http://h:8642/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer k64hex');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('m-test');
    expect(body.messages).toEqual([{ role: 'user', content: 'PROMPT' }]);
    expect(body.temperature).toBe(0);
  });

  it('router via openai: konten bukan JSON → null', async () => {
    stubFetchOnce(completion('maaf tidak bisa'));
    await expect(requestHermesRouter('p', openaiOpts)).resolves.toBeNull();
  });

  it('router via openai: tanpa key / tanpa model → fail-closed tanpa fetch', async () => {
    const fake = stubFetchOnce(completion('{}'));
    await expect(
      requestHermesRouter('p', { ...openaiOpts, openaiKey: '' })
    ).resolves.toBeNull();
    await expect(
      requestHermesRouter('p', { ...openaiOpts, openaiModel: '' })
    ).resolves.toBeNull();
    expect(fake).not.toHaveBeenCalled();
  });

  it('router via openai: non-200 / hang → null', async () => {
    stubFetchOnce({ error: 'x' }, 500);
    await expect(requestHermesRouter('p', openaiOpts)).resolves.toBeNull();
    globalThis.fetch = (async () => new Promise(() => {})) as any;
    await expect(requestHermesRouter('p', openaiOpts)).resolves.toBeNull();
  });

  it('summarize via openai: teks diteruskan; kosong → null', async () => {
    stubFetchOnce(completion('Ringkasan Hermes.'));
    const res = await requestHermesSummarize('p', openaiOpts);
    expect(res).toBe('Ringkasan Hermes.');
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(JSON.parse(init.body).temperature).toBe(0.2);
    stubFetchOnce(completion('   '));
    await expect(requestHermesSummarize('p', openaiOpts)).resolves.toBeNull();
  });
});

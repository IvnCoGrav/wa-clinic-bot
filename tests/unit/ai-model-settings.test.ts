import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const ADMIN_KEY = 'test_admin_key_ai_model_settings_999';

// Mock LLM fallback to avoid network
vi.mock('../../src/integrations/llm/model-fallback', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    callChatCompletionsWithFallback: vi.fn().mockResolvedValue({
      data: { choices: [{ message: { content: 'Halo Bunda! Untuk keluhan batuk pilek si kecil, kami ada perawatan Pijat Pulih Ceria yaa Bunda 😊 Rencana di hari apa yaa?' } }] },
      model: 'deepseek-v4-1-flash',
      usedFallback: false,
      baseUrl: 'https://kenari.id/v1',
    }),
    getFallbackModel: actual.getFallbackModel,
  };
});

describe('AI Model Settings — Endpoints & Preset Registry', () => {
  let app: any;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.KENARI_API_KEY = 'mock-kenari-key';
    process.env.SUMO_POD_API_KEY = 'mock-sumopod-key';
    process.env.KENARI_BASE_URL = 'https://kenari.id/v1';
    process.env.SUMO_POD_BASE_URL = 'https://ai.sumopod.com/v1';
    const { buildApp } = await import('../../src/app');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/admin/ai-models: mengembalikan data config dan provider status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-models',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.activeProvider).toMatch(/KENARI|SUMOPOD/);
    expect(body.activeEndpoint).toBeDefined();
    expect(body.activeEndpoint.baseUrl).toBeDefined();
    expect(body.providersStatus).toBeDefined();
    expect(body.providersStatus.kenari).toBeDefined();
    expect(body.providersStatus.sumopod).toBeDefined();
  });

  it('POST /api/admin/ai-models/test: simulasi respon dan pengukuran latensi ms', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-models/test',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { sampleScenario: 'flu' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Should succeed with mocked LLM
    expect(body.success).toBe(true);
    expect(typeof body.latencyMs).toBe('number');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.latencyMs).toBeLessThan(10000);
    expect(typeof body.replySnippet).toBe('string');
    expect(body.replySnippet.length).toBeGreaterThan(10);
    expect(body.modelUsed).toBeDefined();
    expect(body.providerUsed).toMatch(/KENARI|SUMOPOD/);
  });

  it('POST /api/admin/ai-models/test: skenario price dan schedule', async () => {
    for (const scenario of ['price', 'schedule'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/ai-models/test',
        headers: { 'x-api-key': ADMIN_KEY },
        payload: { sampleScenario: scenario },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.replySnippet).toBeDefined();
    }
  });

  it('PUT /api/admin/ai-models/batch: menyimpan banyak task sekaligus secara aman', async () => {
    const payload = {
      configs: [
        { task: 'CHAT_REPLY', provider: 'Kenari', modelName: 'deepseek-v4-1-flash', maxTokens: 1024, temperature: 0.6 },
        { task: 'SUMMARIZATION', provider: 'Kenari', modelName: 'deepseek-v4-1-flash', maxTokens: 1024, temperature: 0.3 },
      ],
    };
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-models/batch',
      headers: { 'x-api-key': ADMIN_KEY },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    const chat = body.data.find((c: any) => c.task === 'CHAT_REPLY');
    expect(chat).toBeDefined();
    expect(chat.modelName).toBe('deepseek-v4-1-flash');
  });

  it('PUT /api/admin/ai-models/batch: dengan presetId 1-klik', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-models/batch',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { presetId: 'DEEP_REASONING' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const chat = body.data.find((c: any) => c.task === 'CHAT_REPLY');
    expect(chat.modelName).toBe('deepseek-v4-flash-0731:netra');
  });

  it('PUT /api/admin/ai-models/batch: menolak body kosong', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-models/batch',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  it('POST /api/admin/ai-models/reset-defaults: mengembalikan ke setelan golden default', async () => {
    // Ubah dulu agar ada perbedaan
    await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-models/batch',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { presetId: 'DISCIPLINED_QWEN' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-models/reset-defaults',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.activeProvider).toBe('SUMOPOD');
    const chat = body.data.find((c: any) => c.task === 'CHAT_REPLY');
    expect(chat.modelName).toBe('MiniMax-M2.7-highspeed');
  });

  it('AiModelConfigService preset registry: applyPresetProfile per-tenant', async () => {
    const { AiModelConfigService, AI_PRESET_PROFILES } = await import('../../src/config/ai-models.config');
    expect(AI_PRESET_PROFILES.FAST_ECONOMICAL).toBeDefined();
    expect(AI_PRESET_PROFILES.FAST_ECONOMICAL.chatModel).toBe('MiniMax-M2.7-highspeed');
    expect(AI_PRESET_PROFILES.DEEP_REASONING.chatModel).toBe('deepseek-v4-flash-0731:netra');
    expect(AI_PRESET_PROFILES.DISCIPLINED_QWEN.chatModel).toBe('qwen3.7-flash-2026-07-15');
    expect(AI_PRESET_PROFILES.FAILOVER_SUMOPOD.provider).toBe('KENARI');

    // Tenant isolation: preset di tenant-A tidak ganggu tenant-B
    AiModelConfigService.applyPresetProfile('FAST_ECONOMICAL', 'tenant-preset-A');
    AiModelConfigService.applyPresetProfile('DEEP_REASONING', 'tenant-preset-B');
    const aChat = AiModelConfigService.getModelConfig('CHAT_REPLY', 'tenant-preset-A');
    const bChat = AiModelConfigService.getModelConfig('CHAT_REPLY', 'tenant-preset-B');
    expect(aChat.modelName).toBe('MiniMax-M2.7-highspeed');
    expect(bChat.modelName).toBe('deepseek-v4-flash-0731:netra');
  });

  it('AiModelConfigService resetToGoldenDefaults: tenant-specific reset', async () => {
    const { AiModelConfigService } = await import('../../src/config/ai-models.config');
    AiModelConfigService.applyPresetProfile('DISCIPLINED_QWEN', 'tenant-reset-test');
    let cfg = AiModelConfigService.getModelConfig('CHAT_REPLY', 'tenant-reset-test');
    expect(cfg.modelName).toBe('qwen3.7-flash-2026-07-15');
    await AiModelConfigService.resetToGoldenDefaults('tenant-reset-test');
    cfg = AiModelConfigService.getModelConfig('CHAT_REPLY', 'tenant-reset-test');
    expect(cfg.modelName).toBe('MiniMax-M2.7-highspeed');
    expect(AiModelConfigService.getActiveProvider('tenant-reset-test')).toBe('SUMOPOD');
  });

  it('POST /api/admin/ai-models/test: kunci API per-target-provider (uji Kenari saat SumoPod aktif)', async () => {
    process.env.KENARI_API_KEY = 'mock-kenari-key';
    // Target Kenari dengan key tersedia → inferensi mock sukses walau active provider = SUMOPOD.
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-models/test',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { provider: 'KENARI', sampleScenario: 'flu' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.providerUsed).toBe('KENARI');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('POST /api/admin/ai-models/test: target tanpa key gagal jujur (tanpa 401 palsu lintas-provider)', async () => {
    // Aktifkan Kenari (key mock ada), lalu uji SumoPod yang key-nya dikosongkan:
    // kode lama mengirim key Kenari ke URL SumoPod; kode baru menolak jujur.
    process.env.KENARI_API_KEY = 'mock-kenari-key';
    process.env.SUMOPOD_API_KEY = '';
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/provider',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { provider: 'KENARI' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-models/test',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { provider: 'SUMOPOD', sampleScenario: 'flu' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.providerUsed).toBe('SUMOPOD');
    expect(String(body.error)).toContain('SUMOPOD_API_KEY');
  });

  it('PUT /api/admin/ai-models/batch: preset CUSTOM + confidenceThreshold tersimpan', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-models/batch',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        presetId: 'CUSTOM',
        configs: [
          { task: 'INTENT_CLASSIFICATION', provider: 'OpenAI', modelName: 'gpt-4o-mini', confidenceThreshold: 0.75 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const nlu = body.data.find((c: any) => c.task === 'INTENT_CLASSIFICATION');
    expect(nlu).toBeDefined();
    expect(nlu.provider).toBe('OpenAI');
    expect(nlu.modelName).toBe('gpt-4o-mini');
    expect(Number(nlu.confidenceThreshold)).toBe(0.75);
  });

  it('PATCH /api/admin/ai-models/provider: mengembalikan providersStatus reaktif', async () => {
    process.env.KENARI_API_KEY = 'mock-kenari-key';
    process.env.SUMOPOD_API_KEY = '';
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/provider',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { provider: 'SUMOPOD' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.providersStatus).toBeDefined();
    expect(body.providersStatus.sumopod).toBeDefined();
    expect(body.providersStatus.kenari).toBeDefined();
    expect(body.providersStatus.deepseekDirect).toBeDefined();
    expect(body.providersStatus.kenari.configured).toBe(true);
    expect(body.providersStatus.sumopod.configured).toBe(false);
  });
});

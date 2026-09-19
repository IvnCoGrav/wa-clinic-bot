import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { AiModelConfigService } from '../../src/config/ai-models.config';

describe('Modul 5.6 & 5.7 — AI Model Registry & System Health Integration Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('1. Empirical Effect & Audit Trail: PATCH /api/admin/ai-models/CHAT_REPLY MUST update in-memory resolution and log audit trail', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/CHAT_REPLY',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'Kenari', modelName: 'deepseek-v4-1-flash' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.modelName).toBe('deepseek-v4-1-flash');
    expect(body.message).toContain('Audit trail telah dicatat');

    // Empirical Verification: Query AiModelConfigService directly
    const activeConfig = AiModelConfigService.getModelConfig('CHAT_REPLY');
    expect(activeConfig.provider).toBe('Kenari');
    expect(activeConfig.modelName).toBe('deepseek-v4-1-flash');
  });

  it('2. Provider Allowlist Guard: Invalid provider MUST return 400 Bad Request', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/CHAT_REPLY',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'UnknownAI', modelName: 'some-model' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('tidak didukung');
  });


  it('3. Medical Check Lock Guard: Modifying MEDICAL_CHECK MUST return 400 Bad Request', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/MEDICAL_CHECK',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'OpenAI', modelName: 'gpt-4o' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('MEDICAL_CHECK');

    // Empirical Verification: Verify MEDICAL_CHECK remains internal deterministic engine
    const medConfig = AiModelConfigService.getModelConfig('MEDICAL_CHECK');
    expect(medConfig.provider).toBe('Internal Engine');
  });

  it('4. System Health API: GET /api/admin/health MUST return system health status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/health',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.wahaStatus).toBe('WORKING');

    expect(body.data.haversineLocationEngine).toContain('MULTIPLIER');
  });

  it('5. Provider Switcher API: PATCH /api/admin/ai-models/provider MUST switch between KENARI and SUMOPOD', async () => {
    // Switch to KENARI
    const resKenari = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/provider',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'KENARI' },
    });
    expect(resKenari.statusCode).toBe(200);
    const bodyKenari = JSON.parse(resKenari.body);
    expect(bodyKenari.success).toBe(true);
    expect(bodyKenari.activeProvider).toBe('KENARI');
    expect(bodyKenari.activeEndpoint.provider).toBe('KENARI');
    expect(bodyKenari.activeEndpoint.defaultModel).toBe('deepseek-v4-1-flash');

    // Verify GET /api/admin/ai-models returns activeProvider
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-models',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.activeProvider).toBe('KENARI');
    expect(getBody.providersStatus.kenari).toBeDefined();
    expect(getBody.providersStatus.sumopod).toBeDefined();

    // Switch to SUMOPOD
    const resSumopod = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/provider',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'SUMOPOD' },
    });
    expect(resSumopod.statusCode).toBe(200);
    const bodySumopod = JSON.parse(resSumopod.body);
    expect(bodySumopod.activeProvider).toBe('SUMOPOD');
    expect(bodySumopod.activeEndpoint.provider).toBe('SUMOPOD');

    // Invalid provider guard
    const resInvalid = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/provider',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'INVALID_AI' },
    });
    expect(resInvalid.statusCode).toBe(400);
  });
});

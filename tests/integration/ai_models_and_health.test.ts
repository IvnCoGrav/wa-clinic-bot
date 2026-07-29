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
      payload: { provider: 'OpenAI', modelName: 'gpt-4o-mini' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.modelName).toBe('gpt-4o-mini');
    expect(body.message).toContain('Audit trail telah dicatat');

    // Empirical Verification: Query AiModelConfigService directly
    const activeConfig = AiModelConfigService.getModelConfig('CHAT_REPLY');
    expect(activeConfig.provider).toBe('OpenAI');
    expect(activeConfig.modelName).toBe('gpt-4o-mini');
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
});

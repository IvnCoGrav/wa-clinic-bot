import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LegacyHarvestingService } from '../../src/services/legacy-harvesting.service';
import { AiModelConfigService } from '../../src/config/ai-models.config';
import { buildApp } from '../../src/app';

describe('Modul 5.3 — Legacy AI Harvesting Engine & Dynamic AI Model Registry Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('1. PII Scrubbing & Pre-AI Junk Filter: Sensitive data MUST be scrubbed and junk messages skipped', () => {
    // 1a. PII Scrubbing
    const rawText = 'Halo Bunda Ani, transfer ke rekening BCA 1234567890 atau hubungi 081234567890 email test@gmail.com';
    const scrubbed = LegacyHarvestingService.scrubPII(rawText);

    expect(scrubbed).not.toContain('081234567890');
    expect(scrubbed).not.toContain('1234567890');
    expect(scrubbed).not.toContain('test@gmail.com');
    expect(scrubbed).toContain('[REDACTED_PHONE]');
    expect(scrubbed).toContain('[REDACTED_ACCOUNT]');

    // 1b. Pre-AI Junk Filter
    expect(LegacyHarvestingService.isJunkMessage('ok')).toBe(true);
    expect(LegacyHarvestingService.isJunkMessage('ya bunda')).toBe(true);
    expect(LegacyHarvestingService.isJunkMessage('👍')).toBe(true);
    expect(LegacyHarvestingService.isJunkMessage('Berapa tarif paket perawatan bayi home treatment di Surabaya?')).toBe(false);
  });

  it('2. Dynamic AI Model Registry API: Models mapped to tasks MUST be viewable and editable via API', async () => {
    // 2a. Fetch AI Models
    const resGet = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-models',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resGet.statusCode).toBe(200);
    const bodyGet = JSON.parse(resGet.body);
    expect(bodyGet.success).toBe(true);
    expect(bodyGet.data.length).toBeGreaterThan(0);

    // 2b. Update AI Model mapping dynamically for HARVESTING task
    const resPatch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/HARVESTING',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: {
        provider: 'OpenAI',
        modelName: 'gpt-4o-mini',
      },
    });

    expect(resPatch.statusCode).toBe(200);
    const bodyPatch = JSON.parse(resPatch.body);
    expect(bodyPatch.success).toBe(true);
    expect(bodyPatch.data.modelName).toBe('gpt-4o-mini');

    // Verify change took effect in service
    const config = AiModelConfigService.getModelConfig('HARVESTING');
    expect(config.modelName).toBe('gpt-4o-mini');
  });

  it('3. Async Trigger & Polling API: POST /api/admin/harvest/legacy-chat & GET /api/admin/harvest/status', async () => {
    // Trigger harvest job
    const resTrigger = await app.inject({
      method: 'POST',
      url: '/api/admin/harvest/legacy-chat',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(resTrigger.statusCode).toBe(200);
    const bodyTrigger = JSON.parse(resTrigger.body);
    expect(bodyTrigger.status).toBe('STARTED');

    // Poll status
    const resStatus = await app.inject({
      method: 'GET',
      url: '/api/admin/harvest/status',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(resStatus.statusCode).toBe(200);
    const bodyStatus = JSON.parse(resStatus.body);
    expect(bodyStatus.data).toHaveProperty('progressPercent');
  });

  it('4. General FAQ Staging Endpoints: GET /api/admin/general-faq-staging & PATCH review', async () => {
    const resGet = await app.inject({
      method: 'GET',
      url: '/api/admin/general-faq-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resGet.statusCode).toBe(200);

    const resReview = await app.inject({
      method: 'PATCH',
      url: '/api/admin/general-faq-staging/stage_gen_123/review',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: {
        status: 'APPROVED',
        generalQuestion: 'Apakah melayani home treatment di hari libur?',
        generalAnswer: 'Ya Bunda, kami melayani setiap hari termasuk hari libur nasional.',
        category: 'general',
      },
    });

    expect(resReview.statusCode).toBe(200);
    const bodyReview = JSON.parse(resReview.body);
    expect(bodyReview.success).toBe(true);
  });
});

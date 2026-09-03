import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { telemetryService } from '../../src/services/telemetry.service';

describe('AI Health Endpoint', () => {
  beforeEach(() => telemetryService.clear());

  it('GET /api/admin/system/ai-health tanpa auth -> 401', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/system/ai-health' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/admin/system/ai-health dengan auth -> 200 dan HEALTHY saat kosong', async () => {
    process.env.ADMIN_API_KEY = 'test-key';
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/system/ai-health?windowHours=24',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('HEALTHY');
    expect(body.data.windowHours).toBe(24);
    await app.close();
  });

  it('GET /api/admin/system/ai-health menghitung P95 dan status CRITICAL jika RSQR', async () => {
    process.env.ADMIN_API_KEY = 'test-key';
    const now = Date.now();
    telemetryService.recordTurn({ conversationId: 'c1', customerPhone: '6281', tenantId: 't', timestamp: now, rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: true, nluErrorCode: null, isJsonTruncated: false, latencyMs: 100 } as any);
    telemetryService.recordTurn({ conversationId: 'c2', customerPhone: '6282', tenantId: 't', timestamp: now, rawLlmReply: null, sanitizedReply: null, mutilationRatio: 0, isSilentDrop: false, isUnjustifiedRsqr: true, nluErrorCode: null, isJsonTruncated: false, latencyMs: 200 } as any);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/system/ai-health?windowHours=24',
      headers: { 'x-api-key': 'test-key' },
    });
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('CRITICAL');
    expect(body.data.unjustifiedRsqrRate).toBeGreaterThan(0);
    await app.close();
  });
});

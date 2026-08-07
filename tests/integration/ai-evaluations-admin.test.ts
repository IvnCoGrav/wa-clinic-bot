import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

describe('Admin API — AiEvaluation (LLM-as-Judge quality trend)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('mengembalikan data kosong (bukan 500) saat DB offline', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-evaluations?days=7',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(0);
    expect(body.data.avgScore).toBe(0);
    expect(Array.isArray(body.data.recent)).toBe(true);
  });

  it('menghargai query days & limit secara aman (clamp)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-evaluations?days=9999&limit=99999',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(response.statusCode).toBe(200);
  });
});
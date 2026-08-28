import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { FewShotExemplarBank } from '../../src/slot-engine/few-shot-exemplars';

describe('Few-Shot Exemplars Admin API (/api/admin/few-shots)', () => {
  const app = buildApp();
  const adminApiKey = 'test_admin_api_key_few_shots';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = adminApiKey;
  });

  it('GET /api/admin/few-shots returns list of exemplars', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/few-shots',
      headers: { 'x-api-key': adminApiKey },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('scenario');
    expect(body.data[0]).toHaveProperty('customerMessage');
    expect(body.data[0]).toHaveProperty('idealResponse');
  });

  it('POST /api/admin/few-shots creates a new exemplar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots',
      headers: { 'x-api-key': adminApiKey },
      payload: {
        scenario: 'Pasien tanya promo bundling',
        customerMessage: 'Ada promo bundling Moms & Baby gak bun?',
        idealResponse: 'Ada ya Bunda 😊 Untuk paket bundling Moms & Baby ada potongan khusus...',
        tags: ['promo', 'bundling', 'moms'],
        isActive: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.scenario).toBe('Pasien tanya promo bundling');
    expect(body.data.tags).toContain('promo');
  });

  it('PUT /api/admin/few-shots/:id updates existing exemplar', async () => {
    // 1. Get first exemplar
    const all = await FewShotExemplarBank.getAllExemplars();
    const target = all[0];

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/few-shots/${target.id}`,
      headers: { 'x-api-key': adminApiKey },
      payload: {
        idealResponse: 'Respons yang telah diedit oleh admin via dashboard...',
        isActive: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.idealResponse).toBe('Respons yang telah diedit oleh admin via dashboard...');
    expect(body.data.isActive).toBe(false);
  });

  it('DELETE /api/admin/few-shots/:id deletes exemplar', async () => {
    // 1. Create a dummy to delete
    const created = await FewShotExemplarBank.createExemplar({
      scenario: 'To delete',
      customerMessage: 'Test',
      idealResponse: 'Test',
      tags: ['test'],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/few-shots/${created.id}`,
      headers: { 'x-api-key': adminApiKey },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
  });

  it('POST /api/admin/few-shots/reset-defaults resets list to system defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots/reset-defaults',
      headers: { 'x-api-key': adminApiKey },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });
});

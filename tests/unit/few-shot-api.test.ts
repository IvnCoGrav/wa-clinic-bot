import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { FewShotExemplarBank, DEFAULT_FEW_SHOT_EXEMPLARS } from '../../src/slot-engine/few-shot-exemplars';

// Test API butuh mode non-production agar buildApp() tidak melempar
// "WAHA_WEBHOOK_SECRET must be defined" — setup.ts global sengaja blank
// secret supaya webhook berjalan no-auth secara deterministik.
process.env.NODE_ENV = 'test';
process.env.WAHA_WEBHOOK_SECRET = '';
process.env.ADMIN_API_KEY = 'test_admin_api_key_few_shots';

describe('Few-Shot Exemplars Admin API (/api/admin/few-shots)', () => {
  const app = buildApp();
  const adminApiKey = 'test_admin_api_key_few_shots';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = adminApiKey;
  });

  afterEach(() => {
    // Bersihkan cache modul agar tiap test berangkat dari state bersih.
    FewShotExemplarBank.__clearCacheForTest?.('default-tenant');
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

  it('POST /api/admin/few-shots rejects whitespace-only required fields with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots',
      headers: { 'x-api-key': adminApiKey },
      payload: {
        scenario: '   ',
        customerMessage: 'Halo',
        idealResponse: 'Hai',
        tags: ['promo'],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/admin/few-shots tolerates non-array tags (sanitized to empty)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots',
      headers: { 'x-api-key': adminApiKey },
      payload: {
        scenario: 'Tag tidak valid',
        customerMessage: 'Test',
        idealResponse: 'Test',
        tags: 'promo, bundling' as unknown as string[],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body.data.tags)).toBe(true);
    expect(body.data.tags.length).toBe(0);
  });

  it('PUT /api/admin/few-shots/:id updates existing exemplar', async () => {
    // 1. Get first exemplar
    const all = await FewShotExemplarBank.getAllExemplars('default-tenant', true);
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
    const created = await FewShotExemplarBank.createExemplar(
      {
        scenario: 'To delete',
        customerMessage: 'Test',
        idealResponse: 'Test',
        tags: ['test'],
      },
      'default-tenant'
    );

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

  it('reset-defaults -> update (no ID mismatch 404)', async () => {
    // Reset dulu
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots/reset-defaults',
      headers: { 'x-api-key': adminApiKey },
    });
    expect(resetRes.statusCode).toBe(200);
    const resetBody = resetRes.json();
    const first = resetBody.data[0];

    // Update memakai ID riil hasil reset (harusnya sukses, bukan 404)
    const updRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/few-shots/${first.id}`,
      headers: { 'x-api-key': adminApiKey },
      payload: { idealResponse: 'Diedit pasca-reset' },
    });
    expect(updRes.statusCode).toBe(200);
    const updBody = updRes.json();
    expect(updBody.data.idealResponse).toBe('Diedit pasca-reset');

    // Delete memakai ID riil hasil reset (harusnya sukses)
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/few-shots/${first.id}`,
      headers: { 'x-api-key': adminApiKey },
    });
    expect(delRes.statusCode).toBe(200);
  });

  it('POST /api/admin/few-shots rejects oversize fields with 400 (prompt budget guard)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots',
      headers: { 'x-api-key': adminApiKey },
      payload: {
        scenario: 'x'.repeat(151),
        customerMessage: 'Halo',
        idealResponse: 'Hai',
      },
    });
    expect(res.statusCode).toBe(400);

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots',
      headers: { 'x-api-key': adminApiKey },
      payload: {
        scenario: 'Skenario valid',
        customerMessage: 'Halo',
        idealResponse: 'y'.repeat(1001),
      },
    });
    expect(res2.statusCode).toBe(400);
  });

  it('PUT /api/admin/few-shots/:id rejects empty & oversize fields with 400', async () => {
    const all = await FewShotExemplarBank.getAllExemplars('default-tenant', true);
    const target = all[0];

    const emptyRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/few-shots/${target.id}`,
      headers: { 'x-api-key': adminApiKey },
      payload: { scenario: '   ' },
    });
    expect(emptyRes.statusCode).toBe(400);

    const longRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/few-shots/${target.id}`,
      headers: { 'x-api-key': adminApiKey },
      payload: { customerMessage: 'z'.repeat(501) },
    });
    expect(longRes.statusCode).toBe(400);
  });

  it('reset-defaults is non-destructive: custom exemplar dipertahankan', async () => {
    const custom = await FewShotExemplarBank.createExemplar(
      {
        scenario: 'Pertanyaan Jam Operasional (kustom admin)',
        customerMessage: 'Jam operasional klinik jam berapa?',
        idealResponse: 'Kami buka setiap hari pukul 08.00-20.00 ya Bunda 😊',
        tags: ['jam', 'operasional'],
      },
      'default-tenant'
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/few-shots/reset-defaults',
      headers: { 'x-api-key': adminApiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // Seluruh default SOP (inti + Koleksi Emas + lokasi/ongkir) + 1 kustom;
    // kustom tidak terhapus & ikut serta dalam hasil. Hitung dinamis agar
    // tidak rapuh saat koleksi default bertambah.
    expect(body.data.length).toBe(DEFAULT_FEW_SHOT_EXEMPLARS.length + 1);
    expect(body.data.some((e: any) => e.id === custom.id)).toBe(true);
    expect(body.data.some((e: any) => e.scenario === 'Pertanyaan Jam Operasional (kustom admin)')).toBe(true);
  });
});

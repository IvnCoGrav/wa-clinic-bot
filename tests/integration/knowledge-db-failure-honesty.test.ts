import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * C-012: import/update knowledge tidak boleh melaporkan "sukses" di produksi
 * saat DB gagal (fallback memori = data hilang/tidak ter-retrieve).
 */
describe('Knowledge admin — kejujuran DB (C-012)', () => {
  const app = buildApp();
  const originalEnv = process.env.NODE_ENV;
  const headers = { 'x-api-key': 'test_admin_key_kn_honest' };
  const payload = { faqs: [{ question: 'Jam buka?', answer: '08.00-17.00' }] };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_kn_honest';
    (prisma as any).knowledgeChunk.create = vi.fn().mockRejectedValue(new Error('Database offline'));
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('produksi + DB gagal → import FAQ 503 (bukan 200 sukses)', async () => {
    process.env.NODE_ENV = 'production';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/knowledge/faq',
      headers,
      payload,
    });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe('DATABASE_UNAVAILABLE');
  });

  it('non-produksi → 200 tetapi eksplisit degraded', async () => {
    process.env.NODE_ENV = 'test';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/knowledge/faq',
      headers,
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(JSON.parse(res.body).degraded).toBe(true);
  });

  it('produksi + update gagal → 503 (memori bukan penyimpanan durable)', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(prisma.knowledgeChunk, 'findFirst').mockResolvedValue({ id: 'chunk-1', tenant_id: 'default-tenant' } as any);
    vi.spyOn(prisma.knowledgeChunk, 'update').mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/knowledge/chunks/chunk-1',
      headers,
      payload: { title: 'Judul', content: 'Konten' },
    });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe('DATABASE_UNAVAILABLE');
  });

  it('produksi + GET daftar knowledge gagal → 503 (bukan 200 kosong)', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(prisma.knowledgeChunk, 'findMany').mockRejectedValue(new Error('Database offline'));
    const res = await app.inject({ method: 'GET', url: '/api/admin/knowledge/chunks', headers });
    expect(res.statusCode).toBe(503);
  });

  it('non-produksi + GET gagal → 200 degraded', async () => {
    process.env.NODE_ENV = 'test';
    vi.spyOn(prisma.knowledgeChunk, 'findMany').mockRejectedValue(new Error('Database offline'));
    const res = await app.inject({ method: 'GET', url: '/api/admin/knowledge/chunks', headers });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).degraded).toBe(true);
  });
});

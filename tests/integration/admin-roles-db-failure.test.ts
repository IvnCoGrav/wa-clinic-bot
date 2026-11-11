import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * Ar-005: degradasi DB tidak boleh menyamar sebagai sukses (200 + data kosong)
 * di produksi. GET /api/admin/roles wajib 503 saat DB tidak tersedia;
 * fallback memori hanya untuk dev/test dan ditandai `degraded: true`.
 */
describe('Admin roles — jujur saat DB gagal (Ar-005)', () => {
  const app = buildApp();
  const originalEnv = process.env.NODE_ENV;
  const headers = { 'x-api-key': 'test_admin_key_roles_db' };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_roles_db';
    // Model belum ada di mock global tests/setup.ts — daftarkan rejection
    // "DB offline" agar perilaku route teruji tanpa Postgres.
    (prisma as any).customRole = {
      findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      upsert: vi.fn().mockRejectedValue(new Error('Database offline')),
      deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
    };
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('produksi + DB gagal → 503 DATABASE_UNAVAILABLE (bukan 200 kosong)', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(prisma.customRole, 'findMany').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await app.inject({ method: 'GET', url: '/api/admin/roles', headers });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('non-produksi → fallback memori ditandai degraded', async () => {
    process.env.NODE_ENV = 'test';
    vi.spyOn(prisma.customRole, 'findMany').mockRejectedValue(new Error('Database offline'));
    const res = await app.inject({ method: 'GET', url: '/api/admin/roles', headers });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.degraded).toBe(true);
  });
});

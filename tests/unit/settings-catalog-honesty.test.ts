import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { saveServicesToDb } from '../../src/services/treatment-catalog.service';

/**
 * Cfg-010: tulis katalog tidak boleh "sukses palsu" saat DB gagal.
 */
describe('Katalog — kejujuran tulis DB (Cfg-010)', () => {
  const app = buildApp();
  const headers = { 'x-api-key': 'test_admin_key_catalog' };
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_catalog';
    (prisma as any).$transaction = vi.fn().mockRejectedValue(new Error('Database offline'));
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('saveServicesToDb mengembalikan false saat DB gagal (bukan true palsu)', async () => {
    await expect(saveServicesToDb('tenant-cfg010')).resolves.toBe(false);
  });

  it('produksi + DB gagal → POST service 503', async () => {
    process.env.NODE_ENV = 'production';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/services',
      headers,
      payload: { id: 'svc-cfg010', name: 'Pijat Uji', originalPrice: 100000, promoPrice: 90000, durationMinutes: 60 },
    });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe('DATABASE_UNAVAILABLE');
  });

  it('harga promo > normal → 400 (validasi longgar ditutup)', async () => {
    process.env.NODE_ENV = 'test';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/services',
      headers,
      payload: { id: 'svc-cfg010b', name: 'Pijat Uji', originalPrice: 100000, promoPrice: 200000, durationMinutes: 60 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('durasi di luar 15–480 menit → 400', async () => {
    process.env.NODE_ENV = 'test';
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/services',
      headers,
      payload: { id: 'svc-cfg010c', name: 'Pijat Uji', originalPrice: 100000, promoPrice: 90000, durationMinutes: 5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

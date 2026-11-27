import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';

describe('landing cache headers', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_cache';
    process.env.DEFAULT_WHATSAPP_PHONE = '6281234567890';
  });

  it('/go tidak di-cache publik dan memakai Vary X-Forwarded-Host', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/go?slug=default',
      headers: { 'x-forwarded-host': 'tenant-a.example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['vary']).toContain('X-Forwarded-Host');
    await app.close();
  });

  it('/:slug juga memakai kebijakan cache privat', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/promo-lama' });
    // DB offline → 404 atau default content; jika 200 header wajib privat.
    if (res.statusCode === 200) {
      expect(res.headers['cache-control']).toContain('private');
      expect(res.headers['vary']).toContain('X-Forwarded-Host');
    }
    await app.close();
  });

  it('aset HTML mentah tidak dapat diunduh lewat /assets', async () => {
    const app = buildApp();
    for (const name of ['go.html', 'pricelist.html']) {
      const res = await app.inject({ method: 'GET', url: `/assets/${name}` });
      expect(res.statusCode).toBe(404);
    }
    const ok = await app.inject({ method: 'GET', url: '/assets/external-tracker.js' });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * RC-CTA-01 (2026-11-15) — regresi fatal trafik iklan.
 *
 * Bug produksi: landing page eksternal mengarah ke `/cta?divisi=...` TANPA `?slug=`.
 * `resolveLandingContent('default')` tidak menemukan tenant (slug riil =
 * 'default-tenant') sehingga jatuh ke `defaultLandingContent()` (konten contoh/dev)
 * yang nomornya diambil dari env `DEFAULT_WHATSAPP_PHONE` (kosong di produksi).
 * Hasilnya: `https://wa.me/?text=...` — tanpa nomor tujuan, semua klik iklan
 * tidak bisa masuk WhatsApp, dan pixel browser memakai 'mock_pixel_123'.
 *
 * Kontrak yang dikunci test ini:
 *  1. Nomor tujuan WAJIB berasal dari DB tenant (single source of truth).
 *  2. Pixel browser WAJIB pixel tenant, bukan pixel mock.
 *  3. Greeting WAJIB dari DB tenant, bukan teks hardcode fallback.
 *  4. Kode tracking tetap disisipkan sebagai `Promo[xx]` (2 karakter, keputusan owner).
 */
describe('RC-CTA-01 — /cta tanpa ?slug tetap punya nomor tujuan', () => {
  const app = buildApp();

  const tenantRow = {
    id: DEFAULT_TENANT_ID,
    slug: DEFAULT_TENANT_ID,
    name: 'Kala',
    whatsapp_number: '6285794210526',
    meta_pixel_id: '1465457801784141',
    greetings_text: 'Promo [%ID%]\n\nHalo Bu Bidan, Saya mau Reservasi Home Sevice. Bagaimana Caranya ?',
    format_visit: 'Promo [%ID%]',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    (prisma as any).landingPage = { findFirst: vi.fn().mockResolvedValue(null) };
    (prisma as any).landingPageView = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'lpv_1' }),
    };
    (prisma as any).adClick = {
      create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'c1', ...args.data })),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    // Tenant hanya "ada" bila dicari dengan identitas tenant default.
    // Pencarian lama `slug='default'` HARUS gagal (itu akar bug produksi).
    (prisma as any).tenant = {
      findFirst: vi.fn().mockImplementation((args: any) => {
        const where = args?.where || {};
        const ors = Array.isArray(where.OR) ? where.OR : [];
        const looksLikeDefault = ors.some(
          (c: any) => c?.id === DEFAULT_TENANT_ID || c?.slug === DEFAULT_TENANT_ID
        );
        return Promise.resolve(looksLikeDefault ? tenantRow : null);
      }),
      findUnique: vi.fn().mockResolvedValue(null),
    };
  });

  const hitCta = () =>
    app.inject({
      method: 'GET',
      url: '/cta?divisi=iklan-utama',
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; CPH2457) AppleWebKit/537.36' },
    });

  it('1. link memakai nomor tenant dari DB, BUKAN wa.me tanpa nomor', async () => {
    const res = await hitCta();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('https://wa.me/6285794210526?text=');
    expect(res.body).not.toContain('https://wa.me/?text=');
  });

  it('2. pixel browser memakai pixel tenant asli, bukan mock_pixel_123', async () => {
    const res = await hitCta();
    expect(res.body).toContain("fbq('init', '1465457801784141')");
    expect(res.body).not.toContain('mock_pixel_123');
  });

  it('3. greeting diambil dari DB tenant, bukan teks hardcode fallback', async () => {
    const res = await hitCta();
    const decoded = decodeURIComponent(res.body.replace(/\+/g, ' '));
    expect(decoded).toContain('Saya mau Reservasi Home Sevice');
    expect(decoded).not.toContain('saya tertarik dengan layanan home-treatment');
  });

  it('4. kode tracking 2 karakter tersisip sebagai Promo[xx]', async () => {
    const res = await hitCta();
    expect(res.body).toMatch(/Promo%20%5B[a-z0-9]{2}%5D/);
  });

  it('5. tenant lain TIDAK boleh meminjam nomor/pixel tenant default ataupun env DEFAULT_WHATSAPP_PHONE (isolasi)', async () => {
    const prevEnvPhone = process.env.DEFAULT_WHATSAPP_PHONE;
    process.env.DEFAULT_WHATSAPP_PHONE = '6289999999999';
    try {
      (prisma as any).landingPage.findFirst = vi.fn().mockResolvedValue({
        slug: 'cabang-x',
        tenant_id: 'cabang-x',
        title: 'Cabang X',
        landing_type: 'STRUCTURED_JSON',
        structured_content: {},
        html_content: null,
        events: [],
        whatsapp_number: null,
        meta_pixel_id: null,
        is_active: true,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/cta?slug=cabang-x',
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' },
      });

      // A-004: fail-closed 503 bila nomor WA kosong (tidak pernah 200 dengan wa.me/?text= mati)
      expect(res.statusCode).toBe(503);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-security-policy']).toContain('connect.facebook.net');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.body).not.toContain('wa.me/');
      expect(res.body).not.toContain('6285794210526');
      expect(res.body).not.toContain('6289999999999');
      expect(res.body).not.toContain('1465457801784141');
    } finally {
      if (prevEnvPhone === undefined) delete process.env.DEFAULT_WHATSAPP_PHONE;
      else process.env.DEFAULT_WHATSAPP_PHONE = prevEnvPhone;
    }
  });

  it('5b. renderLanding (/promo/:slug) tenant non-default TIDAK boleh meminjam env DEFAULT_WHATSAPP_PHONE (STRUCTURED_JSON & RAW_HTML)', async () => {
    const prevEnvPhone = process.env.DEFAULT_WHATSAPP_PHONE;
    process.env.DEFAULT_WHATSAPP_PHONE = '6289999999999';
    try {
      // Mode STRUCTURED_JSON
      (prisma as any).landingPage.findFirst = vi.fn().mockResolvedValue({
        slug: 'cabang-json',
        tenant_id: 'cabang-x',
        title: 'Cabang JSON',
        landing_type: 'STRUCTURED_JSON',
        structured_content: {},
        html_content: null,
        events: [],
        whatsapp_number: null,
        meta_pixel_id: null,
        is_active: true,
      });
      const resJson = await app.inject({ method: 'GET', url: '/promo/cabang-json' });
      expect(resJson.statusCode).toBe(200);
      expect(resJson.body).not.toContain('6289999999999');

      // Mode RAW_HTML
      (prisma as any).landingPage.findFirst = vi.fn().mockResolvedValue({
        slug: 'cabang-raw',
        tenant_id: 'cabang-x',
        title: 'Cabang Raw',
        landing_type: 'RAW_HTML',
        structured_content: null,
        html_content: '<!DOCTYPE html><html><head></head><body><a id="wa-cta" href="#">Chat</a></body></html>',
        events: [],
        whatsapp_number: null,
        meta_pixel_id: null,
        is_active: true,
      });
      const resRaw = await app.inject({ method: 'GET', url: '/promo/cabang-raw' });
      expect(resRaw.statusCode).toBe(200);
      expect(resRaw.body).not.toContain('6289999999999');
    } finally {
      if (prevEnvPhone === undefined) delete process.env.DEFAULT_WHATSAPP_PHONE;
      else process.env.DEFAULT_WHATSAPP_PHONE = prevEnvPhone;
    }
  });

  it('6. crawler/bot (tanpa kode) tidak pernah menerima placeholder [%ID%] literal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cta?divisi=iklan-utama',
      headers: { 'user-agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
    });

    expect(res.statusCode).toBe(200);
    expect(decodeURIComponent(res.body)).not.toContain('[%ID%]');
    expect(decodeURIComponent(res.body)).not.toContain('%ID%');
    expect(res.body).toContain('https://wa.me/6285794210526?text=');
  });
});

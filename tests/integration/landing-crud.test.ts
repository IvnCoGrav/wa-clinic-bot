import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryLandings } from '../../src/routes/admin.route';

// Memakai global mock di tests/setup.ts: semua prisma.landingPage.* default reject
// → CRUD admin otomatis jatuh ke in-memory fallback (mode offline), sesuai desain.

describe('Multi Landing Page — Admin CRUD & Serving (offline/in-memory fallback)', () => {
  const app = buildApp();

  const validHtml = '<html><head><title>Promo Bayi</title></head><body><a id="wa-cta" href="https://wa.me/628777">Chat WA</a></body></html>';
  const noCtaHtml = '<html><body><h1>Tanpa CTA</h1></body></html>';
  const dupCtaHtml = '<html><body><a id="wa-cta" href="#">A</a><a id="wa-cta" href="#">B</a></body></html>';
  const xssHtml = '<html><head><title>XSS</title></head><body><a id="wa-cta" href="#">X</a><script>alert(1)</script></body></html>';

  beforeEach(() => {
    vi.clearAllMocks();
    memoryLandings.clear();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.TRACKING_API_BASE_URL = '';
    process.env.TRACKING_API_KEY = '';
    process.env.LANDING_BASE_URL = 'https://landing.example.com';
  });

  const adminHeaders = { 'x-api-key': 'test_admin_key_999' };

  async function createLanding(payload: any, headers: any = adminHeaders) {
    return app.inject({ method: 'POST', url: '/api/admin/landings', headers, payload });
  }

  it('1. GET /api/admin/landings tanpa auth harus 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/landings' });
    expect(res.statusCode).toBe(401);
  });

  it('2. POST /api/admin/landings create valid (STRUCTURED_JSON) + events tersimpan + previewUrl', async () => {
    const res = await createLanding({
      title: 'Promo Bayi',
      slug: 'promo-baby',
      events: ['ViewContent', 'Search', 'NOT_A_REAL_EVENT'],
      whatsappNumber: '628777111222',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe('promo-baby');
    expect(body.data.title).toBe('Promo Bayi');
    expect(body.data.landingType).toBe('STRUCTURED_JSON');
    expect(body.data.hasHtml).toBe(false);
    expect(body.data.events).toEqual(['ViewContent', 'Search']);
    expect(body.data.whatsappNumber).toBe('628777111222');
    expect(body.data.previewUrl).toBe('https://landing.example.com/promo-baby');
  });

  it('3. POST create dengan slug invalid (huruf besar/spasi) harus 400', async () => {
    const res = await createLanding({ title: 'Bad Slug', slug: 'Promo Baby' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('huruf kecil');
  });

  it('4. POST create dengan slug reserved (promo, go, admin) harus 400', async () => {
    for (const slug of ['promo', 'go', 'admin']) {
      const res = await createLanding({ title: 'Reserved', slug });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('kata cadangan');
    }
    // favicon.ico juga ditolak (kena regex: titik tidak boleh)
    const dot = await createLanding({ title: 'Reserved', slug: 'favicon.ico' });
    expect(dot.statusCode).toBe(400);
  });

  it('5. POST create tanpa title harus 400', async () => {
    const res = await createLanding({ slug: 'no-title' });
    expect(res.statusCode).toBe(400);
  });

  it('6. POST create dengan html valid → RAW_HTML + script XSS dibuang oleh sanitizer', async () => {
    const res = await createLanding({ title: 'Landing HTML', slug: 'html-landing', html: xssHtml });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.landingType).toBe('RAW_HTML');
    expect(body.data.hasHtml).toBe(true);
    expect(body.data.sizeBytes).toBeGreaterThan(0);

    const detail = await app.inject({ method: 'GET', url: `/api/admin/landings/${body.data.id}`, headers: adminHeaders });
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.data.rawHtmlContent).toContain('wa-cta');
    expect(detailBody.data.rawHtmlContent).not.toContain('<script');
  });

  it('7. POST create html tanpa #wa-cta harus 400 (CTA Contract)', async () => {
    const res = await createLanding({ title: 'Tanpa CTA', slug: 'no-cta', html: noCtaHtml });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('wa-cta');
  });

  it('8. POST create html dengan duplicate #wa-cta harus 400 (CTA Contract)', async () => {
    const res = await createLanding({ title: 'Dup CTA', slug: 'dup-cta', html: dupCtaHtml });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Duplicate');
  });

  it('9. GET list mengembalikan landing yang dibuat (in-memory fallback)', async () => {
    await createLanding({ title: 'List A', slug: 'list-a' });
    await createLanding({ title: 'List B', slug: 'list-b' });

    const res = await app.inject({ method: 'GET', url: '/api/admin/landings', headers: adminHeaders });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const slugs = body.data.map((l: any) => l.slug);
    expect(slugs).toContain('list-a');
    expect(slugs).toContain('list-b');
  });

  it('10. PUT update title/slug/events + isActive toggle', async () => {
    const created = JSON.parse((await createLanding({ title: 'Awal', slug: 'update-me' })).body).data;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/landings/${created.id}`,
      headers: adminHeaders,
      payload: { title: 'Sesudah', slug: 'updated-slug', events: ['Lead'], isActive: false },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.title).toBe('Sesudah');
    expect(body.data.slug).toBe('updated-slug');
    expect(body.data.events).toEqual(['Lead']);
    expect(body.data.isActive).toBe(false);
  });

  it('11. PUT update slug ke kata reserved harus 400', async () => {
    const created = JSON.parse((await createLanding({ title: 'Ubah', slug: 'ubah-slug' })).body).data;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/landings/${created.id}`,
      headers: adminHeaders,
      payload: { slug: 'go' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('12. DELETE menghapus landing page', async () => {
    const created = JSON.parse((await createLanding({ title: 'Hapus', slug: 'to-delete' })).body).data;

    const del = await app.inject({ method: 'DELETE', url: `/api/admin/landings/${created.id}`, headers: adminHeaders });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse(del.body).success).toBe(true);

    const detail = await app.inject({ method: 'GET', url: `/api/admin/landings/${created.id}`, headers: adminHeaders });
    expect(JSON.parse(detail.body).data).toBeNull();
  });

  it('13. GET /api/tenant/:slug mendahulukan LandingPage aktif (events + override pixel), token CAPI tidak bocor', async () => {
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValueOnce({
      id: 'lp-1',
      tenant_id: 'default-tenant',
      slug: 'promo-baby',
      title: 'Promo Bayi Spesial',
      landing_type: 'RAW_HTML',
      html_content: '<html><body><a id="wa-cta" href="#">Chat</a></body></html>',
      structured_content: null,
      events: ['ViewContent', 'Lead'],
      meta_pixel_id: 'LP_PIXEL_OVERRIDE',
      whatsapp_number: '628111',
      is_active: true,
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'default-tenant',
      name: 'Klinik Kenanga',
      whatsapp_number: '628222',
      meta_pixel_id: 'TENANT_PIXEL',
      meta_capi_access_token: 'SHOULD_NEVER_LEAK',
    } as any);

    const res = await app.inject({ method: 'GET', url: '/api/tenant/promo-baby' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.title).toBe('Promo Bayi Spesial');
    expect(body.landing_type).toBe('RAW_HTML');
    expect(body.events).toEqual(['ViewContent', 'Lead']);
    expect(body.meta_pixel_id).toBe('LP_PIXEL_OVERRIDE');
    expect(body.whatsapp_number).toBe('628111');
    expect(body.raw_html_content).toContain('wa-cta');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SHOULD_NEVER_LEAK');
    expect(serialized).not.toContain('access_token');
  });

  it('14. GET /api/tenant/:slug fallback tenant legacy → events default []', async () => {
    vi.mocked(prisma.landingPage.findFirst).mockRejectedValueOnce(new Error('Database offline'));
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce({
      id: 'default-tenant',
      slug: 'kenanga',
      name: 'Klinik Kenanga',
      whatsapp_number: '628222',
      meta_pixel_id: 'TENANT_PIXEL',
      landing_type: 'STRUCTURED_JSON',
      landing_content: {},
      raw_html_content: null,
    } as any);

    const res = await app.inject({ method: 'GET', url: '/api/tenant/kenanga' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.title).toBe('Klinik Kenanga');
    expect(body.events).toEqual([]);
    expect(body.meta_pixel_id).toBe('TENANT_PIXEL');
  });

  it('15. GET /api/tenant/:slug fail-open saat semuanya gagal (DB offline)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tenant/anything-unknown' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.title).toBe('');
    expect(body.events).toEqual([]);
    expect(body.tenant_id).toBe('default-tenant');
  });
});

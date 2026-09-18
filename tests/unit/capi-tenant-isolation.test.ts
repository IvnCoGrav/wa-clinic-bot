import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { capiService } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

const META_OK = { status: 200, data: { events_received: 1, fbtrace_id: 'trace-1' } };
const ENV_PIXEL = 'PIXEL_ENV_OWNER';
const ENV_TOKEN = 'EAA_ENV_OWNER_TOKEN';
const CABANG = 'tenant-cabang-b';

/**
 * Isolasi multi-tenant Meta CAPI & Pixel (anti-leakage).
 * Seam: return value publik sendCapiEvent() + HTML landing ter-render via HTTP.
 * Nilai ekspektasi berupa literal independen, bukan hitungan ulang kode produksi.
 */
describe('Isolasi multi-tenant Meta CAPI & Pixel (anti-leakage)', () => {
  const app = buildApp();
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ['FB_PIXEL_ID', 'FB_CAPI_ACCESS_TOKEN', 'ADMIN_API_KEY', 'DEFAULT_WHATSAPP_PHONE']) {
      saved[k] = process.env[k];
    }
    process.env.ADMIN_API_KEY = 'test_admin_key_isolasi';
    process.env.DEFAULT_WHATSAPP_PHONE = '6281234567890';
    delete process.env.FB_PIXEL_ID;
    delete process.env.FB_CAPI_ACCESS_TOKEN;
    mockedAxios.post = vi.fn().mockResolvedValue(META_OK);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const customer = (phone: string) => ({ id: `cust-${phone}`, phone, name: 'Bunda Asli' });

  it('1. default-tenant tanpa DB config: boleh fallback env (backward compat)', async () => {
    process.env.FB_PIXEL_ID = ENV_PIXEL;
    process.env.FB_CAPI_ACCESS_TOKEN = ENV_TOKEN;
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

    const res = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: customer('6281211111111'),
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(res.success).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledOnce();
    const url = String(mockedAxios.post.mock.calls[0][0]);
    expect(url).toContain(ENV_PIXEL);
    expect(url).toContain(ENV_TOKEN);
  });

  it('2. default-tenant dengan DB config: DB menang atas env', async () => {
    process.env.FB_PIXEL_ID = ENV_PIXEL;
    process.env.FB_CAPI_ACCESS_TOKEN = ENV_TOKEN;
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      meta_pixel_id: 'PIXEL_DB_MILIK_SENDIRI',
      meta_capi_access_token: 'EAA_DB_TOKEN_MILIK_SENDIRI',
    } as any);

    const res = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: customer('6281222222222'),
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(res.success).toBe(true);
    const url = String(mockedAxios.post.mock.calls[0][0]);
    expect(url).toContain('PIXEL_DB_MILIK_SENDIRI');
    expect(url).toContain('EAA_DB_TOKEN_MILIK_SENDIRI');
    expect(url).not.toContain(ENV_PIXEL);
    expect(url).not.toContain(ENV_TOKEN);
  });

  it('3. tenant non-default tanpa DB config + env terisi: WAJIB SKIP, env tak tersentuh', async () => {
    process.env.FB_PIXEL_ID = ENV_PIXEL;
    process.env.FB_CAPI_ACCESS_TOKEN = ENV_TOKEN;
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

    const res = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: customer('6281233333333'),
      tenantId: CABANG,
    });

    expect(res.success).toBe(false);
    expect(res.message || '').toContain(CABANG);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('3b. tanpa tenantId + env terisi: WAJIB SKIP (fail-closed, bukan fallback)', async () => {
    process.env.FB_PIXEL_ID = ENV_PIXEL;
    process.env.FB_CAPI_ACCESS_TOKEN = ENV_TOKEN;

    const res = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: customer('6281244444444'),
    });

    expect(res.success).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('4. landing RAW_HTML tenant non-default tanpa pixel DB: HTML bebas pixel env, click-catcher tetap ada', async () => {
    process.env.FB_PIXEL_ID = ENV_PIXEL;
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue({
      id: 'lp-cabang',
      tenant_id: CABANG,
      slug: 'cabang-b',
      title: 'Cabang B',
      landing_type: 'RAW_HTML',
      html_content: '<html><head><title>C</title></head><body><a id="wa-cta" href="#">Chat</a></body></html>',
      structured_content: null,
      events: ['ViewContent'],
      meta_pixel_id: null,
      whatsapp_number: '628199',
      is_active: true,
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: CABANG, name: 'Cabang B', meta_pixel_id: null } as any);

    const res = await app.inject({ method: 'GET', url: '/go?slug=cabang-b' });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(ENV_PIXEL);
    expect(res.body).not.toContain('123456789012345');
    expect(res.body).not.toContain('fbevents.js');
    // click-catcher atribusi (non-pixel) wajib tetap terpasang
    expect(res.body).toContain('/api/tracking/click');
  });

  it('5. landing tenant non-default dengan pixel DB sendiri: pakai pixel sendiri, bukan env', async () => {
    process.env.FB_PIXEL_ID = ENV_PIXEL;
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue({
      id: 'lp-cabang-2',
      tenant_id: CABANG,
      slug: 'cabang-b2',
      title: 'Cabang B2',
      landing_type: 'RAW_HTML',
      html_content: '<html><head><title>C</title></head><body><a id="wa-cta" href="#">Chat</a></body></html>',
      structured_content: null,
      events: [],
      meta_pixel_id: null,
      whatsapp_number: '628199',
      is_active: true,
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: CABANG,
      name: 'Cabang B',
      meta_pixel_id: 'PIXEL_CABANG_B',
    } as any);

    const res = await app.inject({ method: 'GET', url: '/go?slug=cabang-b2' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("fbq('init', 'PIXEL_CABANG_B')");
    expect(res.body).not.toContain(ENV_PIXEL);
  });

  it('6. template STRUCTURED_JSON tanpa pixel: blok pixel dihilangkan total (tanpa fbevents.js)', async () => {
    process.env.FB_PIXEL_ID = '';
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue({
      id: CABANG,
      slug: 'cabang-b3',
      name: 'Cabang B3',
      whatsapp_number: '628199',
      meta_pixel_id: null,
      landing_type: 'STRUCTURED_JSON',
      landing_content: {},
      raw_html_content: null,
    } as any);

    const res = await app.inject({ method: 'GET', url: '/go?slug=cabang-b3' });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('fbevents.js');
    expect(res.body).not.toContain("fbq('init'");
  });

  it('7. /cta tenant non-default: query ?p= diabaikan (anti-spoofing attribution)', async () => {
    process.env.FB_PIXEL_ID = ENV_PIXEL;
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue({
      id: CABANG,
      slug: 'cabang-b4',
      name: 'Cabang B4',
      whatsapp_number: '628199',
      meta_pixel_id: null,
      greetings_text: 'Halo',
    } as any);

    const res = await app.inject({ method: 'GET', url: '/cta?slug=cabang-b4&p=PIXEL_SERANGAN&is_test=true' });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('PIXEL_SERANGAN');
    expect(res.body).not.toContain(ENV_PIXEL);
  });
});

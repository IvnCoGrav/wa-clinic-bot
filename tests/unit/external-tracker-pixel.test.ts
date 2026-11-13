import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * M-02 — pixel default external-tracker.js tidak boleh hardcode merek tertentu.
 * Server menyajikan file dengan placeholder diisi dari DB tenant:
 * - `?tenant=<id|slug>` terverifikasi DB → pixel tenant itu
 * - tenant non-default tanpa pixel → string kosong (jangan pinjam env default)
 * - tanpa hint / DB offline → env FB_PIXEL_ID (default-tenant)
 */

const app = buildApp();
const oldPixel = process.env.FB_PIXEL_ID;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FB_PIXEL_ID;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (oldPixel === undefined) delete process.env.FB_PIXEL_ID;
  else process.env.FB_PIXEL_ID = oldPixel;
});

function bodyOf(res: any): string {
  return String(res.body || '');
}

describe('external-tracker.js pixel per tenant', () => {
  it('mengisi pixel dari DB tenant sesuai ?tenant=', async () => {
    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({ meta_pixel_id: '1122334455' } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/assets/external-tracker.js?tenant=tenant-b',
    });

    expect(res.statusCode).toBe(200);
    const body = bodyOf(res);
    expect(body).toContain("var DEFAULT_PIXEL_ID = '1122334455'");
    expect(body).not.toContain('__DEFAULT_PIXEL_ID__');
    expect(body).not.toContain('1465457801784141');
    // Logika atribusi tetap utuh.
    expect(body).toContain('TRACKED_PARAMS');
    expect(body).toContain("var CTA_PATH = '/cta'");
  });

  it('tenant non-default tanpa pixel → kosong, tidak meminjam env default', async () => {
    process.env.FB_PIXEL_ID = '9988776655';
    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({ meta_pixel_id: null } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/assets/external-tracker.js?tenant=tenant-b',
    });

    const body = bodyOf(res);
    expect(body).toContain("var DEFAULT_PIXEL_ID = ''");
    expect(body).not.toContain('9988776655');
  });

  it('tanpa hint → fallback env hanya untuk default-tenant', async () => {
    process.env.FB_PIXEL_ID = '9988776655';
    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({ meta_pixel_id: null } as any);

    const res = await app.inject({ method: 'GET', url: '/assets/external-tracker.js' });

    expect(bodyOf(res)).toContain("var DEFAULT_PIXEL_ID = '9988776655'");
  });

  it('nilai pixel tidak valid dari DB diabaikan (anti-injection)', async () => {
    process.env.FB_PIXEL_ID = '9988776655';
    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
      meta_pixel_id: "123');alert(1);//",
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/assets/external-tracker.js?tenant=tenant-b',
    });

    const body = bodyOf(res);
    expect(body).toContain("var DEFAULT_PIXEL_ID = ''");
    expect(body).not.toContain('alert(1)');
  });

  it('DB offline → env fallback (fail-open, perilaku lama)', async () => {
    process.env.FB_PIXEL_ID = '9988776655';
    vi.spyOn(prisma.tenant, 'findFirst').mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({ method: 'GET', url: '/assets/external-tracker.js' });

    expect(bodyOf(res)).toContain("var DEFAULT_PIXEL_ID = '9988776655'");
  });
});

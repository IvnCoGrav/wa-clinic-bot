import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

import { __clearPricelistPromoCacheForTest } from '../../src/config/pricelist-promo';
import { __clearBrandCacheForTest } from '../../src/config/brand';

describe('Admin Settings — Pricelist Promo & Brand Logo API', () => {
  const app = buildApp();
  const adminKey = 'test_admin_key_promo';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = adminKey;
    __clearPricelistPromoCacheForTest();
    __clearBrandCacheForTest();
  });

  it('1. GET /api/admin/settings/pricelist-promo mengembalikan config promo & logo', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: DEFAULT_TENANT_ID,
      settings: {
        promo: {
          enabled: true,
          delaySeconds: 10,
          discountPercent: 15,
          instagramAccount: 'kalababyspa',
          badgeTitle: 'Spesial 15%',
          badgeSubtitle: 'Diskon Treatment',
          modalTitle: 'Syarat & Ketentuan',
          modalDescription: 'Follow IG kami',
          rules: [{ title: 'Follow', body: 'Follow IG' }],
          claimMessageTemplate: 'Klaim diskon {discount}%',
        },
        brand: {
          logoUrl: '/assets/kala-logo.svg',
        },
      },
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/pricelist-promo',
      headers: {
        'x-api-key': adminKey,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.promo.enabled).toBe(true);
    expect(body.data.promo.discountPercent).toBe(15);
    expect(body.data.brandLogoUrl).toBe('/assets/kala-logo.svg');
    expect(body.data.defaults).toBeDefined();
    expect(body.data.defaults.enabled).toBe(false);
  });

  it('2. PUT menolak brandLogoUrl yang bukan URL http(s) atau /assets/...', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/pricelist-promo',
      headers: {
        'x-api-key': adminKey,
      },
      payload: {
        brandLogoUrl: 'javascript:alert(1)',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('brandLogoUrl');
  });

  it('3. PUT berhasil menyimpan dan clamp nilai promo serta memperbarui logoUrl', async () => {
    let savedSettings: any = null;
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      settings: {
        brand: { businessName: 'Kala Spa' },
      },
    } as any);

    vi.mocked(prisma.tenant.update).mockImplementationOnce(async (args: any) => {
      savedSettings = args.data.settings;
      return { id: DEFAULT_TENANT_ID, settings: savedSettings } as any;
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/pricelist-promo',
      headers: {
        'x-api-key': adminKey,
      },
      payload: {
        brandLogoUrl: 'https://example.com/logo.png',
        promo: {
          enabled: true,
          delaySeconds: 999, // Harus di-clamp ke 60
          discountPercent: 120, // Harus di-clamp ke 100
          instagramAccount: '@klinik_resmi', // Harus di-strip @
          badgeTitle: 'Promo Ajaib',
          badgeSubtitle: 'Subjudul',
          modalTitle: 'Judul Modal',
          modalDescription: 'Deskripsi',
          rules: [{ title: 'Aturan 1', body: 'Detail' }],
          claimMessageTemplate: 'Halo klaim {discount}',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.promo.delaySeconds).toBe(60);
    expect(body.data.promo.discountPercent).toBe(100);
    expect(body.data.promo.instagramAccount).toBe('klinik_resmi');
    expect(body.data.brandLogoUrl).toBe('https://example.com/logo.png');

    expect(savedSettings).toBeDefined();
    expect(savedSettings.brand.logoUrl).toBe('https://example.com/logo.png');
    expect(savedSettings.brand.businessName).toBe('Kala Spa');
    expect(savedSettings.promo.discountPercent).toBe(100);
  });
});

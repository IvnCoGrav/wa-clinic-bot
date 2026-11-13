import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * Ar-004 lanjutan — resolusi landing per tenant:
 * - `?tenant=<id|slug>` (diverifikasi DB) → filter tenant
 * - host `Tenant.landing_domain` → filter tenant
 * - tanpa hint/host → mode slug-global lama (tanpa filter tenant)
 */
const app = buildApp();

function stubTenantLookup() {
  return vi.spyOn(prisma.tenant, 'findFirst').mockImplementation((async (args: any) => {
    const where = args?.where || {};
    if (where.id === 'tenant-a') return { id: 'tenant-a' } as any;
    if (Array.isArray(where.OR)) {
      const hint = where.OR[0]?.id || where.OR[0]?.slug;
      if (hint === 'tenant-a') return { id: 'tenant-a' } as any;
      return null;
    }
    if (where.landing_domain === 'promo.klinik-b.com') return { id: 'tenant-b' } as any;
    return null;
  }) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);
});

describe('resolusi landing per tenant', () => {
  it('host landing_domain → filter tenant_id', async () => {
    stubTenantLookup();
    const landingSpy = vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/promo-baby',
      headers: { host: 'promo.klinik-b.com' },
    });

    expect(res.statusCode).toBe(404); // tidak ada konten di mock
    const where = (landingSpy.mock.calls[0][0] as any).where;
    expect(where).toMatchObject({ slug: 'promo-baby', is_active: true, tenant_id: 'tenant-b' });
  });

  it('?tenant= (terverifikasi) mengalahkan host', async () => {
    stubTenantLookup();
    const landingSpy = vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);

    await app.inject({
      method: 'GET',
      url: '/promo-baby?tenant=tenant-a',
      headers: { host: 'promo.klinik-b.com' },
    });

    const where = (landingSpy.mock.calls[0][0] as any).where;
    expect(where.tenant_id).toBe('tenant-a');
  });

  it('tanpa hint/host → mode slug-global (tanpa filter tenant)', async () => {
    stubTenantLookup();
    const landingSpy = vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);

    await app.inject({ method: 'GET', url: '/promo-baby' });

    const where = (landingSpy.mock.calls[0][0] as any).where;
    expect(where.tenant_id).toBeUndefined();
  });

  it('hint tenant tak dikenal TIDAK dipakai (fallback slug-global)', async () => {
    // stub: tenant.findFirst selalu null → hint tak terverifikasi.
    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue(null);
    const landingSpy = vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);

    await app.inject({ method: 'GET', url: '/promo-baby?tenant=tenant-palsu' });

    const where = (landingSpy.mock.calls[0][0] as any).where;
    expect(where.tenant_id).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * Fase 3a (issue #136): resolusi TENANT PageView — bukan lagi hardcode default-tenant.
 * Sumber tenant (berurutan otoritas, satu query per beacon, fail-open):
 *   1. Hint dari script tag `external-tracker.js?tenant=<id|slug>` (dikirim beacon)
 *      → TERVERIFIKASI ke DB (OR id/slug); hint tak dikenal → default-tenant (anti-spoof).
 *   2. Tanpa hint → resolusi otoritatif dari host `landingUrl` vs `Tenant.landing_domain`.
 *   3. DB offline → hint apa adanya, atau default-tenant (fail-open).
 */
describe('PageView Tenant Resolution (Fase 3a)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    (prisma as any).landingPageView = { create: vi.fn().mockResolvedValue({ id: 'lpv_1' }) };
    (prisma.tenant.findFirst as any) = vi.fn();
    (prisma.tenant as any).findMany = vi.fn();
  });

  const post = (payload: Record<string, unknown>, ua = 'Mozilla/5.0 (Android 14)') =>
    app.inject({
      method: 'POST',
      url: '/api/tracking/pageview',
      headers: { 'user-agent': ua },
      payload: { landingUrl: 'https://example.com/x', ...payload },
    });

  it('1. hint tenantSlug valid → tenant_id hasil verifikasi DB (bukan hint mentah)', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce({ id: 'tenant-x' } as any);

    const res = await post({ tenantSlug: 'promo-test' });
    expect(res.statusCode).toBe(200);
    expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'promo-test' }, { slug: 'promo-test' }] },
      select: { id: true },
    });
    expect((prisma as any).landingPageView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenant_id: 'tenant-x' }),
    });
  });

  it('2. hint tak dikenal (tenantId asing) → TOLAK, dipaksa default-tenant (anti-spoof)', async () => {
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce(null as any);

    await post({ tenantId: 'tenant-asing-yang-tidak-ada' });
    expect((prisma as any).landingPageView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenant_id: 'default-tenant' }),
    });
  });

  it('3. tanpa hint → resolusi host landingUrl vs Tenant.landing_domain (data-driven)', async () => {
    vi.mocked((prisma.tenant as any).findMany).mockResolvedValueOnce([
      { id: 'tenant-lp', landing_domain: 'https://lp-klien.example.com' },
      { id: 'default-tenant', landing_domain: null },
    ] as any);

    await post({ landingUrl: 'https://lp-klien.example.com/promo?fbclid=abc' });
    expect((prisma.tenant as any).findMany).toHaveBeenCalledWith({
      where: { landing_domain: { not: null } },
      select: { id: true, landing_domain: true },
    });
    expect((prisma as any).landingPageView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenant_id: 'tenant-lp' }),
    });
  });

  it('4. host landingUrl tidak cocok tenant mana pun → default-tenant', async () => {
    vi.mocked((prisma.tenant as any).findMany).mockResolvedValueOnce([
      { id: 'tenant-lp', landing_domain: 'https://lp-klien.example.com' },
    ] as any);

    await post({ landingUrl: 'https://situs-asing.example.org/x' });
    expect((prisma as any).landingPageView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenant_id: 'default-tenant' }),
    });
  });

  it('5. DB offline saat resolusi → fail-open: hint dipertahankan, baris tetap tersimpan', async () => {
    vi.mocked(prisma.tenant.findFirst).mockRejectedValueOnce(new Error('Database offline') as any);

    const res = await post({ tenantId: 'tenant-x' });
    expect(res.statusCode).toBe(200);
    expect((prisma as any).landingPageView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenant_id: 'tenant-x' }),
    });
  });

  it('6. asset tracker mengandung pengiriman tenantId + pembacaan param script tag ?tenant=', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/external-tracker.js' });
    expect(res.statusCode).toBe(200);
    // Payload beacon menyertakan tenantId dari param script tag
    expect(res.body).toContain('tenantId: getScriptTenant()');
    // Param script tag yang dibaca: ?tenant= (varian tenant_id/tenantId)
    expect(res.body).toContain("'tenant', 'tenant_id', 'tenantId'");
  });
});

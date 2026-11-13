import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { resolveLandingContent } from '../../src/services/landing-content.service';

/**
 * M-05 — slug landing tak dikenal harus 404 (null), bukan menyajikan landing
 * milik tenant PERTAMA di database.
 */
describe('resolveLandingContent — slug tak dikenal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tidak fallback ke tenant pertama saat slug tidak cocok', async () => {
    vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);
    const tenantFind = vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue(null);

    const result = await resolveLandingContent('slug-tidak-ada-xyz');

    expect(result).toBeNull();
    // Hanya satu lookup tenant (by slug/id). Tidak boleh ada query tanpa WHERE
    // yang mengambil tenant sembarang.
    expect(tenantFind).toHaveBeenCalledTimes(1);
    const where = (tenantFind.mock.calls[0][0] as any)?.where;
    expect(where).toEqual({ OR: [{ slug: 'slug-tidak-ada-xyz' }, { id: 'slug-tidak-ada-xyz' }] });
  });

  it('tenant yang cocok tetap dikembalikan (perilaku normal)', async () => {
    vi.spyOn(prisma.landingPage, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
      id: 'tenant-b',
      slug: 'klinik-b',
      name: 'Klinik B',
      whatsapp_number: '628111',
      meta_pixel_id: null,
      landing_type: 'STRUCTURED_JSON',
      landing_content: { headline: 'Halo B' },
      raw_html_content: null,
    } as any);

    const result = await resolveLandingContent('klinik-b');

    expect(result).not.toBeNull();
    expect(result?.tenant_id).toBe('tenant-b');
    expect(result?.headline).toBe('Halo B');
  });
});

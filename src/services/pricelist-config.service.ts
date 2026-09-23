import { prisma } from '../db/client';

/**
 * pricelist-config.service.ts — Konfigurasi gambar pricelist per-tenant.
 *
 * Sumber gambar pricelist (urutan prioritas):
 *   1. `tenants.pricelist_image_url` (DB, per-tenant — diatur dari Admin Dashboard)
 *   2. env `CLINIC_PRICELIST_IMAGE_URL`
 *   3. aset default `assets/pricelist_spa.jpg`
 *
 * Sumber bisa berupa:
 *   - URL publik (http/https)         → dipakai langsung (WAHA & WABA)
 *   - relative `/media/outbound/...`  → diselesaikan per provider:
 *       WAHA → path file lokal; WABA → URL publik (butuh PUBLIC_BASE_URL)
 *   - path file lokal lain            → WAHA: path langsung; WABA: null (tak bisa)
 */

export const DEFAULT_PRICELIST_IMAGE = 'assets/pricelist_spa.jpg';

/** URL/sumber gambar pricelist mentah (belum di-resolve per provider). */
export async function getPricelistImageUrl(tenantId: string): Promise<string> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { pricelist_image_url: true },
    });
    if (tenant?.pricelist_image_url) return tenant.pricelist_image_url;
  } catch {
    // DB offline → lanjut ke fallback env/aset
  }
  return process.env.CLINIC_PRICELIST_IMAGE_URL || DEFAULT_PRICELIST_IMAGE;
}

/** Menyimpan/menghapus pricelist_image_url per-tenant (null = hapus → fallback). */
export async function setPricelistImageUrl(tenantId: string, url: string | null): Promise<{ success: boolean; url: string | null }> {
  const updated = await prisma.tenant.upsert({
    where: { id: tenantId },
    create: {
      id: tenantId,
      slug: tenantId,
      name: `Tenant ${tenantId}`,
      pricelist_image_url: url,
    },
    update: { pricelist_image_url: url },
    select: { pricelist_image_url: true },
  });
  return { success: true, url: updated.pricelist_image_url };
}

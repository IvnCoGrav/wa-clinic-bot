import path from 'path';
import { prisma } from '../db/client';
import { mediaService } from './media.service';

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

export interface PricelistImageAssets {
  /** Sumber HD (DB → env → aset default), belum dipetakan ke URL tampilan. */
  hd: string;
  /** URL thumbnail 640px untuk dashboard; null bila tidak tersedia. */
  thumbUrl: string | null;
}

/**
 * Ambil aset pricelist (HD + thumbnail) dalam satu pembacaan.
 *
 * PENTING: thumbnail TIDAK dibuat ulang di sini — hanya lookup file yang sudah
 * dibuat sekali saat upload (`saveOutboundMedia`). Pricelist dikecualikan dari
 * pruning media, sehingga thumbnail tetap tersedia.
 */
export async function getPricelistImageAssets(tenantId: string): Promise<PricelistImageAssets> {
  const hd = await getPricelistImageUrl(tenantId);
  const thumbUrl = hd.startsWith('/media/') ? mediaService.resolveThumbRelativeUrl(hd) : null;
  return { hd, thumbUrl };
}

/**
 * URL tampilan dashboard untuk gambar pricelist:
 * - URL absolut http(s) → dipakai apa adanya
 * - path `/media/...`    → dipakai apa adanya
 * - path file lain       → `/media/asset/<basename>` (aset statis)
 */
export function toPricelistDisplayUrl(hd: string): string {
  try {
    const u = new URL(hd);
    if (u.protocol === 'http:' || u.protocol === 'https:') return hd;
  } catch {
    // bukan URL absolut → lanjut ke pemetaan path
  }
  if (hd.startsWith('/media/')) return hd;
  return `/media/asset/${path.basename(hd)}`;
}

/**
 * Menyelesaikan sumber gambar pricelist menjadi target yang bisa dikirim
 * gateway (WAHA: path/URL; WABA: URL publik). Mengembalikan null jika tak
 * bisa di-resolve untuk provider tersebut.
 *
 * Sumber (prioritas: DB tenant → env → aset default) bisa berupa:
 *   - URL publik http(s)          → dipakai langsung (WAHA & WABA)
 *   - relative `/media/outbound/…` → per-provider via mediaService
 *   - path file lokal lain        → WAHA: langsung; WABA: null (tak bisa)
 */
export async function resolvePricelistImageTarget(
  tenantId: string,
  provider: 'WAHA' | 'WABA'
): Promise<string | null> {
  const raw = await getPricelistImageUrl(tenantId);
  if (!raw) return null;
  // Deteksi skema URL via API standar (bukan regex hafalan pola kalimat).
  let isPublicUrl = false;
  try {
    const u = new URL(raw);
    isPublicUrl = u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    isPublicUrl = false;
  }
  if (isPublicUrl) return raw;
  if (raw.startsWith('/media/outbound/')) {
    return mediaService.resolveOutboundForProvider(raw, provider);
  }
  // Path file lokal: WAHA bisa kirim langsung; WABA butuh URL publik yang
  // tidak tersedia untuk path sembarang → gagal eksplisit.
  if (provider === 'WAHA') return raw;
  return null;
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

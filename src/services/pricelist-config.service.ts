import { prisma } from '../db/client';
import { mediaService } from './media.service';
import fs from 'fs';

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

/**
 * Menyelesaikan sumber gambar pricelist menjadi target yang bisa dikirim
 * gateway (WAHA: path/URL; WABA: URL publik). Mengembalikan null jika tak
 * bisa di-resolve untuk provider tersebut.
 */
export async function resolvePricelistImageTarget(
  tenantId: string,
  provider: 'WAHA' | 'WABA'
): Promise<string | null> {
  const raw = await getPricelistImageUrl(tenantId);
  if (/^https?:\/\//i.test(raw)) return raw;

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
  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: { pricelist_image_url: url },
    select: { pricelist_image_url: true },
  });
  return { success: true, url: updated.pricelist_image_url };
}

/**
 * Menghasilkan versi ringan (1/3 dimensi) gambar pricelist untuk dikirim via
 * gateway. Gambar di-resize server-side (sharp), lalu disimpan ke media
 * outbound tenant sehingga terintegrasi dengan kuota media (MQL) & retensi
 * media chat (pembersihan otomatis), dan bisa dikirim WAHA (path lokal) maupun
 * WABA (URL publik). Mengembalikan null jika sumber tak bisa dibaca.
 */
export async function resolvePricelistSendTarget(
  tenantId: string,
  provider: 'WAHA' | 'WABA'
): Promise<string | null> {
  try {
    const raw = await getPricelistImageUrl(tenantId);

    let buffer: Buffer;
    if (/^https?:\/\//i.test(raw)) {
      const res = await fetch(raw);
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
    } else if (raw.startsWith('/media/outbound/')) {
      const abs = mediaService.filePathFromRelativeUrl(raw);
      if (!abs) return null;
      buffer = fs.readFileSync(abs);
    } else {
      buffer = fs.readFileSync(raw); // path file lokal
    }

    // 1/3 dimensi (minimal 120px agar tetap terbaca) + inline MQL & retensi.
    const resized = await mediaService.resizeImageToFraction(buffer, 3);

    const saved = await mediaService.saveOutboundMedia({
      tenantId,
      imageB64: resized.toString('base64'),
      mimeType: 'image/jpeg',
      fileName: `pricelist-${Date.now()}.jpg`,
    });
    return mediaService.resolveOutboundForProvider(saved.hdUrl, provider);
  } catch (err: any) {
    console.error('[PRICELIST] Gagal membuat versi kecil pricelist:', err?.message || err);
    return null;
  }
}

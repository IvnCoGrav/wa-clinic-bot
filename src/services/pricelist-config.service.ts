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

    let input: string | Buffer;
    if (/^https?:\/\//i.test(raw)) {
      const res = await fetch(raw);
      if (!res.ok) return null;
      input = Buffer.from(await res.arrayBuffer());
    } else if (raw.startsWith('/media/outbound/')) {
      const abs = mediaService.filePathFromRelativeUrl(raw);
      if (!abs) return null;
      input = abs;
    } else {
      input = raw; // path file lokal
    }

    const sharp = (await import('sharp')).default;
    const meta = await sharp(input, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return null;

    // 1/3 dari dimensi terpanjang (minimal 120px agar tetap terbaca).
    const maxDim = Math.max(meta.width, meta.height);
    const targetDim = Math.max(120, Math.round(maxDim / 3));
    const resized = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: targetDim, height: targetDim, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

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

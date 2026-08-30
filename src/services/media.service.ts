import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

// Root penyimpanan media lokal. Folder sudah digitignore (storage/).
const MEDIA_ROOT = path.join(process.cwd(), 'storage', 'media');

// Mime type gambar yang diizinkan untuk dikirim/ditampilkan Live Chat.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const MAX_OUTBOUND_BYTES = 8 * 1024 * 1024; // 8 MB
const DEFAULT_QUOTA_BYTES = 200 * 1024 * 1024; // 200 MB per tenant
const DEFAULT_MESSAGE_RETENTION_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SavedMedia {
  scope: 'outbound' | 'inbound';
  tenantId: string;
  hdPath: string; // absolute path file HD di storage (untuk pengiriman WAHA)
  hdUrl: string; // relative URL publik/dashboard utk file HD
  thumbUrl: string | null; // relative URL thumbnail low-res (utk tampilan)
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'jpg';
  }
}

function scopeDir(scope: 'outbound' | 'inbound', tenantId: string): string {
  const dir = path.join(MEDIA_ROOT, scope, tenantId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toRelativeUrl(scope: 'outbound' | 'inbound', tenantId: string, filename: string): string {
  return `/media/${scope}/${tenantId}/${filename}`;
}

// Konvensi penamaan: HD `{stem}.jpg` → thumb `{stem}_thumb.jpg`.
function withThumbName(filename: string): string {
  return filename.replace(/(\.\w+)$/, '_thumb$1');
}

function isThumbName(filename: string): boolean {
  return /_thumb\.\w+$/.test(filename);
}

/**
 * MediaService: simpan & bersihkan gambar Live Chat.
 * - Outbound: admin kirim gambar → storage/media/outbound/<tenantId>/ (folder publik,
 *   dibutuhkan Meta/WABA & WAHA utk mengambil file).
 * - Inbound: gambar customer → storage/media/inbound/<tenantId>/ (folder privat,
 *   hanya bisa diakses dashboard via cookie admin session).
 * - Retensi berjenjang per-tenant:
 *   1) media_retention_days (default 30): file HD dihapus, diganti blur thumb (~10KB)
 *      yang dipertahankan supaya pratinjau history tidak rusak. Gambar pricelist
 *      (tenants.pricelist_image_url) dikecualikan — permanen.
 *   2) message_retention_days (default 120): record pesan (teks chat) dihapus beserta
 *      file media yang yatim. Customer & conversation (data CRM) tetap dipertahankan.
 * - Kuota: media_quota_bytes (default 200 MB/tenant) dihitung outbound + inbound.
 */
export class MediaService {
  /**
   * Menyimpan gambar outbound (HD + thumbnail) yang diupload admin.
   * imageB64 dan thumbB64 berupa data URI atau raw base64.
   * Bila thumbB64 tidak diberikan, blur thumbnail dibuat server-side via sharp.
   */
  public async saveOutboundMedia(params: {
    tenantId: string;
    imageB64: string;
    thumbB64?: string;
    mimeType?: string;
    fileName?: string;
  }): Promise<SavedMedia> {
    const { tenantId, imageB64, thumbB64, mimeType } = params;
    const mime = mimeType && ALLOWED_MIME.has(mimeType) ? mimeType : 'image/jpeg';
    const ext = extFromMime(mime);

    const hdBuf = this.decodeBase64(imageB64);
    if (hdBuf.length > MAX_OUTBOUND_BYTES) {
      throw new Error(`Gambar terlalu besar (maks ${MAX_OUTBOUND_BYTES / (1024 * 1024)} MB).`);
    }
    await this.enforceQuota(tenantId, hdBuf.length);

    const dir = scopeDir('outbound', tenantId);
    const stem = randomUUID().replace(/-/g, '');
    const hdFile = `${stem}.${ext}`;
    const hdPath = path.join(dir, hdFile);
    fs.writeFileSync(hdPath, hdBuf);

    let thumbUrl: string | null = null;
    if (thumbB64) {
      const thumbFile = `${stem}_thumb.${ext}`;
      try {
        fs.writeFileSync(path.join(dir, thumbFile), this.decodeBase64(thumbB64));
        thumbUrl = toRelativeUrl('outbound', tenantId, thumbFile);
      } catch {
        // thumbnail opsional — gagal ditulis tidak menghalangi kirim HD
      }
    } else {
      const blur = await this.createBlurThumb(hdBuf, mime);
      if (blur) {
        const thumbFile = `${stem}_thumb.jpg`;
        try {
          fs.writeFileSync(path.join(dir, thumbFile), blur.data);
          thumbUrl = toRelativeUrl('outbound', tenantId, thumbFile);
        } catch {
          // best-effort
        }
      }
    }

    return {
      scope: 'outbound',
      tenantId,
      hdPath,
      hdUrl: toRelativeUrl('outbound', tenantId, hdFile),
      thumbUrl,
    };
  }

  /**
   * Menulis media inbound (gambar dari customer) menjadi file lokal (HD + blur thumb).
   */
  public async saveInboundMedia(params: {
    tenantId: string;
    buffer: Buffer;
    mimeType?: string;
  }): Promise<{ hdPath: string; hdUrl: string; thumbPath: string | null; thumbUrl: string | null }> {
    const { tenantId, buffer, mimeType } = params;
    const mime = mimeType && ALLOWED_MIME.has(mimeType) ? mimeType : 'image/jpeg';
    const ext = extFromMime(mime);

    await this.enforceQuota(tenantId, buffer.length);

    const dir = scopeDir('inbound', tenantId);
    const stem = randomUUID().replace(/-/g, '');
    const file = `${stem}.${ext}`;
    const hdPath = path.join(dir, file);
    fs.writeFileSync(hdPath, buffer);

    let thumbPath: string | null = null;
    let thumbUrl: string | null = null;
    const blur = await this.createBlurThumb(buffer, mime);
    if (blur) {
      const thumbFile = `${stem}_thumb.jpg`;
      try {
        thumbPath = path.join(dir, thumbFile);
        fs.writeFileSync(thumbPath, blur.data);
        thumbUrl = toRelativeUrl('inbound', tenantId, thumbFile);
      } catch {
        // best-effort
      }
    }

    return { hdPath, hdUrl: toRelativeUrl('inbound', tenantId, file), thumbPath, thumbUrl };
  }

  /**
   * Generate blur thumbnail (~10KB, JPEG) server-side via sharp.
   * Best-effort: null bila gagal (mis. file korup / sharp tidak tersedia).
   */
  public async createBlurThumb(
    buffer: Buffer,
    _mimeType?: string
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer, { failOn: 'none' }).metadata();
      if (!meta.width || !meta.height) return null;

      let pipeline = sharp(buffer, { failOn: 'none' });
      if (meta.width > 640 || meta.height > 640) {
        pipeline = pipeline.resize({ width: 640, withoutEnlargement: true });
      }
      const data = await pipeline.jpeg({ quality: 80 }).toBuffer();
      if (!data || data.length === 0) return null;
      return { data, mimeType: 'image/jpeg' };
    } catch (err: any) {
      console.warn('[MEDIA] Gagal generate thumbnail:', err?.message || err);
      return null;
    }
  }

  /**
   * Mengompres gambar agar dimensi terpanjangnya tidak melebihi maxDim (JPEG q80).
   * Gambar yang sudah ≤ maxDim dikembalikan apa adanya (tanpa re-encode).
   * Dipakai untuk bukti bayar & media penting lain — hemat MQL & beban server.
   */
  public async resizeImageToMax(buffer: Buffer, maxDim: number, quality = 80): Promise<Buffer> {
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer, { failOn: 'none' }).metadata();
      if (!meta.width || !meta.height) return buffer;
      const longest = Math.max(meta.width, meta.height);
      if (longest <= maxDim) return buffer;
      return await sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    } catch (err: any) {
      console.warn('[MEDIA] Gagal resize gambar (dikirim asli):', err?.message || err);
      return buffer;
    }
  }

  /**
   * Mengompres gambar menjadi 1/divisor dari dimensi terpanjang (JPEG q80,
   * minimal 120px agar tetap terbaca). Dipakai pricelist — konsisten dengan
   * versi kecil yang dikirim ke WhatsApp.
   */
  public async resizeImageToFraction(buffer: Buffer, divisor: number, quality = 80): Promise<Buffer> {
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer, { failOn: 'none' }).metadata();
      if (!meta.width || !meta.height) return buffer;
      const targetDim = Math.max(120, Math.round(Math.max(meta.width, meta.height) / divisor));
      return await sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: targetDim, height: targetDim, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    } catch (err: any) {
      console.warn('[MEDIA] Gagal resize pecahan gambar (dikirim asli):', err?.message || err);
      return buffer;
    }
  }

  /**
   * Menuliskan badge / watermark semi-transparan berisi koordinat GPS,
   * timestamp waktu, dan catatan patokan di atas foto rumah pasien.
   */
  public async overlayGpsBadge(
    buffer: Buffer,
    info: {
      lat?: number | null;
      lng?: number | null;
      customerName?: string | null;
      address?: string | null;
      kelurahan?: string | null;
      kecamatan?: string | null;
      landmark?: string | null;
      takerName?: string | null;
      staffName?: string | null;
      brandName?: string | null;
      timestamp?: string;
    }
  ): Promise<Buffer> {
    const hasCoords = info.lat != null && info.lng != null;
    const cleanCust = (info.customerName || '').replace(/[<>&'"]/g, '').trim();
    const cleanKel = (info.kelurahan || '').replace(/[<>&'"]/g, '').trim();
    const cleanKec = (info.kecamatan || '').replace(/[<>&'"]/g, '').trim();
    const cleanLandmark = (info.landmark || '').replace(/[<>&'"]/g, '').trim();
    const cleanTaker = (info.takerName || info.staffName || '').replace(/[<>&'"]/g, '').trim();
    const cleanBrand = (info.brandName || 'Kala Moms & Baby').replace(/[<>&'"]/g, '').trim();

    if (!hasCoords && !cleanKel && !cleanKec && !cleanLandmark && !cleanCust) return buffer;

    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer, { failOn: 'none' }).metadata();
      const width = meta.width || 800;
      const height = meta.height || 600;

      const dateObj = new Date();
      const timeStr =
        info.timestamp ||
        dateObj.toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Jakarta',
        }) + ' WIB';

      let areaText = '';
      if (cleanKel && cleanKec) {
        areaText = ` · Kel. ${cleanKel}, Kec. ${cleanKec}`;
      } else if (cleanKel || cleanKec) {
        areaText = ` · ${cleanKel || cleanKec}`;
      }

      const custPrefix = cleanCust ? `Bunda ${cleanCust} · ` : '';

      let latLngText = `Panduan Lokasi ${cleanCust ? 'Bunda ' + cleanCust : 'Pasien'}`;
      if (hasCoords) {
        const latStr = Number(info.lat).toFixed(6);
        const lngStr = Number(info.lng).toFixed(6);
        latLngText = `GPS: ${latStr}, ${lngStr} · ${custPrefix}${cleanKel || cleanKec ? 'Kel. ' + cleanKel + ', Kec. ' + cleanKec : ''}`.replace(/ · $/, '');
      } else if (areaText) {
        latLngText = `${custPrefix}Area:${areaText}`;
      }

      const subParts: string[] = [];
      if (cleanTaker) subParts.push(`Foto: ${cleanTaker}`);
      if (cleanLandmark) {
        const truncated = cleanLandmark.length > 40 ? cleanLandmark.slice(0, 37) + '...' : cleanLandmark;
        subParts.push(`Patokan: ${truncated}`);
      }
      subParts.push(timeStr);
      const subText = subParts.join(' · ');

      const bannerHeight = 58;
      const bannerY = height - bannerHeight;

      const svgOverlay = Buffer.from(`
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .title { font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; font-size: 13px; font-weight: bold; fill: #ffffff; }
            .sub { font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; font-size: 11px; fill: #cbd5e1; }
            .brand { font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; font-size: 11px; font-weight: bold; fill: #2dd4bf; }
          </style>
          <rect x="0" y="${bannerY}" width="${width}" height="${bannerHeight}" fill="#0f172a" fill-opacity="0.88"/>
          <rect x="0" y="${bannerY}" width="${width}" height="3" fill="#00a884"/>
          <circle cx="18" cy="${bannerY + 20}" r="5" fill="#22c55e" />
          <text x="30" y="${bannerY + 24}" class="title">${latLngText}</text>
          <text x="${width - 15}" y="${bannerY + 24}" text-anchor="end" class="brand">🌸 ${cleanBrand}</text>
          <text x="30" y="${bannerY + 45}" class="sub">${subText}</text>
        </svg>
      `);

      return await sharp(buffer, { failOn: 'none' })
        .rotate()
        .composite([{ input: svgOverlay, top: 0, left: 0 }])
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch (err: any) {
      console.warn('[MEDIA] Gagal overlay GPS badge (tetap gunakan gambar asli):', err?.message || err);
      return buffer;
    }
  }

  /**
   * Mengonversi relative URL /media/... menjadi:
   * - path absolut lokal   → untuk pengiriman via WAHA (client membaca file langsung)
   * - URL publik penuh     → untuk pengiriman via WABA (Meta fetch link)
   */
  public resolveOutboundForProvider(relativeUrl: string, provider: 'WAHA' | 'WABA'): string | null {
    if (!relativeUrl.startsWith('/media/outbound/')) return null;
    if (provider === 'WABA') {
      return this.getPublicMediaUrl(relativeUrl);
    }
    const hdPath = this.filePathFromRelativeUrl(relativeUrl);
    return hdPath;
  }

  /**
   * Mengubah relative URL /media/... menjadi absolute path di filesystem.
   */
  public filePathFromRelativeUrl(relativeUrl: string): string | null {
    const match = relativeUrl.match(/^\/media\/(outbound|inbound)\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    return path.join(MEDIA_ROOT, match[1], match[2], match[3]);
  }

  /**
   * Melakukan stream file media ke Response (published via HTTP handler).
   */
  public resolveRelativeUrl(scope: 'outbound' | 'inbound', tenantId: string, filename: string): string {
    return toRelativeUrl(scope, tenantId, filename);
  }

  /**
   * Menghapus file media dari disk berdasarkan relativeUrl /media/... (best-effort).
   */
  public deleteFile(relativeUrl: string): boolean {
    const abs = this.filePathFromRelativeUrl(relativeUrl);
    if (!abs) return false;
    try {
      fs.unlinkSync(abs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Mencabut retensi default via env atau default 30 hari.
   */
  public getEnvRetentionDays(): number {
    const n = parseInt(process.env.MEDIA_RETENTION_DAYS || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  /**
   * Membaca media_retention_days per tenant; fallback env bila DB offline / row tak ada.
   */
  public async getRetentionDays(tenantId: string): Promise<number> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant && tenant.media_retention_days > 0) return tenant.media_retention_days;
      return this.getEnvRetentionDays();
    } catch {
      return this.getEnvRetentionDays();
    }
  }

  /**
   * Kuota media per tenant (bytes). Sumber: tenants.media_quota_bytes → env
   * MEDIA_QUOTA_BYTES → default 200 MB. 0 = tanpa batas.
   */
  public async getQuotaBytes(tenantId: string): Promise<number> {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { media_quota_bytes: true },
      });
      if (tenant && tenant.media_quota_bytes > 0) return tenant.media_quota_bytes;
    } catch {
      // DB offline → fallback env/default
    }
    const n = parseInt(process.env.MEDIA_QUOTA_BYTES || '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_QUOTA_BYTES;
  }

  /**
   * Retensi pesan (teks chat) per tenant (hari). Sumber: tenants.message_retention_days
   * → env MESSAGE_RETENTION_DAYS → default 120.
   */
  public async getMessageRetentionDays(tenantId: string): Promise<number> {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { message_retention_days: true },
      });
      if (tenant && tenant.message_retention_days > 0) return tenant.message_retention_days;
    } catch {
      // DB offline → fallback env/default
    }
    const n = parseInt(process.env.MESSAGE_RETENTION_DAYS || '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MESSAGE_RETENTION_DAYS;
  }

  /**
   * Total byte media yang dipakai tenant (outbound + inbound) di disk.
   */
  public getTenantMediaUsageBytes(tenantId: string): number {
    let total = 0;
    for (const scope of ['outbound', 'inbound'] as const) {
      const base = path.join(MEDIA_ROOT, scope, tenantId);
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        try {
          total += fs.statSync(path.join(base, entry.name)).size;
        } catch {
          // best-effort
        }
      }
    }
    return total;
  }

  /**
   * Tolak penyimpanan bila melewati kuota media tenant.
   */
  private async enforceQuota(tenantId: string, newBytes: number): Promise<void> {
    const quota = await this.getQuotaBytes(tenantId);
    if (quota <= 0) return;
    const usage = this.getTenantMediaUsageBytes(tenantId);
    if (usage + newBytes > quota) {
      const quotaMb = Math.ceil(quota / (1024 * 1024));
      const usedMb = (usage / (1024 * 1024)).toFixed(1);
      throw new Error(`Kuota media tenant ${quotaMb} MB sudah penuh (terpakai ${usedMb} MB). Upload dibatalkan.`);
    }
  }

  /**
   * Hapus file media (outbound & inbound) yang umurnya > retentionDays (retensi 30 hari).
   * - HD lama dihapus, blur thumb dipertahankan (pratinjau history tidak rusak).
   * - File tanpa thumb dibuatkan blur thumb dulu; bila gagal, HD dipertahankan.
   * - Gambar pricelist (tenants.pricelist_image_url) dikecualikan — permanen.
   * - Referensi payload_raw.media pada pesan terkait diperbarui (hdUrl → null).
   * Best-effort: setiap langkah gagal tidak menghentikan proses.
   */
  public async deleteExpiredMedia(tenantId: string, retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * DAY_MS;
    let removed = 0;

    // Proteksi pricelist image (config tenant, bukan media chat history).
    let pricelistRel: string | undefined;
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { pricelist_image_url: true },
      });
      if (tenant?.pricelist_image_url) pricelistRel = tenant.pricelist_image_url;
    } catch {
      // DB offline → tanpa informasi proteksi
    }

    const processDir = async (scope: 'outbound' | 'inbound') => {
      const base = path.join(MEDIA_ROOT, scope, tenantId);
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const full = path.join(base, entry.name);

        // Thumbnail dikelola oleh purge pesan (message_retention_days), bukan retensi HD.
        if (isThumbName(entry.name)) continue;

        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.mtimeMs >= cutoff) continue; // belum kadaluarsa

        const relUrl = toRelativeUrl(scope, tenantId, entry.name);
        if (pricelistRel && relUrl === pricelistRel) continue; // pricelist permanen

        const thumbRel = await this.ensureThumbForHd(scope, tenantId, entry.name, full);
        if (!thumbRel) {
          console.warn(`[MEDIA RETENTION] HD tanpa ganti blur dipertahankan (gagal generate thumb): ${relUrl}`);
          continue;
        }

        try {
          fs.unlinkSync(full);
          removed++;
        } catch {
          continue;
        }
        await this.updateMediaRefsAfterHdDelete(tenantId, relUrl, thumbRel);
      }
    };

    await processDir('outbound');
    await processDir('inbound');
    return removed;
  }

  /**
   * Pastikan file HD punya blur thumb di disk (pakai yang ada atau generate baru).
   * Mengembalikan relative URL thumb, atau null bila gagal.
   */
  private async ensureThumbForHd(
    scope: 'outbound' | 'inbound',
    tenantId: string,
    hdName: string,
    hdFullPath: string
  ): Promise<string | null> {
    const thumbName = withThumbName(hdName);
    const thumbPath = path.join(path.dirname(hdFullPath), thumbName);
    if (fs.existsSync(thumbPath)) {
      return toRelativeUrl(scope, tenantId, thumbName);
    }
    try {
      const hdBuf = fs.readFileSync(hdFullPath);
      const blur = await this.createBlurThumb(hdBuf);
      if (!blur) return null;
      fs.writeFileSync(thumbPath, blur.data);
      return toRelativeUrl(scope, tenantId, thumbName);
    } catch {
      return null;
    }
  }

  /**
   * Perbarui referensi media pada pesan yang menunjuk ke HD yang baru dihapus:
   * hdUrl → null, dan url (legacy inbound) → thumbUrl agar pratinjau tidak putus.
   */
  private async updateMediaRefsAfterHdDelete(
    tenantId: string,
    hdRelUrl: string,
    thumbRelUrl: string
  ): Promise<void> {
    try {
      await prisma.message.updateMany({
        where: { tenant_id: tenantId, payload_raw: { path: ['media', 'hdUrl'], equals: hdRelUrl } },
        data: { payload_raw: { unset: ['media', 'hdUrl'] } },
      });
      await prisma.message.updateMany({
        where: { tenant_id: tenantId, payload_raw: { path: ['media', 'url'], equals: hdRelUrl } },
        data: { payload_raw: { path: ['media', 'url'], set: thumbRelUrl } },
      });
    } catch {
      // DB offline / best-effort
    }
  }

  /**
   * Hapus record pesan (teks chat) yang umurnya > messageRetentionDays (retensi 120 hari)
   * beserta file media yang hanya dirujuk pesan tersebut (thumb yatim).
   * Customer & conversation tetap dipertahankan. Best-effort saat DB offline.
   */
  public async deleteExpiredMessages(
    tenantId: string,
    retentionDays: number
  ): Promise<{ deleted: number; mediaFiles: number }> {
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
    let deleted = 0;
    let mediaFiles = 0;
    try {
      const oldMessages = await prisma.message.findMany({
        where: { tenant_id: tenantId, created_at: { lt: cutoff } },
        select: { payload_raw: true },
        take: 5000,
      });
      for (const m of oldMessages) {
        const media = (m.payload_raw as any)?.media;
        for (const u of [media?.hdUrl, media?.url, media?.thumbUrl]) {
          if (typeof u === 'string' && u.startsWith('/media/')) {
            if (this.deleteFile(u)) mediaFiles++;
          }
        }
      }
      const res = await prisma.message.deleteMany({
        where: { tenant_id: tenantId, created_at: { lt: cutoff } },
      });
      deleted = res?.count ?? 0;
    } catch {
      // DB offline → best-effort
    }
    return { deleted, mediaFiles };
  }

  /**
   * URL publik absolut untuk media (dibutuhkan WABA/Meta fetch).
   * Kembalikan null bila PUBLIC_BASE_URL tidak dikonfigurasi.
   */
  public getPublicMediaUrl(relativeUrl: string): string | null {
    const base = process.env.PUBLIC_BASE_URL;
    if (!base || !relativeUrl) return null;
    return `${base.replace(/\/$/, '')}${relativeUrl}`;
  }

  private decodeBase64(data: string): Buffer {
    const cleaned = data.includes(',') ? data.split(',')[1] : data;
    return Buffer.from(cleaned, 'base64');
  }
}

// Mengembalikan daftar tenant yang memiliki folder media di storage (best-effort).
export async function getAllTenantIds(): Promise<string[]> {
  try {
    const rows = await (await import('../db/client')).prisma.tenant.findMany({ select: { id: true } });
    if (rows.length > 0) return rows.map((r) => r.id);
  } catch {
    // DB offline → fallback ke tenant default saja
  }
  return [DEFAULT_TENANT_ID];
}

export const mediaService = new MediaService();

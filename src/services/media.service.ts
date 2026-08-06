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

/**
 * MediaService: simpan & bersihkan gambar Live Chat.
 * - Outbound: admin kirim gambar → storage/media/outbound/<tenantId>/ (folder publik,
 *   dibutuhkan Meta/WABA & WAHA utk mengambil file).
 * - Inbound: gambar customer → storage/media/inbound/<tenantId>/ (folder privat,
 *   hanya bisa diakses dashboard via cookie admin session).
 * - Retensi: media pasti dihapus otomatis setelah media_retention_days (per-tenant)
 *   melalui CronService.runMediaCleanup().
 */
export class MediaService {
  /**
   * Menyimpan gambar outbound (HD + thumbnail) yang diupload admin.
   * imageB64 dan thumbB64 berupa data URI atau raw base64.
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

    const dir = scopeDir('outbound', tenantId);
    const stem = randomUUID().replace(/-/g, '');
    const hdFile = `${stem}.${ext}`;
    const hdPath = path.join(dir, hdFile);
    fs.writeFileSync(hdPath, hdBuf);

    let thumbUrl: string | null = null;
    const thumbFile = `${stem}_thumb.${ext}`;
    if (thumbB64) {
      try {
        const thumbBuf = this.decodeBase64(thumbB64);
        fs.writeFileSync(path.join(dir, thumbFile), thumbBuf);
        thumbUrl = toRelativeUrl('outbound', tenantId, thumbFile);
      } catch {
        // thumbnail opsional — gagal ditulis tidak menghalangi kirim HD
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
   * Menulis media inbound (gambar dari customer) menjadi file lokal.
   */
  public async saveInboundMedia(params: {
    tenantId: string;
    buffer: Buffer;
    mimeType?: string;
  }): Promise<{ hdPath: string; hdUrl: string }> {
    const { tenantId, buffer, mimeType } = params;
    const mime = mimeType && ALLOWED_MIME.has(mimeType) ? mimeType : 'image/jpeg';
    const ext = extFromMime(mime);
    const dir = scopeDir('inbound', tenantId);
    const stem = randomUUID().replace(/-/g, '');
    const file = `${stem}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buffer);
    return { hdPath: path.join(dir, file), hdUrl: toRelativeUrl('inbound', tenantId, file) };
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
   * Hapus file media (outbound & inbound) yang umurnya > retentionDays.
   * Memindai recursively storage/media/*. Best-effort: setiap file dihapus via unlink.
   */
  public async deleteExpiredMedia(tenantId: string, retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          try {
            const st = fs.statSync(full);
            if (st.mtimeMs < cutoff) {
              fs.unlinkSync(full);
              removed++;
            }
          } catch { /* best-effort */ }
        }
      }
    };
    for (const scope of ['outbound', 'inbound'] as const) {
      const base = path.join(MEDIA_ROOT, scope, tenantId);
      if (fs.existsSync(base)) {
        walk(base);
      }
    }
    return removed;
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
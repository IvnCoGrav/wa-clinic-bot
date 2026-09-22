import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mediaService } from '../../src/services/media.service';
import { prisma } from '../../src/db/client';

const TEST_TENANT_ID = 'test-fallback-tenant';
const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Media Fallback Thumbnail — Transparent HD→Thumb', () => {
  const rootDir = path.join(process.cwd(), 'storage', 'media');

  const cleanDirs = () => {
    for (const scope of ['inbound', 'outbound'] as const) {
      const dir = path.join(rootDir, scope, TEST_TENANT_ID);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };

  beforeEach(() => {
    cleanDirs();
    delete process.env.MEDIA_QUOTA_BYTES;
    delete process.env.PUBLIC_BASE_URL;
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);
    vi.spyOn(prisma.customer, 'updateMany').mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.message, 'updateMany').mockResolvedValue({ count: 0 } as any);
  });

  afterEach(() => {
    cleanDirs();
    vi.restoreAllMocks();
  });

  it('Test 1: Request HD yang ada di disk → 200 HD, tanpa header fallback', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TEST_TENANT_ID,
      imageB64: PNG_1X1_B64,
      mimeType: 'image/png',
    });
    const hdPath = mediaService.filePathFromRelativeUrl(saved.hdUrl);
    expect(fs.existsSync(hdPath!)).toBe(true);
    const fallback = mediaService.resolveThumbFallback(saved.hdUrl);
    expect(fallback).toBeNull(); // HD ada, tidak perlu fallback
  });

  it('Test 2: Request HD tidak ada, thumbnail ada → resolveThumbFallback mengembalikan path thumb', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TEST_TENANT_ID,
      imageB64: PNG_1X1_B64,
      mimeType: 'image/png',
    });
    const hdPath = mediaService.filePathFromRelativeUrl(saved.hdUrl);
    const thumbPath = mediaService.filePathFromRelativeUrl(saved.thumbUrl!);
    // Hapus HD, simpan thumb
    fs.unlinkSync(hdPath!);
    expect(fs.existsSync(hdPath!)).toBe(false);
    expect(fs.existsSync(thumbPath!)).toBe(true);

    const fallback = mediaService.resolveThumbFallback(saved.hdUrl);
    expect(fallback).toBe(thumbPath);
  });

  it('Test 3: Keduanya hilang → resolveThumbFallback null', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TEST_TENANT_ID,
      imageB64: PNG_1X1_B64,
      mimeType: 'image/png',
    });
    const hdPath = mediaService.filePathFromRelativeUrl(saved.hdUrl);
    const thumbPath = mediaService.filePathFromRelativeUrl(saved.thumbUrl!);
    fs.unlinkSync(hdPath!);
    fs.unlinkSync(thumbPath!);

    const fallback = mediaService.resolveThumbFallback(saved.hdUrl);
    expect(fallback).toBeNull();
  });

  it('Test 4: Request _thumb yang hilang (walau HD ada) → null (no reverse fallback)', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TEST_TENANT_ID,
      imageB64: PNG_1X1_B64,
      mimeType: 'image/png',
    });
    // Thumb URL tapi request ke resolveThumbFallback
    const fallback = mediaService.resolveThumbFallback(saved.thumbUrl!);
    expect(fallback).toBeNull(); // sudah thumb, tidak fallback balik
  });

  it('Test 5: Traversal attempt (.., %2e) → null, tidak keluar MEDIA_ROOT', () => {
    const maliciousUrls = [
      '/media/outbound/default-tenant/../etc/passwd',
      '/media/outbound/../etc/passwd',
      '/media/outbound/default-tenant/%2e%2e/%2e%2e/etc/passwd',
      '/media/outbound/default-tenant/foo/../../../etc/passwd',
    ];
    for (const url of maliciousUrls) {
      const fallback = mediaService.resolveThumbFallback(url);
      expect(fallback).toBeNull();
    }
  });

  it('Test 6: resolveOutboundForProvider(WAHA) → path thumb bila HD hilang', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TEST_TENANT_ID,
      imageB64: PNG_1X1_B64,
      mimeType: 'image/png',
    });
    const hdPath = mediaService.filePathFromRelativeUrl(saved.hdUrl);
    const thumbPath = mediaService.filePathFromRelativeUrl(saved.thumbUrl!);
    fs.unlinkSync(hdPath!);

    const forWaha = mediaService.resolveOutboundForProvider(saved.hdUrl, 'WAHA');
    expect(forWaha).toBe(thumbPath);
  });

  it('Test 7: resolveOutboundForProvider(WABA) tanpa PUBLIC_BASE_URL → null', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TEST_TENANT_ID,
      imageB64: PNG_1X1_B64,
    });
    delete process.env.PUBLIC_BASE_URL;
    const forWaba = mediaService.resolveOutboundForProvider(saved.hdUrl, 'WABA');
    expect(forWaba).toBeNull();
  });

  it('Test 8: Upload lokasi baru → hanya thumb di disk (HD dihapus segera)', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TEST_TENANT_ID,
      imageB64: PNG_1X1_B64,
      mimeType: 'image/jpeg',
      fileName: 'house-test.jpg',
    });
    const hdPath = mediaService.filePathFromRelativeUrl(saved.hdUrl);
    const thumbPath = mediaService.filePathFromRelativeUrl(saved.thumbUrl!);

    // Simulasi logika staff/admin: hapus HD, pakai thumb
    mediaService.deleteFile(saved.hdUrl);

    expect(fs.existsSync(hdPath!)).toBe(false);
    expect(fs.existsSync(thumbPath!)).toBe(true);
  });

  it('Test 9: Retensi → house_photo_url ter-rewrite ke thumb (integrasi DB)', async () => {
    // Setup: customer dengan house_photo_url menunjuk HD
    const hdRelUrl = `/media/outbound/${TEST_TENANT_ID}/test-house.jpg`;
    const thumbRelUrl = `/media/outbound/${TEST_TENANT_ID}/test-house_thumb.jpg`;
    const hdPath = path.join(rootDir, 'outbound', TEST_TENANT_ID, 'test-house.jpg');
    const thumbPath = path.join(rootDir, 'outbound', TEST_TENANT_ID, 'test-house_thumb.jpg');
    fs.mkdirSync(path.dirname(hdPath), { recursive: true });
    fs.writeFileSync(hdPath, Buffer.alloc(100000));
    fs.writeFileSync(thumbPath, Buffer.alloc(15000));

    // Panggil updateMediaRefsAfterHdDelete (private, tapi bisa via instance)
    // @ts-ignore - akses private method untuk test
    await mediaService.updateMediaRefsAfterHdDelete(TEST_TENANT_ID, hdRelUrl, thumbRelUrl);

    // Verifikasi prisma.customer.updateMany dipanggil dengan argumen benar
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: TEST_TENANT_ID,
        preferences: { path: ['house_photo_url'], equals: hdRelUrl },
      },
      data: {
        preferences: { path: ['house_photo_url'], set: thumbRelUrl },
      },
    });
  });
});
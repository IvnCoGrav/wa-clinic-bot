import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mediaService } from '../../src/services/media.service';
import { prisma } from '../../src/db/client';

const TEST_TENANT_ID = 'test-watermark-tenant';
const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Media Watermark-Based Auto-Pruning', () => {
  const rootDir = path.join(process.cwd(), 'storage', 'media');

  const cleanDirs = () => {
    for (const scope of ['inbound', 'outbound'] as const) {
      const dir = path.join(rootDir, scope, TEST_TENANT_ID);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };

  beforeEach(() => {
    cleanDirs();
    delete process.env.MEDIA_QUOTA_BYTES;
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);
  });

  afterEach(() => {
    cleanDirs();
    vi.restoreAllMocks();
  });

  it('pruneToLowWatermark: menghapus file HD inbound tertua dan mempertahankan thumbnail', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const fileOld = path.join(inboundDir, 'old.jpg');
    const fileOldThumb = path.join(inboundDir, 'old_thumb.jpg');
    const fileMid = path.join(inboundDir, 'mid.jpg');
    const fileMidThumb = path.join(inboundDir, 'mid_thumb.jpg');
    const fileNew = path.join(inboundDir, 'new.jpg');
    const fileNewThumb = path.join(inboundDir, 'new_thumb.jpg');

    const dummyBuf = Buffer.alloc(100 * 1024);
    const thumbBuf = Buffer.alloc(10 * 1024);

    fs.writeFileSync(fileOld, dummyBuf);
    fs.writeFileSync(fileOldThumb, thumbBuf);
    fs.writeFileSync(fileMid, dummyBuf);
    fs.writeFileSync(fileMidThumb, thumbBuf);
    fs.writeFileSync(fileNew, dummyBuf);
    fs.writeFileSync(fileNewThumb, thumbBuf);

    const now = Date.now();
    fs.utimesSync(fileOld, new Date(now - 3 * 3600 * 1000), new Date(now - 3 * 3600 * 1000));
    fs.utimesSync(fileMid, new Date(now - 2 * 3600 * 1000), new Date(now - 2 * 3600 * 1000));
    fs.utimesSync(fileNew, new Date(now - 1 * 3600 * 1000), new Date(now - 1 * 3600 * 1000));

    const quota = 350 * 1024;
    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(res.filesRemoved).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(fileOld)).toBe(false);
    expect(fs.existsSync(fileOldThumb)).toBe(true);
    expect(fs.existsSync(fileMidThumb)).toBe(true);
    expect(fs.existsSync(fileNewThumb)).toBe(true);
    expect(fs.existsSync(fileNew)).toBe(true);
  });

  it('pruneToLowWatermark: melindungi file gambar pricelist tenant', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const pricelistFile = path.join(inboundDir, 'pricelist_2026.jpg');
    const pricelistThumb = path.join(inboundDir, 'pricelist_2026_thumb.jpg');
    const otherFile = path.join(inboundDir, 'customer_upload.jpg');
    const otherThumb = path.join(inboundDir, 'customer_upload_thumb.jpg');

    fs.writeFileSync(pricelistFile, Buffer.alloc(200 * 1024));
    fs.writeFileSync(pricelistThumb, Buffer.alloc(10 * 1024));
    fs.writeFileSync(otherFile, Buffer.alloc(200 * 1024));
    fs.writeFileSync(otherThumb, Buffer.alloc(10 * 1024));

    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      pricelist_image_url: `/media/inbound/${TEST_TENANT_ID}/pricelist_2026.jpg`,
    } as any);

    const quota = 300 * 1024;
    await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(fs.existsSync(pricelistFile)).toBe(true);
    expect(fs.existsSync(otherFile)).toBe(false);
    expect(fs.existsSync(otherThumb)).toBe(true);
  });

  it('enforceQuota: otomatis auto-prune saat storage mencapai high watermark', async () => {
    process.env.MEDIA_QUOTA_BYTES = String(400 * 1024);

    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const fileOld = path.join(inboundDir, 'old_chat.jpg');
    const fileOldThumb = path.join(inboundDir, 'old_chat_thumb.jpg');
    fs.writeFileSync(fileOld, Buffer.alloc(350 * 1024));
    fs.writeFileSync(fileOldThumb, Buffer.alloc(10 * 1024));
    fs.utimesSync(fileOld, new Date(Date.now() - 10000), new Date(Date.now() - 10000));

    const newBuf = Buffer.from(PNG_1X1_B64, 'base64');
    const result = await mediaService.saveInboundMedia({
      tenantId: TEST_TENANT_ID,
      buffer: newBuf,
      mimeType: 'image/png',
    });

    expect(result.hdUrl).toBeDefined();
    expect(fs.existsSync(fileOld)).toBe(false);
    expect(fs.existsSync(fileOldThumb)).toBe(true);
  });
});

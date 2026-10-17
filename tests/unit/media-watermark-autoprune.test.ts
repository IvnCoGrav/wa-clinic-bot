import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mediaService } from '../../src/services/media.service';
import { prisma } from '../../src/db/client';

const TEST_TENANT_ID = 'test-watermark-tenant';
const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Valid 1x1 JPEG buffer for testing
const JPEG_1X1_BUF = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x00, 0xff, 0xd9,
]);

describe('Media Watermark-Based Auto-Pruning', () => {
  const rootDir = path.join(process.cwd(), 'storage', 'media');

  const cleanDirs = () => {
    mediaService.clearUsageCache(TEST_TENANT_ID);
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
    vi.spyOn(prisma.customer, 'updateMany').mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.message, 'updateMany').mockResolvedValue({ count: 0 } as any);
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

  // --- ADVERSARIAL TESTS SESUAI RENCANA REVISI FASE 4 ---

  it('4.2: prune video.mp4 (tanpa thumb) berhasil terhapus dan membebaskan kuota tanpa error Sharp', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const mp4File = path.join(inboundDir, 'clip.mp4');
    const mp4Buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(150 * 1024),
    ]);
    fs.writeFileSync(mp4File, mp4Buf);

    const quota = 100 * 1024;
    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(res.filesRemoved).toBe(1);
    expect(res.freedBytes).toBe(mp4Buf.length);
    expect(fs.existsSync(mp4File)).toBe(false);
  });

  it('4.3: prune audio.ogg voice note (tanpa thumb) berhasil terhapus dan membebaskan kuota', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const oggFile = path.join(inboundDir, 'voice.ogg');
    const oggBuf = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(120 * 1024)]);
    fs.writeFileSync(oggFile, oggBuf);

    const quota = 80 * 1024;
    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(res.filesRemoved).toBe(1);
    expect(res.freedBytes).toBe(oggBuf.length);
    expect(fs.existsSync(oggFile)).toBe(false);
  });

  it('4.4 (kasus produksi): prune mislabeled.jpg yang berisi OggS berhasil dihapus (bukan ditahan)', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    // File bernama .jpg tapi isi konten sebenarnya audio OggS
    const fakeJpg = path.join(inboundDir, 'mislabeled_voice.jpg');
    const fakeJpgBuf = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(140 * 1024)]);
    fs.writeFileSync(fakeJpg, fakeJpgBuf);

    const quota = 100 * 1024;
    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(res.filesRemoved).toBe(1);
    expect(fs.existsSync(fakeJpg)).toBe(false);
  });

  it('4.5: prune empty.jpg 0-byte & corrupt.jpg berhasil terhapus demi kuota', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const emptyFile = path.join(inboundDir, 'empty.jpg');
    fs.writeFileSync(emptyFile, Buffer.alloc(0));

    const corruptFile = path.join(inboundDir, 'corrupt.jpg');
    // Magic JPEG tapi payload rusak/terpotong sehingga Sharp gagal
    fs.writeFileSync(corruptFile, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x12, 0x34, 0x56]));

    const now = Date.now();
    fs.utimesSync(emptyFile, new Date(now - 2000), new Date(now - 2000));
    fs.utimesSync(corruptFile, new Date(now - 1000), new Date(now - 1000));

    const quota = 5; // 7 bytes file korup > 5 * 0.65 (3 bytes target), memicu pruning
    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(res.filesRemoved).toBe(2);
    expect(fs.existsSync(emptyFile)).toBe(false);
    expect(fs.existsSync(corruptFile)).toBe(false);
  });

  it('4.6 (anti data-loss): mock Sharp gagal -> HD gambar valid dipertahankan', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const validImg = path.join(inboundDir, 'important_photo.jpg');
    fs.writeFileSync(validImg, JPEG_1X1_BUF);

    // Mock bahwa Sharp engine tidak tersedia (misal library libvips error / container crash)
    vi.spyOn(mediaService as any, 'isSharpAvailable').mockResolvedValue(false);

    const quota = 10;
    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    // HD WAJIB dipertahankan agar tidak terjadi mass deletion tanpa ganti pratinjau
    expect(fs.existsSync(validImg)).toBe(true);
    expect(res.filesRemoved).toBe(0);
  });

  it('4.7: HD test.png dengan thumbnail test_thumb.jpg tidak di-regenerasi & HD terhapus', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const hdPng = path.join(inboundDir, 'receipt.png');
    const thumbJpg = path.join(inboundDir, 'receipt_thumb.jpg');

    fs.writeFileSync(hdPng, Buffer.from(PNG_1X1_B64, 'base64'));
    fs.writeFileSync(thumbJpg, JPEG_1X1_BUF);

    const quota = 10;
    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(res.filesRemoved).toBe(1);
    expect(fs.existsSync(hdPng)).toBe(false);
    expect(fs.existsSync(thumbJpg)).toBe(true);
  });

  it('4.8: deleteExpiredMedia menghapus video dan audio kedaluwarsa (>35 hari) dengan ref unset', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const expiredMp4 = path.join(inboundDir, 'old_video.mp4');
    const expiredOgg = path.join(inboundDir, 'old_audio.ogg');
    fs.writeFileSync(expiredMp4, Buffer.alloc(100));
    fs.writeFileSync(expiredOgg, Buffer.alloc(100));

    const past = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    fs.utimesSync(expiredMp4, past, past);
    fs.utimesSync(expiredOgg, past, past);

    const removed = await mediaService.deleteExpiredMedia(TEST_TENANT_ID, 30);

    expect(removed).toBe(2);
    expect(fs.existsSync(expiredMp4)).toBe(false);
    expect(fs.existsSync(expiredOgg)).toBe(false);

    // Pastikan ref payload_raw di-unset (karena thumbRelUrl null)
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: TEST_TENANT_ID,
        payload_raw: { path: ['media', 'url'], equals: `/media/inbound/${TEST_TENANT_ID}/old_video.mp4` },
      },
      data: { payload_raw: { unset: ['media', 'url'] } },
    });
  });

  it('4.9 (pembersihan duplikat thumbnail inbound): membersihkan duplicate wrong-extension thumb yang berisi magic JPEG', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const hdFile = path.join(inboundDir, 'photo.png');
    const canonicalThumb = path.join(inboundDir, 'photo_thumb.jpg');
    const duplicateWrongThumb = path.join(inboundDir, 'photo_thumb.png');

    fs.writeFileSync(hdFile, Buffer.from(PNG_1X1_B64, 'base64'));
    fs.writeFileSync(canonicalThumb, JPEG_1X1_BUF);
    fs.writeFileSync(duplicateWrongThumb, JPEG_1X1_BUF); // artefak lama ber-ekstensi .png tapi isinya JPEG

    const quota = 10;
    await mediaService.pruneToLowWatermark(TEST_TENANT_ID, quota);

    expect(fs.existsSync(hdFile)).toBe(false);
    expect(fs.existsSync(canonicalThumb)).toBe(true);
    expect(fs.existsSync(duplicateWrongThumb)).toBe(false); // Berhasil dibersihkan!
  });

  it('4.10 (anti data-loss): encode gagal pasca-header valid (engine) -> HD gambar valid DIPERTAHANKAN', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const validImg = path.join(inboundDir, 'photo_header_valid.jpg');
    fs.writeFileSync(validImg, JPEG_1X1_BUF);

    // Header valid (magic JPEG) tetapi tahap encode gagal → gangguan mesin.
    vi.spyOn(mediaService as any, 'createBlurThumbDetailed').mockResolvedValue({
      ok: false,
      reason: 'engine',
      message: 'libvips transient failure',
    });

    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, 10);

    expect(res.filesRemoved).toBe(0);
    expect(fs.existsSync(validImg)).toBe(true);
  });

  it('4.11: header tak terbaca (invalid) -> file benar-benar korup dihapus demi kuota', async () => {
    const inboundDir = path.join(rootDir, 'inbound', TEST_TENANT_ID);
    fs.mkdirSync(inboundDir, { recursive: true });

    const corruptImg = path.join(inboundDir, 'truly_corrupt.jpg');
    fs.writeFileSync(corruptImg, JPEG_1X1_BUF);

    vi.spyOn(mediaService as any, 'createBlurThumbDetailed').mockResolvedValue({
      ok: false,
      reason: 'invalid',
      message: 'corrupt header',
    });

    const res = await mediaService.pruneToLowWatermark(TEST_TENANT_ID, 1);

    expect(res.filesRemoved).toBe(1);
    expect(fs.existsSync(corruptImg)).toBe(false);
  });
});

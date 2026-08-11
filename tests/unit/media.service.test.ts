import { describe, it, expect, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/db/client';
import { mediaService, getAllTenantIds } from '../../src/services/media.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('MediaService — penyimpanan & pembersihan media Live Chat', () => {
  afterAll(() => {
    const root = path.join(process.cwd(), 'storage', 'media');
    for (const scope of ['outbound', 'inbound']) {
      const dir = path.join(root, scope, DEFAULT_TENANT_ID);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  });

  afterEach(() => {
    delete process.env.PUBLIC_BASE_URL;
  });

  it('saveOutboundMedia: menulis file HD + thumbnail & mengembalikan URL relatif', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: DEFAULT_TENANT_ID,
      imageB64: PNG_B64,
      thumbB64: PNG_B64,
      mimeType: 'image/png',
    });

    expect(saved.hdPath).toMatch(/storage[\\/]media[\\/]outbound[\\/]default-tenant/);
    expect(saved.hdUrl).toMatch(/^\/media\/outbound\/default-tenant\/.+\.png$/);
    expect(saved.thumbUrl).toMatch(/^\/media\/outbound\/default-tenant\/.+_thumb\.png$/);
    expect(fs.existsSync(saved.hdPath)).toBe(true);
    expect(fs.existsSync(mediaService.filePathFromRelativeUrl(saved.thumbUrl!)!)).toBe(true);
  });

  it('resolveOutboundForProvider: WAHA → path lokal; WABA → URL publik', async () => {
    const saved = await mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 });

    const forWaha = mediaService.resolveOutboundForProvider(saved.hdUrl, 'WAHA');
    expect(forWaha).toMatch(/storage[\\/]media[\\/]outbound/);

    // tanpa PUBLIC_BASE_URL → null untuk WABA
    delete process.env.PUBLIC_BASE_URL;
    expect(mediaService.resolveOutboundForProvider(saved.hdUrl, 'WABA')).toBeNull();

    process.env.PUBLIC_BASE_URL = 'https://bot.example.com/';
    const forWaba = mediaService.resolveOutboundForProvider(saved.hdUrl, 'WABA');
    expect(forWaba).toBe(`https://bot.example.com${saved.hdUrl}`);
  });

  it('deleteExpiredMedia: menghapus hanya file yang umurnya melebihi retensi', async () => {
    const savedOld = await mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 });
    const savedNew = await mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 });

    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(savedOld.hdPath, past, past);

    const removed = await mediaService.deleteExpiredMedia(DEFAULT_TENANT_ID, 30);
    expect(removed).toBeGreaterThan(0);
    expect(fs.existsSync(savedOld.hdPath)).toBe(false);
    expect(fs.existsSync(savedNew.hdPath)).toBe(true);
  });

  it('deleteExpiredMedia: membersihkan juga file media INBOUND yang kadaluarsa', async () => {
    const saved = await mediaService.saveInboundMedia({
      tenantId: DEFAULT_TENANT_ID,
      buffer: Buffer.from(PNG_B64, 'base64'),
      mimeType: 'image/png',
    });

    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(saved.hdPath, past, past);

    const removed = await mediaService.deleteExpiredMedia(DEFAULT_TENANT_ID, 30);
    expect(removed).toBeGreaterThan(0);
    expect(fs.existsSync(saved.hdPath)).toBe(false);
  });

  it('runMediaCleanup: cron membersihkan file kadaluarsa tenant default saat DB offline', async () => {
    const { cronService } = await import('../../src/services/cron.service');
    const saved = await mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 });

    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(saved.hdPath, past, past);
    process.env.MEDIA_RETENTION_DAYS = '30';

    await cronService.runMediaCleanup();

    expect(fs.existsSync(saved.hdPath)).toBe(false);
    delete process.env.MEDIA_RETENTION_DAYS;
  });

  it('getRetentionDays: fallback ke env/default saat DB offline', async () => {
    delete process.env.MEDIA_RETENTION_DAYS;
    expect(await mediaService.getRetentionDays(DEFAULT_TENANT_ID)).toBe(30);
    process.env.MEDIA_RETENTION_DAYS = '7';
    expect(await mediaService.getRetentionDays(DEFAULT_TENANT_ID)).toBe(7);
    delete process.env.MEDIA_RETENTION_DAYS;
  });

  it('getAllTenantIds: fallback ke tenant default saat DB offline', async () => {
    const ids = await getAllTenantIds();
    expect(ids).toContain(DEFAULT_TENANT_ID);
  });

  it('saveInboundMedia: menulis HD + blur thumb inbound', async () => {
    const saved = await mediaService.saveInboundMedia({
      tenantId: DEFAULT_TENANT_ID,
      buffer: Buffer.from(PNG_B64, 'base64'),
      mimeType: 'image/png',
    });

    expect(fs.existsSync(saved.hdPath)).toBe(true);
    expect(saved.thumbUrl).toMatch(/^\/media\/inbound\/default-tenant\/.+_thumb\.jpg$/);
    expect(saved.thumbPath && fs.existsSync(saved.thumbPath)).toBe(true);
  });

  it('saveOutboundMedia tanpa thumbB64: generate blur thumb server-side', async () => {
    const saved = await mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 });
    expect(saved.thumbUrl).toMatch(/^\/media\/outbound\/default-tenant\/.+_thumb\.jpg$/);
    expect(fs.existsSync(mediaService.filePathFromRelativeUrl(saved.thumbUrl!)!)).toBe(true);
  });

  it('createBlurThumb: hasil JPEG kecil (< 80KB) untuk pratinjau', async () => {
    const blur = await mediaService.createBlurThumb(Buffer.from(PNG_B64, 'base64'), 'image/png');
    expect(blur).toBeTruthy();
    expect(blur!.mimeType).toBe('image/jpeg');
    expect(blur!.data.length).toBeGreaterThan(0);
    expect(blur!.data.length).toBeLessThan(80 * 1024);
  });

  it('kuota: upload ditolak saat melebihi MEDIA_QUOTA_BYTES (outbound & inbound)', async () => {
    process.env.MEDIA_QUOTA_BYTES = '5';
    try {
      await expect(
        mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 })
      ).rejects.toThrow(/Kuota media tenant/);
      await expect(
        mediaService.saveInboundMedia({
          tenantId: DEFAULT_TENANT_ID,
          buffer: Buffer.from(PNG_B64, 'base64'),
        })
      ).rejects.toThrow(/Kuota media tenant/);
    } finally {
      delete process.env.MEDIA_QUOTA_BYTES;
    }
  });

  it('getQuotaBytes: fallback env/default 200MB saat DB offline', async () => {
    delete process.env.MEDIA_QUOTA_BYTES;
    expect(await mediaService.getQuotaBytes(DEFAULT_TENANT_ID)).toBe(200 * 1024 * 1024);
    process.env.MEDIA_QUOTA_BYTES = '1048576';
    expect(await mediaService.getQuotaBytes(DEFAULT_TENANT_ID)).toBe(1048576);
    delete process.env.MEDIA_QUOTA_BYTES;
  });

  it('getMessageRetentionDays: fallback env/default 120 hari saat DB offline', async () => {
    delete process.env.MESSAGE_RETENTION_DAYS;
    expect(await mediaService.getMessageRetentionDays(DEFAULT_TENANT_ID)).toBe(120);
    process.env.MESSAGE_RETENTION_DAYS = '365';
    expect(await mediaService.getMessageRetentionDays(DEFAULT_TENANT_ID)).toBe(365);
    delete process.env.MESSAGE_RETENTION_DAYS;
  });

  it('deleteExpiredMedia: hapus HD tapi pertahankan blur thumb (pratinjau tidak rusak)', async () => {
    const saved = await mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 });
    const thumbAbs = mediaService.filePathFromRelativeUrl(saved.thumbUrl!)!;
    expect(fs.existsSync(thumbAbs)).toBe(true);

    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(saved.hdPath, past, past);

    const removed = await mediaService.deleteExpiredMedia(DEFAULT_TENANT_ID, 30);
    expect(removed).toBeGreaterThan(0);
    expect(fs.existsSync(saved.hdPath)).toBe(false);
    expect(fs.existsSync(thumbAbs)).toBe(true);
  });

  it('deleteExpiredMedia: gambar pricelist dikecualikan (permanen)', async () => {
    const saved = await mediaService.saveOutboundMedia({ tenantId: DEFAULT_TENANT_ID, imageB64: PNG_B64 });
    // DB offline di-mock reject → override satu panggilan untuk mensimulasikan config tenant.
    (prisma.tenant.findUnique as any).mockResolvedValueOnce({ id: DEFAULT_TENANT_ID, pricelist_image_url: saved.hdUrl });

    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(saved.hdPath, past, past);

    const removed = await mediaService.deleteExpiredMedia(DEFAULT_TENANT_ID, 30);
    expect(removed).toBe(0);
    expect(fs.existsSync(saved.hdPath)).toBe(true);
  });

  it('deleteExpiredMessages: best-effort 0 saat DB offline (tidak melempar)', async () => {
    const res = await mediaService.deleteExpiredMessages(DEFAULT_TENANT_ID, 120);
    expect(res.deleted).toBe(0);
    expect(res.mediaFiles).toBe(0);
  });
});

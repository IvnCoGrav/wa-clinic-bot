import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mediaService } from '../../src/services/media.service';
import { prisma } from '../../src/db/client';

const TENANT = 'test-thumb-rel-tenant';
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const rootDir = path.join(process.cwd(), 'storage', 'media');

/**
 * resolveThumbRelativeUrl — kontrak thumbnail sebagai URL publik relatif.
 * Bug yang dicegah: dashboard menerima path absolut (C:\...) sebagai <img src>.
 */
describe('resolveThumbRelativeUrl — thumbnail sebagai URL relatif', () => {
  const clean = () => {
    for (const scope of ['inbound', 'outbound'] as const) {
      try {
        fs.rmSync(path.join(rootDir, scope, TENANT), { recursive: true, force: true });
      } catch {}
    }
  };

  beforeEach(() => {
    clean();
    delete process.env.MEDIA_QUOTA_BYTES;
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);
  });

  afterEach(() => {
    clean();
    vi.restoreAllMocks();
    delete process.env.PUBLIC_BASE_URL;
  });

  it('mengembalikan URL relatif walau HD masih ada', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TENANT,
      imageB64: PNG_1X1,
      mimeType: 'image/png',
    });
    const rel = mediaService.resolveThumbRelativeUrl(saved.hdUrl);
    expect(rel).toBe(saved.thumbUrl);
    expect(rel!.startsWith('/media/')).toBe(true);
    expect(rel).not.toMatch(/^[A-Za-z]:\\/);
  });

  it('null bila thumbnail dihapus dari disk', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TENANT,
      imageB64: PNG_1X1,
      mimeType: 'image/png',
    });
    fs.unlinkSync(mediaService.filePathFromRelativeUrl(saved.thumbUrl!)!);
    expect(mediaService.resolveThumbRelativeUrl(saved.hdUrl)).toBeNull();
  });

  it('null untuk input yang sudah thumbnail / URL traversal', () => {
    expect(mediaService.resolveThumbRelativeUrl('/media/outbound/x/a_thumb.jpg')).toBeNull();
    expect(mediaService.resolveThumbRelativeUrl('/media/outbound/default-tenant/../etc/passwd')).toBeNull();
    expect(mediaService.resolveThumbRelativeUrl('/media/asset/pricelist_spa.jpg')).toBeNull();
    expect(mediaService.resolveThumbRelativeUrl('https://cdn.contoh/x.jpg')).toBeNull();
  });

  it('resolveThumbFallback tetap null saat HD ada (regresi perilaku lama)', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TENANT,
      imageB64: PNG_1X1,
      mimeType: 'image/png',
    });
    expect(mediaService.resolveThumbFallback(saved.hdUrl)).toBeNull();
  });

  it('WABA: HD hilang + PUBLIC_BASE_URL ada → URL publik thumbnail', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TENANT,
      imageB64: PNG_1X1,
      mimeType: 'image/png',
    });
    fs.unlinkSync(mediaService.filePathFromRelativeUrl(saved.hdUrl)!);
    process.env.PUBLIC_BASE_URL = 'https://app.contoh.test';
    expect(mediaService.resolveOutboundForProvider(saved.hdUrl, 'WABA')).toBe(
      `https://app.contoh.test${saved.thumbUrl}`
    );
  });
});

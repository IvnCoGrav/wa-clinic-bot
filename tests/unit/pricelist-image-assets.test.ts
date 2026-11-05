import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/db/client';
import { mediaService } from '../../src/services/media.service';
import {
  getPricelistImageAssets,
  toPricelistDisplayUrl,
  DEFAULT_PRICELIST_IMAGE,
} from '../../src/services/pricelist-config.service';

const TENANT = 'test-pricelist-assets';
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const rootDir = path.join(process.cwd(), 'storage', 'media');

/**
 * Kontrak aset pricelist: HD + thumbnail dalam satu seam.
 * Thumbnail TIDAK boleh dibuat ulang di jalur kirim — hanya lookup file yang sudah ada.
 */
describe('getPricelistImageAssets — kontrak aset pricelist', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(path.join(rootDir, 'outbound', TENANT), { recursive: true, force: true });
    } catch {}
    delete process.env.CLINIC_PRICELIST_IMAGE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CLINIC_PRICELIST_IMAGE_URL;
  });

  it('DB kosong → aset default, thumb null', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);
    const a = await getPricelistImageAssets(TENANT);
    expect(a.hd).toBe(DEFAULT_PRICELIST_IMAGE);
    expect(a.thumbUrl).toBeNull();
  });

  it('pricelist upload → thumbUrl relatif, bukan path absolut', async () => {
    const saved = await mediaService.saveOutboundMedia({
      tenantId: TENANT,
      imageB64: PNG_1X1,
      mimeType: 'image/png',
    });
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ pricelist_image_url: saved.hdUrl } as any);
    const a = await getPricelistImageAssets(TENANT);
    expect(a.thumbUrl).toBe(saved.thumbUrl);
    expect(a.thumbUrl!.startsWith('/media/')).toBe(true);
    expect(a.thumbUrl).not.toMatch(/^[A-Za-z]:\\/);
  });

  it('URL eksternal http → thumb null (tanpa fetch/generate)', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      pricelist_image_url: 'https://cdn.contoh/x.jpg',
    } as any);
    const a = await getPricelistImageAssets(TENANT);
    expect(a.thumbUrl).toBeNull();
  });

  it('env fallback dipakai saat DB tidak punya nilai', async () => {
    process.env.CLINIC_PRICELIST_IMAGE_URL = 'https://cdn.contoh/fallback.jpg';
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);
    const a = await getPricelistImageAssets(TENANT);
    expect(a.hd).toBe('https://cdn.contoh/fallback.jpg');
    expect(a.thumbUrl).toBeNull();
  });

  it('toPricelistDisplayUrl memetakan aset lokal ke /media/asset', () => {
    expect(toPricelistDisplayUrl('assets/pricelist_spa.jpg')).toBe('/media/asset/pricelist_spa.jpg');
    expect(toPricelistDisplayUrl('/media/outbound/t/a.jpg')).toBe('/media/outbound/t/a.jpg');
    expect(toPricelistDisplayUrl('https://cdn.contoh/x.jpg')).toBe('https://cdn.contoh/x.jpg');
  });
});

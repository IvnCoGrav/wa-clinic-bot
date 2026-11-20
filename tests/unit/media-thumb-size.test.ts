import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { mediaService } from '../../src/services/media.service';

/**
 * Regresi insiden 2026-11-20: thumbnail 640px/q80 berukuran ±90 KB membuat
 * kuota habis dan memicu pemangkasan massal. Thumbnail wajib kecil.
 */
describe('Thumbnail Live Chat — ukuran & dimensi', () => {
  async function makeNoisyJpeg(width: number, height: number): Promise<Buffer> {
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + (i >> 8) * 11) % 256;
    return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  }

  it('gambar 1600x1200 → thumbnail ≤ 480px dan < 60 KB', async () => {
    const src = await makeNoisyJpeg(1600, 1200);
    const thumb = await mediaService.createBlurThumb(src);
    expect(thumb).not.toBeNull();

    const meta = await sharp(thumb!.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.format).toBe('jpeg');
    expect(thumb!.data.length).toBeLessThan(60 * 1024);
  });

  it('gambar kecil 200x150 tidak diperbesar', async () => {
    const src = await makeNoisyJpeg(200, 150);
    const thumb = await mediaService.createBlurThumb(src);
    expect(thumb).not.toBeNull();

    const meta = await sharp(thumb!.data).metadata();
    expect(meta.width).toBe(200);
  });

  it('file non-gambar mengembalikan null (bukan crash)', async () => {
    const thumb = await mediaService.createBlurThumb(Buffer.from('bukan gambar sama sekali'));
    expect(thumb).toBeNull();
  });
});

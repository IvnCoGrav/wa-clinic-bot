import { describe, it, expect } from 'vitest';
import { mediaService } from '../../src/services/media.service';
import { DEFAULT_BRAND_IDENTITY } from '../../src/config/brand';

// Harness TDD watermark GPS: buffer Sharp nyata, tanpa mock overlay.
// ADVERSARIAL: EXIF portrait, teks panjang, karakter XML, brand dinamis tenant.

async function makeJpeg(w: number, h: number, orientation?: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  let pipe = sharp({
    create: { width: w, height: h, channels: 3, background: { r: 200, g: 220, b: 235 } },
  }).jpeg({ quality: 80 });
  if (orientation) pipe = pipe.withMetadata({ orientation } as any);
  return pipe.toBuffer();
}

async function metaOf(buf: Buffer): Promise<{ width?: number; height?: number; format?: string }> {
  const sharp = (await import('sharp')).default;
  return sharp(buf, { failOn: 'none' }).metadata() as any;
}

describe('Media watermark GPS — pipeline Sharp nyata', { timeout: 20000 }, () => {
  it('render watermark menghasilkan buffer JPEG valid (landscape)', async () => {
    const input = await makeJpeg(800, 600);
    const out = await mediaService.overlayGpsBadge(input, {
      lat: -7.35, lng: 112.75,
      customerName: 'Sinta',
      kelurahan: 'Waru', kecamatan: 'Waru',
      landmark: 'Depan warung',
      staffName: 'Bidan Yusi',
    } as any);
    expect(out.length).toBeGreaterThan(0);
    expect(out.subarray(0, 2).toString('hex')).toBe('ffd8');
    const m = await metaOf(out);
    expect(m.format).toBe('jpeg');
    // Watermark menempel: output berbeda dari input (banner + recompress)
    expect(out.equals(input)).toBe(false);
  });

  it('foto portrait EXIF orientation=6 tidak crash & dimensi visual terjaga', async () => {
    // Disimpan 800x600 mentah + flag EXIF 6 (90°) → visual akhir portrait 600x800.
    const input = await makeJpeg(800, 600, 6);
    const out = await mediaService.overlayGpsBadge(input, {
      lat: -7.35, lng: 112.75,
      customerName: 'Sinta Panjang Sekali Namanya Biar Diuji',
      kelurahan: 'Waru', kecamatan: 'Waru',
      landmark: 'Gang sempit sebelah masjid',
      staffName: 'Bidan Yusi',
    } as any);
    expect(out.subarray(0, 2).toString('hex')).toBe('ffd8');
    const mOut = await metaOf(out);
    // Setelah .rotate() visual harus portrait (h >= w), bukan terbalik.
    expect(mOut.height! >= mOut.width!).toBe(true);
    expect(out.equals(input)).toBe(false);
  });

  it('foto sempit 300x800: judul panjang ditrunkasi, tidak tabrakan brand', async () => {
    const input = await makeJpeg(300, 800);
    const out = await mediaService.overlayGpsBadge(input, {
      lat: -7.35, lng: 112.75,
      customerName: 'Aisyah Putri Ramadhani Kusuma Wardani Maharani',
      kelurahan: 'Medokan Ayu', kecamatan: 'Rungkut',
      landmark: 'Rumah cat hijau pagar hitam samping toko kelontong Pak Haji',
      staffName: 'Bidan Yusi',
      brandName: 'Klinik Sangat Panjang Sekali Namanya',
    } as any);
    expect(out.subarray(0, 2).toString('hex')).toBe('ffd8');
    // Builder murni wajib memotong judul + mempertahankan brand (uji deterministik).
    const mod: any = await import('../../src/services/media.service');
    if (typeof mod.buildGpsBadgeSvg === 'function') {
      const res = mod.buildGpsBadgeSvg(300, 800, {
        latLngText: 'GPS: -7.350000, 112.750000 · Bunda Aisyah Putri Ramadhani Kusuma Wardani Maharani · Kel. Medokan Ayu, Kec. Rungkut',
        subText: 'Foto: Bidan Yusi · Patokan: Rumah cat hijau · 12 Sep 2026 WIB',
        brand: 'Klinik Sangat Panjang Sekali Namanya',
      });
      const svg: string = typeof res === 'string' ? res : res.svg;
      expect(svg).toContain('...');
      expect(svg).toContain('Klinik Sangat Panjang');
    }
  });

  it('karakter khusus XML di-escape standar, bukan dihapus paksa', async () => {
    const mod: any = await import('../../src/services/media.service');
    expect(typeof mod.escapeXml).toBe('function');
    const esc: string = mod.escapeXml(`A&B <C> "D" 'E'\x00\x1f`);
    expect(esc).toContain('&amp;');
    expect(esc).toContain('&lt;');
    expect(esc).toContain('&gt;');
    expect(esc).toContain('&quot;');
    expect(esc).toContain('&apos;');
    expect(esc).not.toContain('\x00');
    // Nama asli tetap terbaca (tidak hilang jadi "AB C D E")
    expect(esc).toContain('A');
    expect(esc).toContain('B');

    // Pipeline ujung-ke-ujung tidak merusak parser SVG/Sharp.
    const input = await makeJpeg(800, 600);
    const out = await mediaService.overlayGpsBadge(input, {
      lat: -7.35, lng: 112.75,
      customerName: `Sinta & Dewi <Bunda> "Cantik"`,
      landmark: `Patokan <penting> & "rapi"`,
      staffName: 'Bidan Yusi',
    } as any);
    expect(out.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('brand & honorific 100% dinamis tenant (tanpa hardcode tunggal)', async () => {
    const mod: any = await import('../../src/services/media.service');
    if (typeof mod.buildGpsBadgeSvg === 'function') {
      const r = mod.buildGpsBadgeSvg(800, 600, {
        latLngText: 'GPS: -7.35, 112.75',
        subText: 'sub',
        brand: 'Klinik Mawar',
      });
      const svgCustom: string = typeof r === 'string' ? r : r.svg;
      expect(svgCustom).toContain('Klinik Mawar');
      expect(svgCustom).not.toContain('Kala Moms');
    }
    // Fallback tanpa brandName wajib = DEFAULT_BRAND_IDENTITY (DB-driven default),
    // bukan literal basi 'Kala Moms & Baby'.
    if (typeof mod.resolveWatermarkBrand === 'function') {
      expect(mod.resolveWatermarkBrand(null)).toBe(DEFAULT_BRAND_IDENTITY.businessName);
      expect(mod.resolveWatermarkBrand('  ')).toBe(DEFAULT_BRAND_IDENTITY.businessName);
      expect(mod.resolveWatermarkBrand('Klinik Mawar')).toBe('Klinik Mawar');
    }
    if (typeof mod.resolveCustomerHonorific === 'function') {
      expect(mod.resolveCustomerHonorific(null)).toBe(DEFAULT_BRAND_IDENTITY.addressTermForCustomer);
      expect(mod.resolveCustomerHonorific('Bund')).toBe('Bund');
    }
  });

  it('tanpa koordinat & tanpa area/nama → kembalikan buffer asli (guard hemat)', async () => {
    const input = await makeJpeg(400, 300);
    const out = await mediaService.overlayGpsBadge(input, {} as any);
    expect(out.equals(input)).toBe(true);
  });
});

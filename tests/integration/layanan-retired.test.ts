import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';

/**
 * /layanan sudah dipensiunkan (keputusan produk 2026-11-11).
 * Katalog publik tunggal adalah /pricelist. Yang diuji di sini adalah kontrak
 * pensiunnya: pengalihan permanen, bukan 404, dan tidak ada HTML katalog kedua
 * yang masih bisa menyajikan harga.
 */
describe('/layanan dipensiunkan → /pricelist', () => {
  const app = buildApp();

  it('/layanan mengalihkan permanen ke /pricelist', async () => {
    const res = await app.inject({ method: 'GET', url: '/layanan' });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('/pricelist');
  });

  it('/layanan.html juga mengalihkan permanen ke /pricelist', async () => {
    const res = await app.inject({ method: 'GET', url: '/layanan.html' });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('/pricelist');
  });

  it('/layanan tidak lagi menyajikan payload katalog kedua', async () => {
    const res = await app.inject({ method: 'GET', url: '/layanan' });
    expect(res.body).not.toContain('layanan-data');
    expect(res.body).not.toContain('CLINIC_SERVICES');
  });

  it('/pricelist tetap menjadi halaman katalog yang hidup', async () => {
    const res = await app.inject({ method: 'GET', url: '/pricelist' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="pricelist-data"');
  });
});

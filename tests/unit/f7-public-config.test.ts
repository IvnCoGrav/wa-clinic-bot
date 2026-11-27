import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../../src/app';

/**
 * F7 / M17-11 — kunci peta tidak boleh ditanam di bundle; dashboard mengambilnya
 * runtime lewat endpoint publik yang hanya berisi nilai non-rahasia.
 */

const ROOT = path.resolve(__dirname, '../..');

describe('F7 — /api/config/public', () => {
  const app = buildApp();

  beforeEach(() => {
    delete process.env.CARTO_API_KEY;
    delete process.env.VITE_CARTO_API_KEY;
  });

  afterEach(() => {
    delete process.env.CARTO_API_KEY;
    delete process.env.VITE_CARTO_API_KEY;
  });

  it('mengembalikan basemap siap pakai dari env runtime + cache singkat', async () => {
    process.env.CARTO_API_KEY = 'carto-public-key';
    const res = await app.inject({ method: 'GET', url: '/api/config/public' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map.basemapUrl).toContain('basemaps.cartocdn.com');
    expect(body.map.basemapUrl).toContain('key=carto-public-key');
    expect(body.map.subdomains).toBe('abcd');
    expect(body.map.maxNativeZoom).toBe(20);
    expect(res.headers['cache-control']).toContain('max-age=300');
  });

  it('kompatibel dengan env lama VITE_CARTO_API_KEY saat CARTO_API_KEY absen', async () => {
    process.env.VITE_CARTO_API_KEY = 'legacy-key';
    const res = await app.inject({ method: 'GET', url: '/api/config/public' });
    expect(res.json().map.basemapUrl).toContain('key=legacy-key');
  });

  it('tanpa kunci → basemap Esri (tanpa kunci), bukan string kosong', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/public' });
    const map = res.json().map;
    expect(map.basemapUrl).toContain('arcgisonline.com');
    expect(map.basemapUrl).not.toContain('key=');
    expect(map.subdomains).toBeNull();
    expect(map.maxNativeZoom).toBe(16);
  });

  it('tidak pernah membocorkan secret server walau env terisi', async () => {
    process.env.CARTO_API_KEY = 'carto-public-key';
    process.env.ADMIN_API_KEY = 'super-secret-admin';
    process.env.WAHA_API_KEY = 'super-secret-waha';

    const res = await app.inject({ method: 'GET', url: '/api/config/public' });
    const body = res.body;

    expect(Object.keys(res.json())).toEqual(['map']);
    expect(body).not.toContain('super-secret-admin');
    expect(body).not.toContain('super-secret-waha');
  });

  it('kunci peta tidak lagi ditanam lewat build-arg / import.meta.env', () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf-8');
    const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf-8');
    const viteEnv = fs.readFileSync(
      path.join(ROOT, 'packages/admin-dashboard/src/vite-env.d.ts'),
      'utf-8'
    );
    const mapTab = fs.readFileSync(
      path.join(ROOT, 'packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx'),
      'utf-8'
    );

    expect(dockerfile).not.toContain('VITE_CARTO_API_KEY');
    expect(compose).not.toContain('VITE_CARTO_API_KEY');
    expect(viteEnv).not.toContain('VITE_CARTO_API_KEY');
    expect(viteEnv).not.toContain('VITE_ADMIN_API_KEY');
    expect(mapTab).not.toContain('import.meta.env.VITE_CARTO_API_KEY');
    // Canary M17-11: nama provider/kunci tidak ada di bundle sumber dashboard.
    expect(mapTab).not.toContain('cartocdn');
    expect(mapTab).toContain('/api/config/public');
  });
});

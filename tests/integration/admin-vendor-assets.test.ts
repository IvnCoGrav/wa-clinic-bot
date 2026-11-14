import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';

process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test_admin_key_vendor_assets';

describe('Aset vendor lokal (Leaflet) — KNOWN #344', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('leaflet.js diserve same-origin dengan MIME javascript', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/vendor/leaflet/leaflet.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.body).toContain('Leaflet');
  });

  it('leaflet.css diserve dengan MIME css', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/vendor/leaflet/leaflet.css' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.body).toContain('.leaflet-container');
  });

  it('gambar marker ikut tersedia', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/vendor/leaflet/images/marker-icon.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('path traversal ditolak (tidak membaca file di luar vendor)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/vendor/%2e%2e/index.html' });
    expect(res.statusCode).toBe(404);
  });
});

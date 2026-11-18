import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Task 0.6 — Kontrak Keamanan Edge Header & CSP (Fase 1 Contract)
 * Status: MERAH sebelum implementasi Fase 1 (A-001).
 * Menguji kepatuhan header Caddyfile dan rute landing terhadap Meta Pixel loader.
 */
describe('Task 0.6: Edge Header & CSP Contract (Fase 1)', () => {
  const rootDir = process.cwd();
  const caddyfilePath = path.join(rootDir, 'Caddyfile');

  it('1. Caddyfile wajib mengizinkan connect.facebook.net pada script-src', () => {
    const caddyfile = fs.readFileSync(caddyfilePath, 'utf8');
    // Fase 1 mewajibkan script-src memuat connect.facebook.net (quick) atau scoped @ui (clean)
    const hasFbScript =
      caddyfile.includes('https://connect.facebook.net') ||
      caddyfile.includes('@ui path /admin*');
    expect(hasFbScript).toBe(true);
  });

  it('2. Helper applyLandingSecurityHeaders harus ada dan diekspor untuk landing /cta', async () => {
    // Fase 1 membuat helper applyLandingSecurityHeaders di landing.route
    const landingModule = await import('../../src/routes/landing.route');
    expect(typeof (landingModule as any).applyLandingSecurityHeaders).toBe('function');
  });

  it('3. Rute /pricelist wajib menyertakan Content-Security-Policy dan X-Frame-Options DENY', async () => {
    const { buildApp } = await import('../../src/app');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/pricelist',
      });
      // Sebelum Fase 1, /pricelist belum memiliki CSP
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain('connect.facebook.net');
      expect(res.headers['x-frame-options']).toBe('DENY');
    } finally {
      await app.close();
    }
  }, 35000);
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';

/**
 * Regresi AUDIT #316 FASE 3 (K-03):
 * media inbound dulu hanya mengecek "ada sesi", bukan tenant pemilik sesi.
 * Staf tenant A bisa membaca voice note/foto tenant B bila tahu path-nya.
 */

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const MEDIA_ROOT = path.join(process.cwd(), 'storage', 'media', 'inbound');
const TENANT_A_DIR = path.join(MEDIA_ROOT, 'tenant-a-test');
const TENANT_B_DIR = path.join(MEDIA_ROOT, 'tenant-b-test');

describe('Media inbound — isolasi tenant (FASE 3)', () => {
  const app = buildApp();
  const adminKey = 'test_admin_key_media_tenant';

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = adminKey;
    fs.mkdirSync(TENANT_A_DIR, { recursive: true });
    fs.mkdirSync(TENANT_B_DIR, { recursive: true });
    fs.writeFileSync(path.join(TENANT_A_DIR, 'proof.png'), PNG_1x1);
    fs.writeFileSync(path.join(TENANT_B_DIR, 'proof.png'), PNG_1x1);
    await app.ready();
  });

  afterAll(async () => {
    try { fs.rmSync(TENANT_A_DIR, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(TENANT_B_DIR, { recursive: true, force: true }); } catch {}
    await app.close();
  });

  it('tanpa autentikasi → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/media/inbound/tenant-a-test/proof.png' });
    expect(res.statusCode).toBe(401);
  });

  it('staf tenant A membaca media tenant A → 200 + Cache-Control private', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      id: 'sess-a',
      staff: { tenant_id: 'tenant-a-test', active: true },
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/media/inbound/tenant-a-test/proof.png',
      headers: { cookie: 'staff_session=token-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['cache-control'])).toContain('private');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ADVERSARIAL: staf tenant A TIDAK boleh membaca media tenant B → 404', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      id: 'sess-a',
      staff: { tenant_id: 'tenant-a-test', active: true },
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/media/inbound/tenant-b-test/proof.png',
      headers: { cookie: 'staff_session=token-a' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('super admin (API key) tetap boleh lintas tenant, cache tetap private', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/media/inbound/tenant-b-test/proof.png',
      headers: { 'x-api-key': adminKey },
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['cache-control'])).toContain('private');
  });

  it('sesi staf tanpa tenant → fail-closed (401)', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      id: 'sess-x',
      staff: { active: true },
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/media/inbound/tenant-a-test/proof.png',
      headers: { cookie: 'staff_session=token-x' },
    });

    expect(res.statusCode).toBe(401);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

const ADMIN_KEY = 'test_admin_key_audience_export';
const ADMIN_HEADERS = { 'x-api-key': ADMIN_KEY };

/**
 * Kontrak export audience Meta (Custom Audience upload):
 * - Nomor WA klinik sering tidak cocok dengan akun FB/IG pasien, jadi format wajib 62... (tanpa 0/+).
 * - Hanya data operasional (bukan sandbox/staf internal/soft-deleted) yang boleh keluar.
 * - Duplikat nomor hasil normalisasi harus di-dedupe agar ukuran audience tidak menggelembung.
 */
describe('GET /api/admin/customers/audience-export', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.HUMANIZER_ENABLED = 'false';
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('menghasilkan CSV phone ternormalisasi 62, dedupe, dan mengecualikan data non-pasien', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValueOnce([
      { phone: '0812-3456-7890' },
      { phone: '+62 812 3456 7890' },
      { phone: '6281399998888' },
      { phone: '0813 9999 8888' },
      { phone: '123' },
      { phone: '' },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/audience-export',
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment;');

    const lines = res.body.trim().split(/\r?\n/);
    expect(lines[0]).toBe('phone');
    const phones = lines.slice(1);
    // 0812-3456-7890 dan +62 812 3456 7890 adalah nomor yang sama setelah normalisasi
    expect(phones).toEqual(['6281234567890', '6281399998888']);

    const where = vi.mocked(prisma.customer.findMany).mock.calls[0][0]?.where as any;
    expect(where.deleted_at).toBeNull();
    expect(where.is_sandbox_test).toBe(false);
    expect(where.is_internal_staff).toBe(false);
  });

  it('fail-closed saat database offline (tidak mengirim file kosong palsu)', async () => {
    vi.mocked(prisma.customer.findMany).mockRejectedValueOnce(new Error('Database offline'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/audience-export',
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  it('menolak request tanpa API key admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/customers/audience-export',
    });
    expect(res.statusCode).toBe(401);
  });
});

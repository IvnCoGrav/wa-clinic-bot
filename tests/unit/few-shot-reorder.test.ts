import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { FewShotExemplarBank } from '../../src/v3/agent/few-shot-exemplars';

process.env.NODE_ENV = 'test';
process.env.WAHA_WEBHOOK_SECRET = '';
process.env.ADMIN_API_KEY = 'test_admin_api_key_few_shot_reorder';

describe('Few-Shot Reorder API (PUT /api/admin/few-shots/reorder)', () => {
  const app = buildApp();
  const adminApiKey = 'test_admin_api_key_few_shot_reorder';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = adminApiKey;
    // Bersihkan cache modul (state statis lintas file test) agar tiap test
    // berangkat dari daftar kosong yang deterministik.
    FewShotExemplarBank.__clearCacheForTest?.('default-tenant');
    FewShotExemplarBank.__setCacheForTest?.('default-tenant', []);
  });

  afterEach(() => {
    FewShotExemplarBank.__clearCacheForTest?.('default-tenant');
  });

  it('rejects non-array orderedIds with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/few-shots/reorder',
      headers: { 'x-api-key': adminApiKey },
      payload: { orderedIds: 'abc,def' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists reversed order and returns sorted by new sort_order', async () => {
    // Seed beberapa exemplar via bank (DB offline → in-memory cache).
    const created: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      const item = await FewShotExemplarBank.createExemplar(
        {
          scenario: `Skenario ${name}`,
          customerMessage: `Pesan ${name}`,
          idealResponse: `Balasan ${name}`,
          tags: [`tag_${name.toLowerCase()}`],
          isActive: true,
        },
        'default-tenant'
      );
      created.push(item.id);
    }
    expect(created.length).toBe(3);

    // Balik urutan: C, B, A
    const reversed = [created[2], created[1], created[0]];
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/few-shots/reorder',
      headers: { 'x-api-key': adminApiKey },
      payload: { orderedIds: reversed },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.map((e: { id: string }) => e.id)).toEqual(reversed);
    // sortOrder harus sekuensial 1..N sesuai urutan baru
    body.data.forEach((e: { sortOrder?: number }, idx: number) => {
      expect(e.sortOrder).toBe(idx + 1);
    });
  });

  it('returns current list unchanged for empty orderedIds', async () => {
    // Seed satu item agar daftar tidak kosong.
    const seeded = await FewShotExemplarBank.createExemplar(
      {
        scenario: 'Skenario Tunggal',
        customerMessage: 'Pesan',
        idealResponse: 'Balasan',
        tags: ['tag_tunggal'],
        isActive: true,
      },
      'default-tenant'
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/few-shots/reorder',
      headers: { 'x-api-key': adminApiKey },
      payload: { orderedIds: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // Daftar tetap ada (tidak crash / tidak menghapus apa pun)
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((e: { id: string }) => e.id === seeded.id)).toBe(true);
  });
});

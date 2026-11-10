import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * Cfg-002 (BOLA/IDOR lintas tenant pada Knowledge Chunk):
 * edit/hapus chunk WAJIB memakai predikat tenant peminta. Chunk milik tenant
 * lain harus 404 dan TIDAK boleh menghasilkan update/delete apa pun.
 *
 * Uji adversarial: penyerang menebak ID chunk tenant lain.
 */
const ADMIN_KEY = 'test_admin_key_knowledge_bola';
const app = buildApp();

const headers = { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-b' };

describe('Knowledge Chunk — isolasi tenant (Cfg-002)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('PUT chunk milik tenant lain → 404, update tidak pernah dijalankan', async () => {
    const findSpy = vi
      .spyOn(prisma.knowledgeChunk, 'findFirst')
      .mockResolvedValue(null as any);
    const updateSpy = vi
      .spyOn(prisma.knowledgeChunk, 'update')
      .mockResolvedValue({ id: 'chunk-tenant-a' } as any);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/knowledge/chunks/chunk-tenant-a',
      headers,
      payload: { title: 'Judul disusupi', content: 'Konten disusupi' },
    });

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
    // Predikat tenant ikut dikirim ke query kepemilikan.
    const where = (findSpy.mock.calls[0]?.[0] as any)?.where;
    expect(where).toEqual({ id: 'chunk-tenant-a', tenant_id: 'tenant-b' });
  });

  it('DELETE chunk milik tenant lain → 404, delete tidak pernah dijalankan', async () => {
    vi.spyOn(prisma.knowledgeChunk, 'findFirst').mockResolvedValue(null as any);
    const deleteSpy = vi
      .spyOn(prisma.knowledgeChunk, 'delete')
      .mockResolvedValue({ id: 'chunk-tenant-a' } as any);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/knowledge/chunks/chunk-tenant-a',
      headers,
    });

    expect(res.statusCode).toBe(404);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

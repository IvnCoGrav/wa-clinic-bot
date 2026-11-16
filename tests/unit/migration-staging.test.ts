import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  bulkApproveStagingPurchases,
  clearPendingFaqStaging,
  countTenantConversations,
  deleteAllFaqStaging,
  listFaqStaging,
  listLegacyStaging,
  listLegacyStagingByStatus,
  updateLegacyStagingStatus,
} from '../../src/services/migration-staging.service';

/**
 * S2-4 — Seam data staging migrasi/FAQ.
 * Adversarial: memastikan SETIAP query ter-scope tenant, parameter sortir asing
 * tidak lolos, pagination dijepit, dan lookup chunk tidak N+1.
 */
describe('migration-staging.service', () => {
  const tenantId = 'tenant-a';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function stubEmptyStaging() {
    vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.legacyStaging.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.conversation.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.message.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([] as any);
  }

  it('listLegacyStaging: semua query memakai tenantId pemanggil + pagination dijepit', async () => {
    stubEmptyStaging();

    const result = await listLegacyStaging({ tenantId, page: -5, limit: 9999, search: '  budi  ' });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(200);
    const firstFindMany = vi.mocked(prisma.legacyStaging.findMany).mock.calls[0][0] as any;
    expect(firstFindMany.where).toEqual(
      expect.objectContaining({ tenantId, status: 'PENDING' })
    );
    expect(firstFindMany.skip).toBe(0);
    expect(firstFindMany.take).toBe(200);
    // Search dibersihkan dan dibatasi OR pada kolom yang dikenal.
    expect(firstFindMany.where.OR[0].name.contains).toBe('budi');

    for (const call of vi.mocked(prisma.legacyStaging.count).mock.calls) {
      expect((call[0] as any).where).toEqual(expect.objectContaining({ tenantId }));
    }
    expect(vi.mocked(prisma.conversation.count).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { tenant_id: tenantId } })
    );
    expect(vi.mocked(prisma.message.count).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { tenant_id: tenantId } })
    );
  });

  it('listLegacyStaging: sortBy asing diabaikan (anti-injection ke orderBy)', async () => {
    stubEmptyStaging();
    await listLegacyStaging({ tenantId, sortBy: 'password; DROP TABLE customer' });
    const call = vi.mocked(prisma.legacyStaging.findMany).mock.calls[0][0] as any;
    expect(call.orderBy).toEqual({ leadCreatedAt: 'desc' });
  });

  it('listLegacyStaging: LTV customer di-scope tenant (anti bocor lintas tenant)', async () => {
    stubEmptyStaging();
    vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([
      { id: 's1', phoneNumber: '628111', firstPurchaseAt: null, extractedReservationJson: null },
    ] as any);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { phone: '628111', reservations: [{ purchase_value: 120000 }, { purchase_value: 80000 }] },
    ] as any);

    const result = await listLegacyStaging({ tenantId });

    expect(vi.mocked(prisma.customer.findMany).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { phone: { in: ['628111'] }, tenant_id: tenantId } })
    );
    expect(result.items[0].ltv).toBe(200000);
  });

  it('listLegacyStaging: hasReservation=false memfilter firstPurchaseAt null', async () => {
    stubEmptyStaging();
    await listLegacyStaging({ tenantId, hasReservation: 'false' });
    const call = vi.mocked(prisma.legacyStaging.findMany).mock.calls[0][0] as any;
    expect(call.where.firstPurchaseAt).toBeNull();
  });

  it('listLegacyStaging: sortBy ltv menyortir hasil ter-enrich lalu memotong halaman', async () => {
    stubEmptyStaging();
    vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([
      { id: 'a', phoneNumber: '1', firstPurchaseAt: null, extractedReservationJson: null },
      { id: 'b', phoneNumber: '2', firstPurchaseAt: null, extractedReservationJson: null },
      { id: 'c', phoneNumber: '3', firstPurchaseAt: null, extractedReservationJson: null },
    ] as any);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { phone: '1', reservations: [{ purchase_value: 10000 }] },
      { phone: '2', reservations: [{ purchase_value: 90000 }] },
      { phone: '3', reservations: [{ purchase_value: 50000 }] },
    ] as any);

    const result = await listLegacyStaging({ tenantId, sortBy: 'ltv', page: 1, limit: 2 });
    expect(result.items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('listLegacyStagingByStatus: tenant-scoped + urut leadCreatedAt desc', async () => {
    vi.mocked(prisma.legacyStaging.findMany).mockResolvedValue([] as any);
    await listLegacyStagingByStatus(tenantId, 'APPROVED');
    expect(vi.mocked(prisma.legacyStaging.findMany).mock.calls[0][0]).toEqual({
      where: { tenantId, status: 'APPROVED' },
      orderBy: { leadCreatedAt: 'desc' },
    });
  });

  it('updateLegacyStagingStatus: hanya mengubah status baris target', async () => {
    vi.mocked(prisma.legacyStaging.update).mockResolvedValue({ id: 's1', status: 'REJECTED' } as any);
    const updated = await updateLegacyStagingStatus('s1', 'REJECTED');
    expect(updated.status).toBe('REJECTED');
    expect(vi.mocked(prisma.legacyStaging.update).mock.calls[0][0]).toEqual({
      where: { id: 's1' },
      data: { status: 'REJECTED' },
    });
  });

  it('bulkApproveStagingPurchases: tenant-scoped dan hanya PENDING yang punya purchase', async () => {
    (prisma.legacyStaging as any).updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const count = await bulkApproveStagingPurchases(tenantId);
    expect(count).toBe(3);
    expect((prisma.legacyStaging as any).updateMany.mock.calls[0][0]).toEqual({
      where: { tenantId, status: 'PENDING', firstPurchaseAt: { not: null } },
      data: { status: 'APPROVED' },
    });
  });

  it('countTenantConversations: tenant-scoped', async () => {
    vi.mocked(prisma.conversation.count).mockResolvedValue(7 as any);
    expect(await countTenantConversations(tenantId)).toBe(7);
    expect(vi.mocked(prisma.conversation.count).mock.calls[0][0]).toEqual({
      where: { tenant_id: tenantId },
    });
  });

  it('clearPendingFaqStaging: hanya PENDING milik tenant, dua tabel', async () => {
    (prisma.medicalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    (prisma.generalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 5 });

    const res = await clearPendingFaqStaging(tenantId);

    expect(res).toEqual({ medicalCleared: 2, generalCleared: 5 });
    expect((prisma.medicalFaqStaging as any).deleteMany.mock.calls[0][0]).toEqual({
      where: { tenant_id: tenantId, status: 'PENDING' },
    });
    expect((prisma.generalFaqStaging as any).deleteMany.mock.calls[0][0]).toEqual({
      where: { tenant_id: tenantId, status: 'PENDING' },
    });
  });

  it('deleteAllFaqStaging: menghapus seluruh staging tenant tanpa menyentuh tenant lain', async () => {
    (prisma.medicalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 4 });
    (prisma.generalFaqStaging as any).deleteMany = vi.fn().mockResolvedValue({ count: 6 });

    const res = await deleteAllFaqStaging(tenantId);

    expect(res).toEqual({ medicalDeleted: 4, generalDeleted: 6 });
    expect((prisma.medicalFaqStaging as any).deleteMany.mock.calls[0][0]).toEqual({
      where: { tenant_id: tenantId },
    });
  });

  it('listFaqStaging: batch 1 query chunk untuk semua matched_chunk_id', async () => {
    vi.mocked(prisma.medicalFaqStaging.findMany).mockResolvedValue([
      { id: 'f1', matched_chunk_id: 'c1' },
      { id: 'f2', matched_chunk_id: null },
      { id: 'f3', matched_chunk_id: 'c1' },
    ] as any);
    vi.mocked(prisma.medicalFaqStaging.count).mockResolvedValue(3 as any);
    vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue([{ id: 'c1', content: 'x' }] as any);

    const res = await listFaqStaging('medical', { tenantId, status: 'PENDING', page: 1, limit: 50 });

    expect(res.items[0].matchedChunk).toEqual({ id: 'c1', content: 'x' });
    expect(res.items[1].matchedChunk).toBeUndefined();
    expect(vi.mocked(prisma.medicalFaqStaging.findMany).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { tenant_id: tenantId, status: 'PENDING' } })
    );
    expect(vi.mocked(prisma.knowledgeChunk.findMany).mock.calls[0][0]).toEqual({
      where: { id: { in: ['c1'] } },
    });
  });

  it('listFaqStaging: tanpa matched_chunk_id tidak menembak query chunk', async () => {
    vi.mocked(prisma.generalFaqStaging.findMany).mockResolvedValue([{ id: 'f1', matched_chunk_id: null }] as any);
    vi.mocked(prisma.generalFaqStaging.count).mockResolvedValue(1 as any);

    await listFaqStaging('general', { tenantId });

    expect(prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.generalFaqStaging.findMany).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { tenant_id: tenantId, status: 'PENDING' } })
    );
  });
});

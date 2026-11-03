import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryChatStats } from '../../src/services/copilot/copilot-tools';
import { prisma } from '../../src/db/client';

describe('query_chat_stats tool (Fase 4 — statistik percakapan & pesan)', () => {
  const tenantId = 'test-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mengagregasikan pesan inbound, outbound, dan percakapan baru per hari', async () => {
    const d1 = new Date('2026-11-03T02:00:00Z'); // 09:00 WIB
    const d2 = new Date('2026-11-03T05:00:00Z'); // 12:00 WIB

    vi.spyOn(prisma.message, 'findMany').mockResolvedValueOnce([
      { direction: 'INBOUND', created_at: d1, conversation_id: 'conv-1' } as any,
      { direction: 'OUTBOUND', created_at: d1, conversation_id: 'conv-1' } as any,
      { direction: 'INBOUND', created_at: d2, conversation_id: 'conv-2' } as any,
    ]);

    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValueOnce([
      { id: 'conv-1', created_at: d1, is_human_handling: false, is_frustrated: false } as any,
      { id: 'conv-2', created_at: d2, is_human_handling: true, is_frustrated: true } as any,
    ]);

    const result = await queryChatStats.run(tenantId, { dateFrom: '2026-11-03', groupBy: 'day' });

    expect(result.tool).toBe('query_chat_stats');
    expect(result.count).toBe(1);
    const row = result.rows[0];
    expect(row.bucket).toBe('2026-11-03');
    expect(row.inboundMessages).toBe(2);
    expect(row.outboundMessages).toBe(1);
    expect(row.newConversations).toBe(2);
    expect(row.activeConversations).toBe(2);
    expect(row.humanHandling).toBe(1);
    expect(row.frustrated).toBe(1);
  });

  it('mengelompokkan per jam saat groupBy === "hour"', async () => {
    const d1 = new Date('2026-11-03T02:30:00Z'); // 09:30 WIB
    const d2 = new Date('2026-11-03T03:15:00Z'); // 10:15 WIB

    vi.spyOn(prisma.message, 'findMany').mockResolvedValueOnce([
      { direction: 'INBOUND', created_at: d1, conversation_id: 'conv-1' } as any,
      { direction: 'INBOUND', created_at: d2, conversation_id: 'conv-1' } as any,
    ]);

    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValueOnce([]);

    const result = await queryChatStats.run(tenantId, { dateFrom: '2026-11-03', groupBy: 'hour' });

    expect(result.count).toBe(2);
    expect(result.rows[0].bucket).toBe('2026-11-03 09:00');
    expect(result.rows[0].inboundMessages).toBe(1);
    expect(result.rows[1].bucket).toBe('2026-11-03 10:00');
    expect(result.rows[1].inboundMessages).toBe(1);
  });

  it('membaca SEMUA halaman — tidak lagi terpotong di 2.000 pesan (bug "berapa chat bulan ini")', async () => {
    const day = new Date('2026-11-03T02:00:00Z');
    const firstPage = Array.from({ length: 5000 }, (_, i) => ({
      id: `m-${i}`,
      direction: 'INBOUND',
      created_at: day,
      conversation_id: 'conv-1',
    }));
    const secondPage = [
      { id: 'm-5000', direction: 'INBOUND', created_at: day, conversation_id: 'conv-1' },
    ];

    const messageSpy = vi
      .spyOn(prisma.message, 'findMany')
      .mockResolvedValueOnce(firstPage as any)
      .mockResolvedValueOnce(secondPage as any);
    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValueOnce([]);

    const result = await queryChatStats.run(tenantId, { dateFrom: '2026-11-03' });

    expect(messageSpy).toHaveBeenCalledTimes(2);
    expect(result.rows[0].inboundMessages).toBe(5001);
  });

  it('memfilter customer sandbox/test dari statistik', async () => {
    const spy = vi.spyOn(prisma.message, 'findMany').mockResolvedValueOnce([]);
    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValueOnce([]);

    await queryChatStats.run(tenantId, { dateFrom: '2026-11-03' });

    const where = (spy.mock.calls[0][0] as any).where;
    expect(where.conversation.customer.is_sandbox_test).toBe(false);
  });

  it('mengembalikan baris 0 default saat tidak ada aktivitas chat', async () => {
    vi.spyOn(prisma.message, 'findMany').mockResolvedValueOnce([]);
    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValueOnce([]);

    const result = await queryChatStats.run(tenantId, { dateFrom: '2026-11-03' });

    expect(result.count).toBe(1);
    expect(result.rows[0].inboundMessages).toBe(0);
    expect(result.rows[0].outboundMessages).toBe(0);
    expect(result.rows[0].newConversations).toBe(0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { BroadcastQueueService } from '../../src/services/broadcast-queue.service';
import { collectSystemInfo } from '../../src/services/system-debug.service';

/**
 * Ar-003 (bounded slice) — pekerja lintas tenant yang sebelumnya hardcode
 * `DEFAULT_TENANT_ID`:
 * 1. Enqueue follow-up broadcast hanya memproses tenant default.
 * 2. `collectSystemInfo` hanya menghitung data tenant default.
 */

const oldWorkerFlag = process.env.ENABLE_FOLLOWUP_WORKER;
const oldRedisHost = process.env.REDIS_HOST;
const oldRedisPort = process.env.REDIS_PORT;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENABLE_FOLLOWUP_WORKER = 'true';
  // Isolasi: jangan pernah menyentuh Redis nyata milik pengguna saat test.
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = '6399';
});

afterEach(() => {
  vi.restoreAllMocks();
  if (oldWorkerFlag === undefined) delete process.env.ENABLE_FOLLOWUP_WORKER;
  else process.env.ENABLE_FOLLOWUP_WORKER = oldWorkerFlag;
  if (oldRedisHost === undefined) delete process.env.REDIS_HOST;
  else process.env.REDIS_HOST = oldRedisHost;
  if (oldRedisPort === undefined) delete process.env.REDIS_PORT;
  else process.env.REDIS_PORT = oldRedisPort;
});

describe('Broadcast follow-up enqueue lintas tenant', () => {
  it('memproses follow-up dari SEMUA tenant, bukan hanya default', async () => {
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }] as any);
    const findMany = vi.spyOn(prisma.followUp, 'findMany').mockImplementation((async (args: any) => {
      if (args?.where?.tenant_id === 'tenant-a') {
        return [{ id: 'fu-a', customer_id: 'cust-a', tenant_id: 'tenant-a' }];
      }
      if (args?.where?.tenant_id === 'tenant-b') {
        return [{ id: 'fu-b', customer_id: 'cust-b', tenant_id: 'tenant-b' }];
      }
      return [];
    }) as any);
    const updateMany = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);

    const service = new BroadcastQueueService();
    await service.enqueuePendingFollowUps();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-a' }) })
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-b' }) })
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: 'tenant-a' }),
        data: { status: 'QUEUED' },
      })
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: 'tenant-b' }),
        data: { status: 'QUEUED' },
      })
    );
  });

  it('tidak menandai QUEUED follow-up tenant lain saat update (filter tenant ikut)', async () => {
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{ id: 'tenant-a' }] as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([
      { id: 'fu-a', customer_id: 'cust-a', tenant_id: 'tenant-a' },
    ] as any);
    const updateMany = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);

    const service = new BroadcastQueueService();
    await service.enqueuePendingFollowUps();

    const call = updateMany.mock.calls[0][0] as any;
    expect(call.where).toMatchObject({ tenant_id: 'tenant-a' });
    expect(call.where.id.in).toEqual(['fu-a']);
  });
});

describe('collectSystemInfo tenant-scoped', () => {
  it('menghitung data tenant yang diminta, bukan default-tenant', async () => {
    const customerCount = vi.spyOn(prisma.customer, 'count').mockResolvedValue(3 as any);
    vi.spyOn(prisma.conversation, 'count').mockResolvedValue(2 as any);
    vi.spyOn(prisma.message, 'count').mockResolvedValue(10 as any);
    vi.spyOn(prisma.reservation, 'count').mockResolvedValue(1 as any);
    vi.spyOn(prisma.followUp, 'count').mockResolvedValue(4 as any);

    const info = await collectSystemInfo('tenant-b');

    expect(customerCount).toHaveBeenCalledWith({ where: { tenant_id: 'tenant-b' } });
    expect(info.counts.customers).toBe(3);
    expect(info.counts.followUps).toBe(4);
  });

  it('default tetap default-tenant saat argumen tidak diberikan', async () => {
    const customerCount = vi.spyOn(prisma.customer, 'count').mockResolvedValue(0 as any);
    vi.spyOn(prisma.conversation, 'count').mockResolvedValue(0 as any);
    vi.spyOn(prisma.message, 'count').mockResolvedValue(0 as any);
    vi.spyOn(prisma.reservation, 'count').mockResolvedValue(0 as any);
    vi.spyOn(prisma.followUp, 'count').mockResolvedValue(0 as any);

    await collectSystemInfo();

    expect(customerCount).toHaveBeenCalledWith({ where: { tenant_id: 'default-tenant' } });
  });

  it('collectRecentMessages & collectConversationTrace memfilter tenant yang diminta', async () => {
    const messageFind = vi.spyOn(prisma.message, 'findMany').mockResolvedValue([] as any);
    const conversationFind = vi.spyOn(prisma.conversation, 'findMany').mockResolvedValue([] as any);

    const { collectRecentMessages, collectConversationTrace } = await import('../../src/services/system-debug.service');
    await collectRecentMessages(10, 'tenant-b');
    await collectConversationTrace(10, 'tenant-b');

    expect(messageFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenant_id: 'tenant-b' } })
    );
    expect(conversationFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenant_id: 'tenant-b' } })
    );
  });
});

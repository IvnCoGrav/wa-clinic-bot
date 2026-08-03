import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messageService } from '../../src/services/message.service';
import { prisma } from '../../src/db/client';

describe('messageService.updateDeliveryStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('E1: status delivered sets delivery_status + delivered_at', async () => {
    vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const result = await messageService.updateDeliveryStatus('wamid.1', 'tenant-a', 'delivered', 1691000100);

    expect(result.matched).toBe(true);
    const arg = vi.mocked(prisma.message.updateMany).mock.calls[0][0];
    expect(arg.where).toEqual({ wa_message_id: 'wamid.1', tenant_id: 'tenant-a' });
    expect(arg.data.delivery_status).toBe('delivered');
    expect(arg.data.delivered_at).toEqual(new Date(1691000100 * 1000));
    expect(arg.data.read_at).toBeUndefined();
  });

  it('E2: status read sets read_at', async () => {
    vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    await messageService.updateDeliveryStatus('wamid.2', 'tenant-a', 'read', 1691000200);

    const arg = vi.mocked(prisma.message.updateMany).mock.calls[0][0];
    expect(arg.data.delivery_status).toBe('read');
    expect(arg.data.read_at).toEqual(new Date(1691000200 * 1000));
  });

  it('E3: status sent sets only delivery_status (no timestamps)', async () => {
    vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    await messageService.updateDeliveryStatus('wamid.3', 'tenant-a', 'sent', 1691000300);

    const arg = vi.mocked(prisma.message.updateMany).mock.calls[0][0];
    expect(arg.data.delivery_status).toBe('sent');
    expect(arg.data.delivered_at).toBeUndefined();
    expect(arg.data.read_at).toBeUndefined();
  });

  it('E4: status failed sets delivery_status failed', async () => {
    vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const result = await messageService.updateDeliveryStatus('wamid.4', 'tenant-a', 'failed', 1691000400);

    expect(result.matched).toBe(true);
    const arg = vi.mocked(prisma.message.updateMany).mock.calls[0][0];
    expect(arg.data.delivery_status).toBe('failed');
  });

  it('E5: empty waMessageId returns matched false without DB call', async () => {
    const result = await messageService.updateDeliveryStatus('', 'tenant-a', 'delivered', 1691000500);
    expect(result.matched).toBe(false);
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });

  it('E6: DB offline returns matched false, no throw', async () => {
    vi.mocked(prisma.message.updateMany).mockRejectedValueOnce(new Error('Database offline'));

    const result = await messageService.updateDeliveryStatus('wamid.6', 'tenant-a', 'delivered', 1691000600);
    expect(result.matched).toBe(false);
  });

  it('E7: updateMany count 0 (message not found) returns matched false', async () => {
    vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 0 } as any);

    const result = await messageService.updateDeliveryStatus('wamid.none', 'tenant-a', 'delivered', 1691000700);
    expect(result.matched).toBe(false);
  });
});

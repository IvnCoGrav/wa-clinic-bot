import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logOutboundMessageWithRetry } from '../../src/routes/webhook.route';
import { messageService } from '../../src/services/message.service';

/**
 * ING-09 — log outbound admin dicoba ulang (bukan ditelan sekali).
 */
describe('ING-09 retry log outbound', () => {
  const payload = {
    tenantId: 'default-tenant',
    conversationId: 'conv-1',
    direction: 'OUTBOUND',
    content: 'halo',
    waMessageId: 'wamid-1',
    senderType: 'ADMIN',
    senderName: 'Admin',
  } as any;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('berhasil pada percobaan ketiga setelah dua kegagalan', async () => {
    const spy = vi
      .spyOn(messageService, 'logMessage')
      .mockRejectedValueOnce(new Error('db sibuk'))
      .mockRejectedValueOnce(new Error('db sibuk'))
      .mockResolvedValueOnce({} as any);

    await logOutboundMessageWithRetry(payload);

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('gagal total tetap tidak melempar dan berhenti di batas percobaan', async () => {
    const spy = vi.spyOn(messageService, 'logMessage').mockRejectedValue(new Error('db mati'));

    await expect(logOutboundMessageWithRetry(payload)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

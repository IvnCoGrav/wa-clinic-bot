import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { outboundLedger } from '../../src/services/outbound-ledger.service';

/**
 * Stage 5 Fase 3 (RC-04) — Outbound ledger per-bubble.
 * begin → SENDING, markSent → SENT + provider message id, markFailed → FAILED.
 */
describe('OutboundLedger (Stage 5 / RC-04)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('begin menyimpan status SENDING dan mengembalikan id', async () => {
    vi.mocked((prisma as any).outboundAttempt.upsert).mockResolvedValueOnce({ id: 'att-1' } as any);
    const id = await outboundLedger.begin({ tenantId: 'default-tenant', turnId: 't1', bubbleIndex: 0, content: 'halo' });
    expect(id).toBe('att-1');
    const arg = vi.mocked((prisma as any).outboundAttempt.upsert).mock.calls[0][0] as any;
    expect(arg.create.status).toBe('SENDING');
  });

  it('markSent mengisi status SENT + provider_message_id', async () => {
    const spy = vi.mocked((prisma as any).outboundAttempt.update).mockResolvedValueOnce({} as any);
    await outboundLedger.markSent('att-1', 'wamid_abc');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'att-1' },
      data: expect.objectContaining({ status: 'SENT', provider_message_id: 'wamid_abc' }),
    }));
  });

  it('markFailed mengisi status FAILED + error', async () => {
    const spy = vi.mocked((prisma as any).outboundAttempt.update).mockResolvedValueOnce({} as any);
    await outboundLedger.markFailed('att-2', 'sendText failed');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('begin tanpa turnId → undefined (tidak memanggil DB)', async () => {
    const id = await outboundLedger.begin({ tenantId: 'default-tenant', turnId: '', bubbleIndex: 0, content: 'x' });
    expect(id).toBeUndefined();
  });
});

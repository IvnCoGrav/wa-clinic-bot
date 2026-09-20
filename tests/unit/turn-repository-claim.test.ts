import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { turnRepository } from '../../src/repositories/turn.repository';

/**
 * Stage 5 (RC-04) — Durable turn claim.
 * Claim atomik: RECEIVED→PROCESSING; claim kedua untuk turn sama ditolak;
 * status RESPONSE_READY/DELIVERED tidak boleh diproses ulang.
 */
describe('TurnRepository claim (Stage 5 / RC-04)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('claim pertama (RECEIVED) → sukses (count>0)', async () => {
    vi.mocked((prisma as any).inboundTurn.updateMany).mockResolvedValueOnce({ count: 1 } as any);
    const ok = await turnRepository.claimForProcessing({ tenantId: 'default-tenant', provider: 'WAHA', inboundMessageId: 'm1' });
    expect(ok).toBe(true);
  });

  it('claim kedua saat sudah RESPONSE_READY → ditolak (false)', async () => {
    vi.mocked((prisma as any).inboundTurn.updateMany).mockResolvedValueOnce({ count: 0 } as any);
    vi.mocked((prisma as any).inboundTurn.findFirst).mockResolvedValueOnce({ status: 'RESPONSE_READY' } as any);
    const ok = await turnRepository.claimForProcessing({ tenantId: 'default-tenant', provider: 'WAHA', inboundMessageId: 'm2' });
    expect(ok).toBe(false);
  });

  it('claim saat belum ter-track (findFirst null) → fail-open (true)', async () => {
    vi.mocked((prisma as any).inboundTurn.updateMany).mockResolvedValueOnce({ count: 0 } as any);
    vi.mocked((prisma as any).inboundTurn.findFirst).mockResolvedValueOnce(null as any);
    const ok = await turnRepository.claimForProcessing({ tenantId: 'default-tenant', provider: 'WAHA', inboundMessageId: 'm3' });
    expect(ok).toBe(true);
  });
});

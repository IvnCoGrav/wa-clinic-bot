import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { executeEscalateHuman } from '../../src/v3/tools/escalate-human.tool';

/**
 * Stage 5 Fase 4 (RC-04) — Escalation fail-closed.
 * DILARANG melaporkan sukses bila conversation tidak ditemukan / persist gagal.
 */
describe('executeEscalateHuman fail-closed (Stage 5 / RC-04)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('conversation tidak ditemukan → success:false, escalated:false', async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce(null as any);
    const res = await executeEscalateHuman({
      conversationId: 'missing', phone: '628111', reason: 'test', severity: 'CUSTOMER_REQUEST', tenantId: 'default-tenant',
    });
    expect(res.success).toBe(false);
    expect(res.escalated).toBe(false);
  });

  it('DB error (persist gagal) → tidak lapor sukses palsu', async () => {
    vi.mocked(prisma.conversation.findFirst).mockRejectedValueOnce(new Error('Database offline'));
    const res = await executeEscalateHuman({
      conversationId: 'conv-x', phone: '628111', reason: 'test', severity: 'CUSTOMER_REQUEST', tenantId: 'default-tenant',
    });
    expect(res.success).toBe(false);
    expect(res.escalated).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryFollowups } from '../../src/services/copilot/copilot-tools';
import { prisma } from '../../src/db/client';

describe('query_followups tool (Fase 4 — antrean follow-up)', () => {
  const tenantId = 'test-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mengambil daftar follow-up terfilter status FAILED dan dueBefore', async () => {
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([
      {
        id: 'fu-1',
        type: 'NO_PURCHASE',
        status: 'FAILED',
        scheduled_at: new Date('2026-11-02T10:00:00Z'),
        sent_at: null,
        treatment_category: 'BABY',
        customer: {
          id: 'cust-1',
          name: 'Bunda Sarah',
          phone: '6281234567890',
          conversations: [{ id: 'conv-101' }],
        },
      } as any,
    ]);

    const result = await queryFollowups.run(tenantId, {
      status: 'FAILED',
      dueBefore: '2026-11-03',
      limit: 10,
    });

    expect(result.tool).toBe('query_followups');
    expect(result.count).toBe(1);
    const row = result.rows[0];
    expect(row.customerName).toContain('Sarah');
    expect(row.conversationId).toBe('conv-101');
    expect(row.type).toBe('NO_PURCHASE');
    expect(row.status).toBe('FAILED');
    expect(row.treatmentCategory).toBe('BABY');
  });

  it('tidak membocorkan UUID dan membatasi jumlah baris sesuai parameter limit', async () => {
    const list = Array.from({ length: 15 }, (_, i) => ({
      id: `fu-${i}`,
      type: 'REMINDER_H1',
      status: 'QUEUED',
      scheduled_at: new Date(),
      customer: {
        id: `cust-${i}`,
        name: `Bunda Test ${i}`,
        phone: `62812345678${i}`,
        conversations: [],
      },
    }));

    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce(list.slice(0, 5) as any);

    const result = await queryFollowups.run(tenantId, { limit: 5 });

    expect(result.count).toBe(5);
    for (const row of result.rows) {
      expect(row).not.toHaveProperty('id');
      expect(row).not.toHaveProperty('customerId');
      expect(row).not.toHaveProperty('phone');
    }
  });
});

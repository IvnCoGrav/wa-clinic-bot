import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryFollowups, normalizeFollowUpStatus, normalizeFollowUpType } from '../../src/services/copilot/copilot-tools';
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

  it('nilai status/tipe di luar enum TIDAK diteruskan ke Prisma (anti-crash seluruh turn)', async () => {
    const spy = vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([]);

    // Dulu: status "entah" → PrismaClientValidationError → turn gagal total.
    const result = await queryFollowups.run(tenantId, { status: 'entah', type: 'ngawur' });

    expect(result.count).toBe(0);
    const where = (spy.mock.calls[0][0] as any).where;
    expect(where).not.toHaveProperty('status');
    expect(where).not.toHaveProperty('type');
    expect(where.customer.is_sandbox_test).toBe(false);
  });

  it('memetakan sinonim bahasa Indonesia ke enum yang sah', async () => {
    expect(normalizeFollowUpStatus('gagal')).toBe('FAILED');
    expect(normalizeFollowUpStatus('terkirim')).toBe('SENT');
    expect(normalizeFollowUpStatus('dibatalkan')).toBe('CANCELLED');
    expect(normalizeFollowUpStatus('GAGAL')).toBe('FAILED');
    expect(normalizeFollowUpStatus('failed')).toBe('FAILED');
    expect(normalizeFollowUpStatus('tidak-dikenal')).toBeUndefined();
    expect(normalizeFollowUpType('belum beli')).toBe('NO_PURCHASE');
    expect(normalizeFollowUpType('next treatment')).toBe('NEXT_TREATMENT');
    expect(normalizeFollowUpType('ngawur')).toBeUndefined();
  });
});

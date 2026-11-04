import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryFollowups } from '../../src/services/copilot/copilot-tools';
import { prisma } from '../../src/db/client';

describe('Copilot follow-up order & queue handling (Fase 3)', () => {
  const tenantId = 'default-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('700 baris antrean: 60 teratas diambil terurut ASC (tanggal terdekat), totalQueued & truncated ikut terbawa', async () => {
    // Buat data tiruan 700 baris dengan rentang 2026-11-05 s/d 2027-02-03
    // Skenario nyata produksi: 646 baris antrean QUEUED
    const baseDate = new Date('2026-11-05T08:00:00Z');
    const mockFollowups = Array.from({ length: 700 }, (_, i) => {
      const d = new Date(baseDate.getTime() + i * 3 * 3600 * 1000); // bertambah tiap 3 jam
      return {
        id: `fu-${i}`,
        type: 'NEXT_TREATMENT',
        status: 'QUEUED',
        scheduled_at: d,
        sent_at: null,
        treatment_category: 'BABY',
        customer: {
          id: `cust-${i}`,
          name: `Bunda Pasien ${i}`,
          phone: `6281234567${String(i).padStart(3, '0')}`,
          conversations: [{ id: `conv-${i}` }],
        },
      };
    });

    const countSpy = vi.spyOn(prisma.followUp, 'count').mockResolvedValueOnce(700);
    const findManySpy = vi.spyOn(prisma.followUp, 'findMany').mockImplementationOnce(async (args: any) => {
      // Pastikan query ke Prisma menggunakan orderBy scheduled_at asc
      expect(args.orderBy).toEqual({ scheduled_at: 'asc' });
      expect(args.take).toBe(60);
      return mockFollowups.slice(0, args.take) as any;
    });
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValueOnce({
      scheduled_at: mockFollowups[699].scheduled_at,
    } as any);

    const result = await queryFollowups.run(tenantId, {});

    expect(countSpy).toHaveBeenCalled();
    expect(findManySpy).toHaveBeenCalled();
    expect(result.count).toBe(60);
    expect(result.totalQueued).toBe(700);
    expect(result.truncated).toBe(true);

    // Tanggal baris pertama harus tanggal terdekat (5 Nov 2026), bukan Jan 2027
    expect(result.rows[0].scheduledDateWib).toBe('2026-11-05');
    expect(result.rows[0].customerName).toContain('Pasien 0');
    expect(result.rangeEarliest).toBe('2026-11-05');
    expect(result.rangeLatest).toBeTruthy();

    countSpy.mockRestore();
    findManySpy.mockRestore();
    findFirstSpy.mockRestore();
  });

  it('antrean kurang dari 60: truncated bernilai false', async () => {
    const mockList = Array.from({ length: 5 }, (_, i) => ({
      id: `fu-${i}`,
      type: 'REMINDER_H1',
      status: 'QUEUED',
      scheduled_at: new Date(`2026-11-05T0${9 + i}:00:00Z`),
      customer: { name: `Bunda Sarah ${i}`, phone: '628111' },
    }));

    vi.spyOn(prisma.followUp, 'count').mockResolvedValueOnce(5);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce(mockList as any);

    const result = await queryFollowups.run(tenantId, {});
    expect(result.count).toBe(5);
    expect(result.totalQueued).toBe(5);
    expect(result.truncated).toBe(false);
  });
});

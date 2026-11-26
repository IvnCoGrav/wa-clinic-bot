import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

// M2 — aritmatika tanggal anti-overflow. M11 — milestone menerima kategori BOTH
// dan memindai seluruh anak (bukan hanya children[0]).
describe('M2: computeNextTreatment deterministik akhir bulan (25 hari)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it('anchor 31 Okt + 25 hari → 25 Nov pada 09:00 WIB', async () => {
    // Waktu dibekukan ke 31 Okt 2026 10:00 WIB. Tanpa ini, stage 1 (25 Nov
    // 09:00 WIB) akan menjadi tanggal lampau begitu waktu riil melewatinya,
    // dan service sengaja melewati jadwal masa lalu — test jadi bom waktu.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 31, 3, 0, 0)));

    vi.spyOn(prisma.customer, 'findUnique').mockResolvedValue(null as any);
    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    // 31 Oktober 2026 (jam 10:00 WIB)
    await followUpService.createNextTreatmentFollowUps('cust-oct', new Date(Date.UTC(2026, 9, 31, 3, 0, 0)), DEFAULT_TENANT_ID);

    const stage1 = createSpy.mock.calls
      .map((c: any) => c[0]?.data)
      .find((d: any) => d?.type === 'NEXT_TREATMENT' && d?.stage === 1);
    expect(stage1).toBeTruthy();
    const s = new Date(stage1.scheduled_at);
    // November (bulan ke-10 index) tanggal 25 jam 02:00 UTC (09:00 WIB).
    expect(s.getUTCMonth()).toBe(10);
    expect(s.getUTCDate()).toBe(25);
    expect(s.getUTCHours()).toBe(2);
  });
});

describe('M11: milestone menerima BOTH & anak sekunder', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('kategori BOTH + anak ke-2 berusia ~6 bulan → MILESTONE_6M', async () => {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());

    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue({ treatment_category: 'BOTH' } as any);

    const fu: any = {
      type: 'NEXT_TREATMENT',
      customer_id: 'cust-both',
      customer: {
        children: [
          { id: 'c1', birth_date: threeYearsAgo }, // tidak match milestone
          { id: 'c2', birth_date: sixMonthsAgo },  // match ~6 bulan
        ],
      },
    };

    const result = await followUpService.resolveMilestoneType(fu, DEFAULT_TENANT_ID);
    expect(result).toBe('MILESTONE_6M');
  });

  it('kategori BABY (bukan BOTH) tetap diterima', async () => {
    const now = new Date();
    const nineMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 9, now.getDate());
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue({ treatment_category: 'BABY' } as any);

    const result = await followUpService.resolveMilestoneType(
      { type: 'NEXT_TREATMENT', customer_id: 'c', customer: { children: [{ birth_date: nineMonthsAgo }] } } as any,
      DEFAULT_TENANT_ID
    );
    expect(result).toBe('MILESTONE_9M');
  });
});

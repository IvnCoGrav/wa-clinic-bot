import { describe, it, expect, vi, beforeEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { typingService } from '../../src/services/typing.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Fase 2: Konkurensi sendNow dan Sebaran Deterministik', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('2.1 sendNow dua panggilan paralel untuk ID sama -> 1 sukses, 1 throw', async () => {
    const claimed = new Set<string>();

    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue({
      id: 'fu-concurrency-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-concurrency-1',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(),
      status: 'QUEUED',
      customer: {
        id: 'cust-concurrency-1',
        phone: '6281299990001',
        name: 'Bunda Concurrency',
        is_sandbox_test: true,
        children: [],
      },
    } as any);

    vi.spyOn(prisma.followUp, 'updateMany').mockImplementation((async (args: any) => {
      const id = args?.where?.id;
      if (id && claimed.has(id)) return { count: 0 };
      if (id) claimed.add(id);
      return { count: 1 };
    }) as any);

    vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({
      status: 'QUEUED',
      scheduled_at: new Date(),
    } as any);

    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
    vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({
      success: true,
      bubblesSent: 1,
    } as any);

    const call1 = followUpService.sendNow('fu-concurrency-1', DEFAULT_TENANT_ID);
    const call2 = followUpService.sendNow('fu-concurrency-1', DEFAULT_TENANT_ID);

    const results = await Promise.allSettled([call1, call2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('sedang diproses');
  });

  it('2.2 Sebaran hash deterministik: 20 seed menghasilkan jam 09:30-10:15 WIB dan terdistribusi', () => {
    const anchor = new Date('2026-10-07T00:00:00Z');
    const svc = followUpService as any;

    const results: Date[] = [];
    const seeds = Array.from({ length: 20 }, (_, i) => `customer-seed-${i}`);

    for (const seed of seeds) {
      const d1 = svc.computeScheduleAtWib0940(anchor, 3, seed);
      const d2 = svc.computeScheduleAtWib0940(anchor, 3, seed);
      // Sifat deterministik mutlak: seed sama menghasilkan timestamp persis sama
      expect(d1.getTime()).toBe(d2.getTime());

      // Konversi ke WIB (+7 jam)
      const wibHours = (d1.getUTCHours() + 7) % 24;
      const wibMinutes = d1.getUTCMinutes();

      // Wajib berada di rentang 09:30 - 10:15 WIB
      const totalMinutesFromMidnight = wibHours * 60 + wibMinutes;
      expect(totalMinutesFromMidnight).toBeGreaterThanOrEqual(9 * 60 + 30);
      expect(totalMinutesFromMidnight).toBeLessThanOrEqual(10 * 60 + 15);

      results.push(d1);
    }

    // Variasi detik tidak serentak 00.000 untuk semua seed
    const seconds = new Set(results.map((d) => d.getUTCSeconds()));
    expect(seconds.size).toBeGreaterThan(1);

    // Variasi menit tersebar (tidak menumpuk di 1 menit saja)
    const minutes = new Set(results.map((d) => d.getUTCMinutes()));
    expect(minutes.size).toBeGreaterThan(5);
  });
});

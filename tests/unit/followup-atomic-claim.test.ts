import { describe, it, expect, vi, beforeEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { typingService } from '../../src/services/typing.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

// V5/H3 — Klaim atomik anti dobel-kirim. Simulasi dua pemroses (worker periodik
// vs admin "Kirim Sekarang") memproses ID yang sama secara bersamaan. Database
// nyata menegakkan klaim via UPDATE ... WHERE processing_claimed_at IS NULL;
// di sini kita tirukan kontraknya secara stateful.
describe('V5/H3: klaim atomik — tepat 1 kirim saat dua pemroses balapan', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('dua executeFollowUp paralel untuk ID sama → hanya satu yang mengirim', async () => {
    const claimed = new Set<string>();
    vi.spyOn(prisma.followUp, 'updateMany').mockImplementation((async (args: any) => {
      const id = args?.where?.id;
      if (id && claimed.has(id)) return { count: 0 };
      if (id) claimed.add(id);
      return { count: 1 };
    }) as any);
    // Re-check status: baris masih aktif (tidak abort).
    vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({ status: 'QUEUED', scheduled_at: new Date() } as any);
    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 } as any);

    const fu = {
      id: 'fu-race-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-race',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(),
      status: 'QUEUED',
      customer: { id: 'cust-race', phone: '6281200000001', name: 'Bunda Race', children: [] },
    } as any;

    const [a, b] = await Promise.all([
      followUpService.executeFollowUp({ ...fu }, DEFAULT_TENANT_ID),
      followUpService.executeFollowUp({ ...fu }, DEFAULT_TENANT_ID),
    ]);

    // Tepat satu sukses, satu ditolak klaim.
    expect([a, b].filter(Boolean).length).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

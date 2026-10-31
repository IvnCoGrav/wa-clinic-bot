/**
 * Fase 3 — Gerbang deterministik variabel & placeholder.
 *
 * Kontrak yang diuji (seam publik):
 *  1. Template keluarga MOMS DILARANG disimpan bila memuat `{babyName}`
 *     (bukan auto-hapus → menghindari mutilasi kalimat buatan admin).
 *  2. Template keluarga ANAK tetap boleh memuat `{babyName}` (anti-regresi).
 *  3. Pengiriman DIBATALKAN bila setelah substitusi masih ada placeholder mentah
 *     (`{apapun}`) — status FAILED + alasan, TIDAK ada pesan keluar.
 *  4. Template normal tanpa placeholder sisa tetap terkirim (anti-regresi).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService, CANCEL_REASON } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const makeFu = (overrides: any = {}): any => ({
  id: 'fu-gate-1',
  tenant_id: DEFAULT_TENANT_ID,
  customer_id: 'cust-gate-1',
  type: 'NEXT_TREATMENT',
  stage: 1,
  scheduled_at: new Date(Date.now() - 1000),
  status: 'QUEUED',
  customer: {
    id: 'cust-gate-1',
    name: 'Ismail',
    phone: '6281252901109',
    children: [],
    labels: [],
    conversations: [],
    preferences: {},
  },
  ...overrides,
});

async function runFollowUp(fu: any, template: any): Promise<{ ok: boolean; sent: number; updateCalls: any[] }> {
  const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
  vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
  vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
  vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
  vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({ status: 'QUEUED', scheduled_at: new Date() } as any);
  const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
  vi.spyOn(prisma.followUpTemplate, 'findFirst').mockResolvedValue(template as any);

  const { typingService } = await import('../../src/services/typing.service');
  const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);

  const ok = await followUpService.executeFollowUp(fu, DEFAULT_TENANT_ID);
  return {
    ok,
    sent: sendSpy.mock.calls.length,
    updateCalls: updateSpy.mock.calls.map((c: any) => c[0]),
  };
}

describe('Fase 3 — gerbang placeholder & variabel terlarang', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    vi.restoreAllMocks();
  });

  it('1. template MOMS memuat {babyName} -> DITOLAK saat simpan, tidak menyentuh DB', async () => {
    const upsertSpy = vi.spyOn(prisma.followUpTemplate, 'upsert').mockResolvedValue({} as any);

    await expect(
      followUpService.saveTemplate(
        'NEXT_TREATMENT_MOMS_1',
        1,
        'Halo Bunda {name}! Bagaimana kabar {babyName} hari ini?',
        DEFAULT_TENANT_ID
      )
    ).rejects.toThrow(/babyName/i);

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('2. template MOMS tanpa variabel bayi -> tersimpan', async () => {
    const upsertSpy = vi.spyOn(prisma.followUpTemplate, 'upsert').mockResolvedValue({} as any);

    await followUpService.saveTemplate(
      'NEXT_TREATMENT_MOMS_1',
      1,
      'Halo Bunda {name}! Bagaimana kondisi badan Bunda sekarang?',
      DEFAULT_TENANT_ID
    );

    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it('3. template ANAK tetap boleh memuat {babyName} (anti-regresi)', async () => {
    const upsertSpy = vi.spyOn(prisma.followUpTemplate, 'upsert').mockResolvedValue({} as any);

    await followUpService.saveTemplate(
      'NEXT_TREATMENT_1',
      1,
      'Halo Bunda {name}! Yuk pijat rutin {babyName} bulan ini.',
      DEFAULT_TENANT_ID
    );

    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it('4. placeholder mentah tersisa -> TIDAK ada pesan keluar, status FAILED + alasan', async () => {
    const res = await runFollowUp(makeFu({ treatment_category: 'MOMS' }), {
      text: 'Halo Bunda {name}! Sesi {namaTerapis} menunggu Bunda ya.',
    });

    expect(res.ok).toBe(false);
    expect(res.sent).toBe(0);

    const failed = res.updateCalls.find((c: any) => c?.data?.status === 'FAILED');
    expect(failed).toBeTruthy();
    expect(failed.data.cancel_reason).toBe(CANCEL_REASON.UNRESOLVED_PLACEHOLDER);
  });

  it('5. template normal tanpa placeholder sisa -> tetap terkirim', async () => {
    const res = await runFollowUp(makeFu({ treatment_category: 'MOMS' }), {
      text: 'Halo Bunda {name}! Kami siap bantu jadwalkan perawatan Bunda lagi.',
    });

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(1);
  });
});

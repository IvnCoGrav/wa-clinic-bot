/**
 * Fase 6 — Satu seam pengirim (anti mesin ganda).
 *
 * Kontrak:
 *  1. Worker broadcast TIDAK boleh menyusun teks sendiri / memanggil gateway
 *     langsung; seluruh pengiriman didelegasikan ke `followUpService.executeFollowUp`.
 *  2. Kegagalan seam kanonis TIDAK boleh ditandai SENT.
 *  3. Status terminal (FAILED) yang ditetapkan seam kanonis TIDAK boleh ditimpa
 *     menjadi PENDING oleh catch worker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcastQueueService } from '../../src/services/broadcast-queue.service';
import { followUpService } from '../../src/services/follow-up.service';
import { typingService } from '../../src/services/typing.service';
import { whatsappProviderService } from '../../src/services/whatsapp-provider.service';
import { conversationService } from '../../src/services/conversation.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const JOB = { followUpId: 'fu-seam-1', customerId: 'cust-seam-1', tenantId: DEFAULT_TENANT_ID };

const queuedRow = (): any => ({
  id: JOB.followUpId,
  tenant_id: DEFAULT_TENANT_ID,
  customer_id: JOB.customerId,
  type: 'NEXT_TREATMENT',
  stage: 1,
  status: 'QUEUED',
  scheduled_at: new Date(),
  customer: { id: JOB.customerId, phone: '6281252901109', name: 'Ismail', status: 'active' },
});

describe('Fase 6 — satu seam pengirim follow-up', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Kunci jam ke dalam jam kerja agar worker tidak menunda ke besok.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T10:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function primeHappyPath() {
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
    vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue(queuedRow());
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue({ id: 'conv-seam-1' } as any);
    vi.spyOn(conversationService, 'bolehKirimProaktif').mockReturnValue(true as any);
    return { updateSpy };
  }

  it('1. delegasi ke seam kanonis, tanpa memanggil gateway langsung', async () => {
    primeHappyPath();
    const executeSpy = vi.spyOn(followUpService, 'executeFollowUp').mockResolvedValue(true as any);
    const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);

    await broadcastQueueService.processBroadcastJob(JOB as any);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][0]).toMatchObject({ id: JOB.followUpId, type: 'NEXT_TREATMENT' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('2. seam kanonis menolak kirim -> TIDAK ditandai SENT', async () => {
    const { updateSpy } = primeHappyPath();
    vi.spyOn(followUpService, 'executeFollowUp').mockResolvedValue(false as any);

    await broadcastQueueService.processBroadcastJob(JOB as any);

    const sentUpdate = updateSpy.mock.calls.find((c: any) => c[0]?.data?.status === 'SENT');
    expect(sentUpdate).toBeUndefined();
  });

  it('3. status FAILED dari seam kanonis tidak ditimpa menjadi PENDING', async () => {
    const { updateSpy } = primeHappyPath();
    vi.spyOn(followUpService, 'executeFollowUp').mockResolvedValue(false as any);
    // Pembacaan status kedua (di catch) menunjukkan FAILED.
    vi.mocked(prisma.followUp.findUnique)
      .mockResolvedValueOnce(queuedRow())
      .mockResolvedValue({ status: 'FAILED' } as any);

    await broadcastQueueService.processBroadcastJob(JOB as any);

    const pendingUpdate = updateSpy.mock.calls.find((c: any) => c[0]?.data?.status === 'PENDING');
    expect(pendingUpdate).toBeUndefined();
  });
});

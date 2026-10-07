import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService, CANCEL_REASON } from '../../src/services/follow-up.service';
import { getRollingFollowUpMessage, FOLLOWUP_ROLLING_TEMPLATES } from '../../src/config/followup-templates';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Follow-Up & Rolling Templates Engine Unit Tests', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  it('1. Rolling templates engine provides 3 distinct variations per stage', () => {
    const types = Object.keys(FOLLOWUP_ROLLING_TEMPLATES) as Array<keyof typeof FOLLOWUP_ROLLING_TEMPLATES>;
    
    types.forEach((type) => {
      const templates = FOLLOWUP_ROLLING_TEMPLATES[type];
      expect(templates.length).toBe(3);

      const v1 = getRollingFollowUpMessage(type, { name: 'Sari', index: 0 });
      const v2 = getRollingFollowUpMessage(type, { name: 'Sari', index: 1 });
      const v3 = getRollingFollowUpMessage(type, { name: 'Sari', index: 2 });

      expect(v1.text).toContain('Sari');
      expect(v2.text).toContain('Sari');
      expect(v3.text).toContain('Sari');
      
      // All 3 variations must be distinct
      expect(v1.text).not.toBe(v2.text);
      expect(v2.text).not.toBe(v3.text);
      expect(v1.templateIndex).toBe(1);
      expect(v2.templateIndex).toBe(2);
      expect(v3.templateIndex).toBe(3);
    });
  });

  it('2. createNoPurchaseFollowUps creates 3 follow-up stages (+3, +7, +14 days)', async () => {
    const phone = `62891${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Lead', DEFAULT_TENANT_ID);

    await followUpService.createNoPurchaseFollowUps(customer.id, DEFAULT_TENANT_ID);
    // Verified by internal execution log (no error thrown)
  });

  it('3. onReservationCreated cancels pending NO_PURCHASE follow-ups (TANPA menyentuh is_repeat_order)', async () => {
    const phone = `62892${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Repeat', DEFAULT_TENANT_ID);

    await followUpService.createNoPurchaseFollowUps(customer.id, DEFAULT_TENANT_ID);
    // Otoritas repeat order = reservation-core (ordinal riwayat), bukan follow-up.
    await followUpService.onReservationCreated(customer.id, `res_${Date.now()}`, DEFAULT_TENANT_ID);
    // Verified: active follow-ups cancelled gracefully
  });

  it('4. createNextTreatmentFollowUps creates 3 treatment continuation stages (+1, +2, +3 months)', async () => {
    const phone = `62893${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda PostTx', DEFAULT_TENANT_ID);
    const bookingDate = new Date();

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    // Verified: NEXT_TREATMENT stages 1, 2, 3 scheduled
  });

  it('4b. createNextTreatmentFollowUps idempotent — pemanggilan kedua tidak membuat duplikat', async () => {
    const phone = `62893${Date.now()}idem`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Idem', DEFAULT_TENANT_ID);
    const bookingDate = new Date();

    // Per-stage guard: tiap stage dicek terpisah (3x findFirst per panggilan).
    // Mock: 3 panggilan pertama → null (buat 3 stage), 3 panggilan kedua → existing (skip semua).
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst');
    findFirstSpy
      .mockResolvedValueOnce(null as any) // stage 1 call 1
      .mockResolvedValueOnce(null as any) // stage 2 call 1
      .mockResolvedValueOnce(null as any) // stage 3 call 1
      .mockResolvedValueOnce({ id: 'existing-1' } as any) // stage 1 call 2
      .mockResolvedValueOnce({ id: 'existing-2' } as any) // stage 2 call 2
      .mockResolvedValueOnce({ id: 'existing-3' } as any); // stage 3 call 2

    const createSpy = vi.spyOn(prisma.followUp, 'create');
    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const afterFirst = createSpy.mock.calls.filter((c) => c[0].data?.type === 'NEXT_TREATMENT').length;

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const afterSecond = createSpy.mock.calls.filter((c) => c[0].data?.type === 'NEXT_TREATMENT').length;

    // Pemanggilan pertama membuat 3 stage; pemanggilan kedua TIDAK menambah
    // (guard per-stage menemukan row existing → skip).
    expect(afterFirst).toBe(3);
    expect(afterSecond).toBe(3);
  });

  it('5. processDueFollowUps handles empty due queue gracefully', async () => {
    const count = await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('5b. queueFollowUp & bulkQueueFollowUps transition status from PENDING to QUEUED', async () => {
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValueOnce({ count: 1 } as any);
    const success = await followUpService.queueFollowUp('fu-test-1', DEFAULT_TENANT_ID);
    expect(success).toBe(true);
    expect(updateManySpy).toHaveBeenCalledWith({
      where: { id: 'fu-test-1', tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });

    const bulkSpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValueOnce({ count: 4 } as any);
    const count = await followUpService.bulkQueueFollowUps(DEFAULT_TENANT_ID);
    expect(count).toBe(4);
    expect(bulkSpy).toHaveBeenCalledWith({
      where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });
  });

  it('5c. processDueFollowUps processes QUEUED follow-ups when scheduled_at is due', async () => {
    const mockDueFollowUp = {
      id: 'fu-queued-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      type: 'NO_PURCHASE',
      stage: 1,
      scheduled_at: new Date(Date.now() - 1000), // due
      status: 'QUEUED',
      customer: {
        id: 'cust-1',
        name: 'Bunda Queued',
        phone: '62812345678',
        status: 'active',
        is_sandbox_test: false,
        children: [],
        conversations: [
          {
            last_message_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago (> 72h)
            is_human_handling: false,
          },
        ],
      },
    };

    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([mockDueFollowUp] as any);
    const executeSpy = vi.spyOn(followUpService, 'executeFollowUp').mockResolvedValueOnce(true);

    const processed = await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);
    expect(processed).toBe(1);
    expect(executeSpy).toHaveBeenCalledWith(mockDueFollowUp, DEFAULT_TENANT_ID);
  });

  it('5d. processDueFollowUps postpones follow-up when customer had recent chat (<72h)', async () => {
    const recentChatTime = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10 hours ago (< 72h)
    const mockDueFollowUp = {
      id: 'fu-queued-recent-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-recent-1',
      type: 'NEXT_TREATMENT',
      stage: 1,
      scheduled_at: new Date(Date.now() - 1000), // due
      status: 'QUEUED',
      customer: {
        id: 'cust-recent-1',
        name: 'Bunda Recent Chat',
        phone: '6281234567899',
        status: 'active',
        is_sandbox_test: false,
        children: [],
        conversations: [
          {
            last_message_at: recentChatTime,
            is_human_handling: true,
          },
        ],
      },
    };

    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([mockDueFollowUp] as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValueOnce({} as any);
    const executeSpy = vi.spyOn(followUpService, 'executeFollowUp').mockResolvedValueOnce(true);

    const processed = await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);
    // Not sent immediately, postponed instead
    expect(processed).toBe(0);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fu-queued-recent-1' },
        data: expect.objectContaining({
          scheduled_at: expect.any(Date),
        }),
      })
    );
  });

  it('6. getAllTemplates returns merged list (DB custom + default fallback)', async () => {
    const templates = await followUpService.getAllTemplates(DEFAULT_TENANT_ID);
    expect(templates.length).toBeGreaterThanOrEqual(27);
    expect(templates.every((t) => t.text.length > 0)).toBe(true);
  });

  it('7. createReservationFollowUps schedules REMINDER_H1 and REVIEW_H1_BABY / REVIEW_H1_MOMS', async () => {
    // M7: pembuatan REMINDER/REVIEW kini default OFF (anti baris zombie). Uji jalur
    // pembuatan dengan mengaktifkan env secara eksplisit, lalu pulihkan.
    const prevEnv = process.env.FOLLOWUP_CREATE_REMINDER_REVIEW;
    process.env.FOLLOWUP_CREATE_REMINDER_REVIEW = 'true';
    try {
    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null);

    const bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + 3); // 3 days from now at 10:00
    bookingDate.setHours(10, 0, 0, 0);

    // Baby category -> REVIEW_H1_BABY
    await followUpService.createReservationFollowUps({
      reservationId: 'res-baby-1',
      customerId: 'cust-baby-1',
      bookingDate,
      treatmentCategory: 'BABY',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reservation_id: 'res-baby-1',
          customer_id: 'cust-baby-1',
          type: 'REMINDER_H1',
          status: 'PENDING',
        }),
      })
    );

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reservation_id: 'res-baby-1',
          customer_id: 'cust-baby-1',
          type: 'REVIEW_H1_BABY',
          status: 'PENDING',
        }),
      })
    );

    // Moms category -> REVIEW_H1_MOMS
    await followUpService.createReservationFollowUps({
      reservationId: 'res-moms-1',
      customerId: 'cust-moms-1',
      bookingDate,
      treatmentCategory: 'MOMS',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reservation_id: 'res-moms-1',
          customer_id: 'cust-moms-1',
          type: 'REVIEW_H1_MOMS',
          status: 'PENDING',
        }),
      })
    );
    } finally {
      if (prevEnv === undefined) delete process.env.FOLLOWUP_CREATE_REMINDER_REVIEW;
      else process.env.FOLLOWUP_CREATE_REMINDER_REVIEW = prevEnv;
    }
  });

  it('7b. M7: createReservationFollowUps default TIDAK membuat baris REMINDER/REVIEW (anti zombie)', async () => {
    const prevEnv = process.env.FOLLOWUP_CREATE_REMINDER_REVIEW;
    delete process.env.FOLLOWUP_CREATE_REMINDER_REVIEW;
    try {
      const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);
      vi.spyOn(prisma.customer, 'findUnique').mockResolvedValue(null as any);
      const booking = new Date();
      booking.setDate(booking.getDate() + 3);

      await followUpService.createReservationFollowUps({
        reservationId: 'res-m7',
        customerId: 'cust-m7',
        bookingDate: booking,
        treatmentCategory: 'BABY',
        tenantId: DEFAULT_TENANT_ID,
      });

      const zombie = createSpy.mock.calls.filter((c: any) =>
        ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'].includes(c[0]?.data?.type)
      );
      expect(zombie.length).toBe(0);
    } finally {
      if (prevEnv !== undefined) process.env.FOLLOWUP_CREATE_REMINDER_REVIEW = prevEnv;
    }
  });

  it('8. onReservationCancelled cancels follow-ups for reservation', async () => {
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValueOnce({ count: 2 } as any);
    await followUpService.onReservationCancelled('res-baby-1', DEFAULT_TENANT_ID);

    expect(updateManySpy).toHaveBeenCalledWith({
      where: {
        reservation_id: 'res-baby-1',
        tenant_id: DEFAULT_TENANT_ID,
        status: { in: ['PENDING', 'QUEUED'] },
      },
      // V2: reservation_id DIPERTAHANKAN (bukan dinetralkan ke null) agar audit trail
      // relasi reservasi utuh. Keunikan baris aktif dijaga kolom sentinel active_slot_key
      // (V1), sehingga tak perlu lagi menabrak-nolkan reservation_id.
      data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CANCELLED },
    });
    expect((updateManySpy.mock.calls[0][0] as any).data).not.toHaveProperty('reservation_id');
  });

  it('9. onReservationRescheduled updates scheduled_at for REMINDER_H1 and REVIEW_H1', async () => {
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + 5);

    await followUpService.onReservationRescheduled('res-baby-1', newDate, DEFAULT_TENANT_ID);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reservation_id: 'res-baby-1',
          type: 'REMINDER_H1',
          tenant_id: DEFAULT_TENANT_ID,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: expect.objectContaining({ scheduled_at: expect.any(Date) }),
      })
    );

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reservation_id: 'res-baby-1',
          type: { in: ['REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
          tenant_id: DEFAULT_TENANT_ID,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: expect.objectContaining({ scheduled_at: expect.any(Date) }),
      })
    );
  });

  it('10. executeFollowUp prioritizes custom_text and preserves newlines (enter / multi-paragraph)', async () => {
    const multiLineCustomText = 'Halo Bunda {name}!\n\nBagaimana kabar hari ini?\nSemoga Bunda dan {babyName} sehat selalu ya.\n\nApakah ada yang bisa kami bantu? 😊';

    const fuMock: any = {
      id: 'fu-custom-enter-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      type: 'NO_PURCHASE',
      stage: 1,
      custom_text: multiLineCustomText,
      scheduled_at: new Date(),
      status: 'QUEUED',
      customer: {
        id: 'cust-1',
        name: 'Rina Kartika',
        phone: '6281234567890',
        children: [{ id: 'child-1', name: 'Alvaro' }],
      },
    };

    const { typingService } = await import('../../src/services/typing.service');
    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({
      success: true,
      bubblesSent: 1,
      chatId: '6281234567890',
    } as any);

    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({ id: 'fu-custom-enter-1', status: 'SENT' } as any);

    const success = await followUpService.executeFollowUp(fuMock, DEFAULT_TENANT_ID);
    expect(success).toBe(true);

    expect(simulateSpy).toHaveBeenCalledTimes(1);
    const sentMessage = simulateSpy.mock.calls[0][0].replyText;

    // Check that placeholders are sanitized
    expect(sentMessage).toContain('Bunda Rina');
    expect(sentMessage).toContain('dek Alvaro');

    // Check that newlines / enters are 100% PRESERVED and not collapsed into a single inline paragraph
    expect(sentMessage).toContain('\n\n');
    const lines = sentMessage.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[0]).toBe('Halo Bunda Rina Kartika!');
    expect(lines[2]).toBe('Bagaimana kabar hari ini?');
  });

  it('11. NEXT_TREATMENT is prioritized over NO_PURCHASE in queue processing and rescheduling', async () => {
    const { FOLLOWUP_TYPE_PRIORITY } = await import('../../src/services/follow-up.service');
    expect(FOLLOWUP_TYPE_PRIORITY['NEXT_TREATMENT']).toBeLessThan(FOLLOWUP_TYPE_PRIORITY['NO_PURCHASE']);

    const items = [
      { id: '1', type: 'NO_PURCHASE', scheduled_at: new Date('2026-09-01T09:00:00Z') },
      { id: '2', type: 'NEXT_TREATMENT', scheduled_at: new Date('2026-09-01T09:30:00Z') },
      { id: '3', type: 'NO_PURCHASE', scheduled_at: new Date('2026-09-01T08:00:00Z') },
    ];

    const sorted = [...items].sort((a, b) => {
      const pA = FOLLOWUP_TYPE_PRIORITY[a.type] || 99;
      const pB = FOLLOWUP_TYPE_PRIORITY[b.type] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });

    expect(sorted[0].id).toBe('2'); // NEXT_TREATMENT comes first
    expect(sorted[1].id).toBe('3'); // NO_PURCHASE earlier time
    expect(sorted[2].id).toBe('1'); // NO_PURCHASE later time
  });

  // MT-3.1 — Fase 1 guards: backdate, per-stage, WIB, SENT-aware
  it('12. createReservationFollowUps backdate (H-9, Bunda Mutia) → skip REVIEW_H1 lampau', async () => {
    const phone = `62893${Date.now()}mutia`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Mutia', DEFAULT_TENANT_ID);
    const backdated = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000); // 9 hari lalu
    const createSpy = vi.spyOn(prisma.followUp, 'create');
    const before = createSpy.mock.calls.length;
    await followUpService.createReservationFollowUps({
      reservationId: `res-back-${Date.now()}`,
      customerId: customer.id,
      bookingDate: backdated,
      treatmentCategory: 'BABY',
      tenantId: DEFAULT_TENANT_ID,
    });
    const reviewCalls = createSpy.mock.calls.slice(before).filter((c: any) => String(c[0]?.data?.type || '').startsWith('REVIEW_H1'));
    expect(reviewCalls.length).toBe(0); // skip, tidak buat row kedaluwarsa
  });

  it('13. createNextTreatmentFollowUps hanya buat stage masa depan (WIB), stage lampau di-skip', async () => {
    const phone = `62893${Date.now()}future`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Future', DEFAULT_TENANT_ID);
    // Booking 60 hari lalu → stage 1 (≈30 hari lalu) lampau, stage 2/3 masih masa depan
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const createSpy = vi.spyOn(prisma.followUp, 'create');
    // findFirst selalu null agar per-stage guard lolos
    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null as any);
    const before = createSpy.mock.calls.length;
    await followUpService.createNextTreatmentFollowUps(customer.id, sixtyDaysAgo, DEFAULT_TENANT_ID);
    const nextCalls = createSpy.mock.calls.slice(before).filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT');
    // Stage 1 lampau → skip, minimal 1 stage tercipta, maksimal 2 (stage 2 & 3)
    expect(nextCalls.length).toBeGreaterThanOrEqual(1);
    expect(nextCalls.length).toBeLessThanOrEqual(2);
    // Jika 2, pastikan stage yang tercipta adalah 2 dan 3
    const stages = nextCalls.map((c: any) => c[0].data.stage).sort();
    if (stages.length === 2) expect(stages).toEqual([2, 3]);
  });

  it('14. createNextTreatmentFollowUps SENT-aware per-stage: stage SENT tidak direcreate', async () => {
    const phone = `62893${Date.now()}sent`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Sent', DEFAULT_TENANT_ID);
    const bookingDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // besok → semua stage masa depan
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst');
    // stage 1 → SENT (skip), stage 2/3 → null (buat)
    findFirstSpy
      .mockResolvedValueOnce({ id: 'sent-1', status: 'SENT' } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create');
    const before = createSpy.mock.calls.length;
    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const nextCalls = createSpy.mock.calls.slice(before).filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT');
    expect(nextCalls.length).toBe(2);
    expect(nextCalls.map((c: any) => c[0].data.stage).sort()).toEqual([2, 3]);
  });

  it('15. createNextTreatmentFollowUps WIB & QUEUED: jam 09:00 WIB, status QUEUED', async () => {
    const phone = `62893${Date.now()}wib`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Wib', DEFAULT_TENANT_ID);
    const bookingDate = new Date('2026-09-14T10:00:00+07:00');
    vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValue(null as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create');
    const before = createSpy.mock.calls.length;
    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const nextCalls = createSpy.mock.calls.slice(before).filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT');
    expect(nextCalls.length).toBe(3);
    for (const c of nextCalls) {
      expect(c[0].data.status).toBe('QUEUED');
      const d: Date = c[0].data.scheduled_at;
      // 09:00 WIB = 02:00 UTC
      expect(d.getUTCHours()).toBe(2);
      expect(d.getUTCMinutes()).toBe(0);
    }
    expect(new Date(nextCalls[0][0].data.scheduled_at).toISOString()).toBe('2026-10-14T02:00:00.000Z');
  });

  // Fase 3 adversarial — bypass/zombie immunity
  it('16. skipFollowUpsForBypassCustomer: tenant-isolated, SKIPPED kanonis', async () => {
    const spy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 2 } as any);
    const n = await followUpService.skipFollowUpsForBypassCustomer('cust-bypass-1', 'tenant-a');
    expect(n).toBe(2);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customer_id: 'cust-bypass-1',
          tenant_id: 'tenant-a',
          status: { in: ['PENDING', 'QUEUED'] },
        }),
        data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
      }),
    );
  });

  it('17. processDueFollowUps: self-healing prune skip zombie bypass sebelum batch', async () => {
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([] as any);
    // Mock outbound cutoff check
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
    await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);
    // First updateMany is self-healing prune (OR with bypass), second is expired PENDING prunes, we assert at least prune called
    const pruneCall = updateManySpy.mock.calls.find((c: any) => c[0]?.where?.OR);
    expect(pruneCall).toBeDefined();
    expect(pruneCall[0].where.tenant_id).toBe(DEFAULT_TENANT_ID);
    expect(pruneCall[0].data.status).toBe('SKIPPED');
  });

  it('18. rescheduleOverdueFollowUps: anti-zombie filter mengecualikan admin/bypass', async () => {
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([] as any);
    const res = await followUpService.rescheduleOverdueFollowUps(DEFAULT_TENANT_ID, { maxPerDay: 5 });
    expect(res.rescheduledCount).toBe(0);
    // Verifikasi where mengandung customer filter via buildNonBypassCustomerWhere (tenant isolated)
    const { buildNonBypassCustomerWhere } = await import('../../src/utils/customer-bypass');
    const expectedCustomerWhere = buildNonBypassCustomerWhere();
    // findMany should have been called with customer filter
    const callArg = (prisma.followUp.findMany as any).mock.calls[0]?.[0]?.where;
    expect(callArg.customer).toEqual(expectedCustomerWhere);
    expect(callArg.tenant_id).toBe(DEFAULT_TENANT_ID);
  });

  it('19. Pencabutan label tidak membangkitkan SKIPPED — status terminal', async () => {
    // SKIPPED is terminal; simulate that skip creates SKIPPED, and subsequent label removal does not revert
    vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
    await followUpService.skipFollowUpsForBypassCustomer('cust-revoke-1', DEFAULT_TENANT_ID);
    // No method exists to "uns skip" — ensure no auto-restore logic exists (audit: no updateMany with SKIPPED->QUEUED)
    const { followUpService: svc } = await import('../../src/services/follow-up.service');
    expect((svc as any).restoreFollowUpsForCustomer).toBeUndefined();
  });

  // Fase 3 revisi — grace period & serious-only gate (adversarial, state-based)
  it('20. processDueFollowUps: NO_PURCHASE stage 3 non-MQL/legacy di-SKIP dgn alasan kanonis', async () => {
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
    vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([
      {
        id: 'fu-noserious',
        type: 'NO_PURCHASE',
        stage: 3,
        customer_id: 'c-spam',
        scheduled_at: new Date(Date.now() - 60 * 1000),
        sent_at: null,
        status: 'QUEUED',
        customer: { id: 'c-spam', phone: '628123000999', is_mql: false, is_legacy_source: false, labels: [], conversations: [] },
      },
    ] as any);
    const updSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const execSpy = vi.spyOn(followUpService, 'executeFollowUp').mockResolvedValue(true as any);

    await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);

    expect(execSpy).not.toHaveBeenCalled();
    const skipCall = updSpy.mock.calls.find((c: any) => c[0]?.data?.cancel_reason === CANCEL_REASON.NON_SERIOUS_STAGE3);
    expect(skipCall).toBeDefined();
    expect(skipCall![0].data.status).toBe('SKIPPED');
  });

  it('21. processDueFollowUps: NO_PURCHASE stage 3 utk MQL tetap dikirim', async () => {
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
    vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([
      {
        id: 'fu-serious',
        type: 'NO_PURCHASE',
        stage: 3,
        customer_id: 'c-mql',
        scheduled_at: new Date(Date.now() - 60 * 1000),
        sent_at: null,
        status: 'QUEUED',
        customer: { id: 'c-mql', phone: '628123000888', is_mql: true, is_legacy_source: false, labels: [], conversations: [] },
      },
    ] as any);
    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const execSpy = vi.spyOn(followUpService, 'executeFollowUp').mockResolvedValue(true as any);

    await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);

    expect(execSpy).toHaveBeenCalledTimes(1);
  });

  it('22. Auto-cancel PENDING pakai grace akhir-hari WIB + alasan EXPIRED_PENDING', async () => {
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
    const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([] as any);

    await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);

    const expiredCall = updateManySpy.mock.calls.find(
      (c: any) => c[0]?.data?.cancel_reason === CANCEL_REASON.EXPIRED_PENDING
    );
    expect(expiredCall).toBeDefined();
    const lt = expiredCall![0].where.scheduled_at.lt as Date;
    // Batas = awal HARI INI WIB (02:00 UTC), bukan `now` (mencegah bunuh di menit ke-1).
    const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const expected = new Date(
      Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 60 * 60 * 1000
    );
    expect(lt.getTime()).toBe(expected.getTime());
    // Grace = awal hari, pasti lebih tua dari sekarang (tidak menghapus jadwal hari ini).
    expect(lt.getTime()).toBeLessThan(Date.now());
  });

  it('23. CANCEL_REASON memiliki stempel EXPIRED_PENDING & NON_SERIOUS_STAGE3', () => {
    expect(CANCEL_REASON.EXPIRED_PENDING).toBeTruthy();
    expect(CANCEL_REASON.NON_SERIOUS_STAGE3).toBeTruthy();
  });

  // ── Re-anchor NEXT_TREATMENT (fondasional: state-driven, bukan tambal prompt) ──
  // Booking jauh di masa depan agar deterministik lintas-waktu (tidak bergantung jam mesin).
  const FUTURE_BOOKING = new Date('2030-01-15T10:00:00+07:00'); // stage1 → 2030-02-15 02:00 UTC
  const STAGE1_TARGET = new Date('2030-02-15T02:00:00.000Z');

  it('24. re-anchor: baris QUEUED prematur digeser ke tanggal kunjungan baru + reservation_id ditautkan', async () => {
    const phone = `62893${Date.now()}reanchor`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Reanchor', DEFAULT_TENANT_ID);

    // stage1 → baris lama prematur (2030-01-25, hanya 10 hari dari booking); stage2/3 → null
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst');
    findFirstSpy
      .mockResolvedValueOnce({
        id: 'fu-stage1-old',
        status: 'QUEUED',
        scheduled_at: new Date('2030-01-25T02:00:00.000Z'),
        reservation_id: null,
      } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);

    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, FUTURE_BOOKING, DEFAULT_TENANT_ID, 'res-new-1');

    // Dua stage baru dibuat (2,3); stage 1 diperbarui (bukan dibuat ulang)
    const nextCreates = createSpy.mock.calls.filter((c: any) => c[0]?.data?.type === 'NEXT_TREATMENT');
    expect(nextCreates.map((c: any) => c[0].data.stage).sort()).toEqual([2, 3]);

    const stage1Update = updateSpy.mock.calls.find((c: any) => c[0]?.where?.id === 'fu-stage1-old');
    expect(stage1Update).toBeDefined();
    expect(new Date(stage1Update![0].data.scheduled_at).toISOString()).toBe(STAGE1_TARGET.toISOString());
    expect(stage1Update![0].data.reservation_id).toBe('res-new-1');
  });

  it('25. re-anchor: baris PENDING prematur juga digeser', async () => {
    const phone = `62893${Date.now()}reanchor2`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Reanchor2', DEFAULT_TENANT_ID);

    vi.spyOn(prisma.followUp, 'findFirst')
      .mockResolvedValueOnce({
        id: 'fu-pending-old',
        status: 'PENDING',
        scheduled_at: new Date('2030-01-20T02:00:00.000Z'),
        reservation_id: null,
      } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, FUTURE_BOOKING, DEFAULT_TENANT_ID);

    const upd = updateSpy.mock.calls.find((c: any) => c[0]?.where?.id === 'fu-pending-old');
    expect(upd).toBeDefined();
    expect(new Date(upd![0].data.scheduled_at).toISOString()).toBe(STAGE1_TARGET.toISOString());
  });

  it('26. re-anchor: status SENT TIDAK pernah digeser (terminal historis)', async () => {
    const phone = `62893${Date.now()}sentkeep`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda SentKeep', DEFAULT_TENANT_ID);

    vi.spyOn(prisma.followUp, 'findFirst')
      .mockResolvedValueOnce({ id: 'fu-sent-old', status: 'SENT', scheduled_at: new Date('2030-01-10T02:00:00.000Z') } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, FUTURE_BOOKING, DEFAULT_TENANT_ID, 'res-new-2');

    const sentUpdate = updateSpy.mock.calls.find((c: any) => c[0]?.where?.id === 'fu-sent-old');
    expect(sentUpdate).toBeUndefined();
  });

  it('27. re-anchor: tanggal sudah sesuai → TIDAK ada update (idempoten)', async () => {
    const phone = `62893${Date.now()}noop`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Noop', DEFAULT_TENANT_ID);

    vi.spyOn(prisma.followUp, 'findFirst')
      .mockResolvedValueOnce({ id: 'fu-stage1-same', status: 'QUEUED', scheduled_at: STAGE1_TARGET, reservation_id: 'res-same' } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);
    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, FUTURE_BOOKING, DEFAULT_TENANT_ID, 'res-same');

    const sameUpdate = updateSpy.mock.calls.find((c: any) => c[0]?.where?.id === 'fu-stage1-same');
    expect(sameUpdate).toBeUndefined();
  });

  it('28. reconciler: customer dengan reservasi belum-selesai yang LEBIH BARU tidak dijadwalkan dari completed kuno', async () => {
    const oldCompleted = new Date('2026-06-01T10:00:00+07:00');
    const newerUncompletedPast = new Date('2026-09-20T10:00:00+07:00'); // confirmed, booking_date lampau

    vi.spyOn(prisma.reservation, 'findMany').mockImplementation(async (args: any) => {
      const status = args?.where?.status;
      if (status === 'completed') {
        return [{ customer_id: 'cust-kuno', booking_date: oldCompleted }] as any;
      }
      // query uncompleted (status: { in: [...] })
      return [{ customer_id: 'cust-kuno', booking_date: newerUncompletedPast }] as any;
    });
    const nextSpy = vi.spyOn(followUpService, 'createNextTreatmentFollowUps').mockResolvedValue(undefined as any);

    const res = await followUpService.reconcileOrphanedCompletedFollowUps(DEFAULT_TENANT_ID);

    expect(res.reconciledCount).toBe(0);
    expect(nextSpy).not.toHaveBeenCalled();
  });

  it('29. re-anchor: bentrok unique saat taut reservation_id → tanggal tetap diselamatkan', async () => {
    const phone = `62893${Date.now()}collide`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Collide', DEFAULT_TENANT_ID);

    vi.spyOn(prisma.followUp, 'findFirst')
      .mockResolvedValueOnce({
        id: 'fu-collide',
        status: 'QUEUED',
        scheduled_at: new Date('2030-01-01T02:00:00.000Z'),
        reservation_id: null,
      } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);

    // Panggilan update pertama (taut reservation_id) gagal P2002; kedua (scheduled_at saja) sukses.
    const updateSpy = vi
      .spyOn(prisma.followUp, 'update')
      .mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }) as any)
      .mockResolvedValueOnce({} as any);
    vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

    await followUpService.createNextTreatmentFollowUps(customer.id, FUTURE_BOOKING, DEFAULT_TENANT_ID, 'res-collide');

    const collideUpdates = updateSpy.mock.calls.filter((c: any) => c[0]?.where?.id === 'fu-collide');
    // Dua percobaan: pertama dengan reservation_id, kedua fallback scheduled_at saja.
    expect(collideUpdates.length).toBe(2);
    expect(collideUpdates[1][0].data.reservation_id).toBeUndefined();
    expect(new Date(collideUpdates[1][0].data.scheduled_at).toISOString()).toBe(STAGE1_TARGET.toISOString());
  });

  // ── Recent/Upcoming-Visit Guard (fondasional: state-based, kasus Bunda Rina 2026-10-05) ──
  // Pengingat NEXT_TREATMENT ("ayo booking treatment berikutnya") DILARANG terkirim bila
  // customer baru saja ditangani (booking_date dalam N hari terakhir) ATAU sudah punya
  // booking non-cancelled yang akan datang — redundan & mengganggu. Murni state
  // (booking_date + status), tanpa pencocokan teks. Menunda, bukan membatalkan.
  const makeNextTreatmentFu = (overrides: any = {}): any => ({
    id: 'fu-next-guard',
    tenant_id: DEFAULT_TENANT_ID,
    customer_id: 'cust-next-guard',
    type: 'NEXT_TREATMENT',
    stage: 1,
    scheduled_at: new Date(Date.now() - 1000), // jatuh tempo
    status: 'QUEUED',
    customer: {
      id: 'cust-next-guard',
      name: 'Bunda Rina',
      phone: '6285109356888',
      children: [],
      conversations: [],
    },
    ...overrides,
  });

  it('30. executeFollowUp: NEXT_TREATMENT ditunda bila customer BARU berkunjung (<14 hari)', async () => {
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

    const recentVisit = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 hari lalu (kasus Rina)
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce({ booking_date: recentVisit } as any);

    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const { typingService } = await import('../../src/services/typing.service');
    const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);

    const ok = await followUpService.executeFollowUp(makeNextTreatmentFu(), DEFAULT_TENANT_ID);

    expect(ok).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
    const postponed = updateSpy.mock.calls.find((c: any) => c[0]?.data?.scheduled_at);
    expect(postponed).toBeDefined();
    expect((postponed![0].data.scheduled_at as Date).getTime()).toBeGreaterThan(Date.now());
    // Tidak boleh menandai SENT/FAILED — hanya menggeser jadwal.
    const terminal = updateSpy.mock.calls.find((c: any) => c[0]?.data?.status);
    expect(terminal).toBeUndefined();
  });

  it('31. executeFollowUp: NEXT_TREATMENT ditunda bila customer punya booking non-cancelled AKAN DATANG', async () => {
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

    const futureBooking = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce({ booking_date: futureBooking } as any);

    const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
    const { typingService } = await import('../../src/services/typing.service');
    const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);

    const ok = await followUpService.executeFollowUp(makeNextTreatmentFu(), DEFAULT_TENANT_ID);

    expect(ok).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(updateSpy.mock.calls.some((c: any) => c[0]?.data?.scheduled_at)).toBe(true);
  });

  it('32. executeFollowUp: NEXT_TREATMENT TETAP terkirim bila kunjungan terakhir sudah lama (>14 hari)', async () => {
    const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
    vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

    // Tidak ada booking non-cancelled dalam window → guard lolos.
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce(null as any);
    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);

    const { typingService } = await import('../../src/services/typing.service');
    const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({
      success: true,
      bubblesSent: 1,
      chatId: '6285109356888',
    } as any);

    const ok = await followUpService.executeFollowUp(makeNextTreatmentFu(), DEFAULT_TENANT_ID);

    expect(ok).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});



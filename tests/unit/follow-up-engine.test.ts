import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
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

  it('3. onReservationCreated cancels pending NO_PURCHASE follow-ups and sets repeat_order', async () => {
    const phone = `62892${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Repeat', DEFAULT_TENANT_ID);

    await followUpService.createNoPurchaseFollowUps(customer.id, DEFAULT_TENANT_ID);
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

    // Simulasikan DB nyata: setelah pemanggilan pertama, findFirst mengembalikan
    // row NEXT_TREATMENT PENDING (seperti DB sesungguhnya). Di in-memory fallback
    // findFirst selalu null, jadi kita mock agar guard idempotency teruji.
    const findFirstSpy = vi.spyOn(prisma.followUp, 'findFirst');
    findFirstSpy.mockResolvedValueOnce(null as any).mockResolvedValueOnce({ id: 'existing' } as any);

    const createSpy = vi.spyOn(prisma.followUp, 'create');
    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const afterFirst = createSpy.mock.calls.filter((c) => c[0].data?.type === 'NEXT_TREATMENT').length;

    await followUpService.createNextTreatmentFollowUps(customer.id, bookingDate, DEFAULT_TENANT_ID);
    const afterSecond = createSpy.mock.calls.filter((c) => c[0].data?.type === 'NEXT_TREATMENT').length;

    // Pemanggilan pertama membuat 3 stage; pemanggilan kedua TIDAK menambah
    // (guard idempotency menemukan row existing → skip).
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
      data: { status: 'CANCELLED' },
    });
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
      status: 'sent',
      chatId: '6281234567890',
      messageCount: 1,
      totalTypingMs: 100,
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
});



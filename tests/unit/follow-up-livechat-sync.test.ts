import { describe, it, expect, vi, beforeEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { cronService } from '../../src/services/cron.service';
import { messageService } from '../../src/services/message.service';
import { conversationService } from '../../src/services/conversation.service';
import { typingService } from '../../src/services/typing.service';

describe('Follow-Up & Automated Broadcast Live Chat Synchronization Tests', () => {
  const tenantId = 'default-tenant';
  const customerId = 'cust-test-sync-123';
  const phone = '6281217332334';

  beforeEach(() => {
    vi.restoreAllMocks();
    typingService.setSpeedFactor(1000);
  });

  it('1. executeFollowUp logs complete outbound message to messages table', async () => {
    const logSpy = vi.spyOn(messageService, 'logMessage');
    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({
      success: true,
      bubblesSent: 2,
    });

    const fu = {
      id: 'fu-sync-1',
      tenant_id: tenantId,
      customer_id: customerId,
      type: 'NEXT_TREATMENT',
      stage: 1,
      customer: {
        id: customerId,
        phone,
        name: 'Bunda Mika Tegalsari',
        children: [{ name: 'Naomi' }],
      },
    };

    const success = await followUpService.executeFollowUp(fu, tenantId);

    expect(success).toBe(true);
    expect(simulateSpy).toHaveBeenCalledTimes(1);
    expect(simulateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: phone,
        tenantId,
      })
    );

    // Verify messageService.logMessage was called with full content and correct sender info
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        direction: 'OUTBOUND',
        senderType: 'BOT',
        senderName: 'Bot (Follow-Up)',
        content: expect.stringContaining('Bunda Mika'),
      })
    );
  });

  it('2. checkAndAttachOutboundDuplicate matches multi-bubble fragments to existing combined message', async () => {
    const conv = await conversationService.getOrCreateConversation(customerId, tenantId);
    const fullMessage = 'Halo Bunda Mika 😊 Gimana kabarnya si kecil?\n\nDi fase ini bagus banget untuk lanjut lagi supaya tumbuh kembangnya tetap optimal ✨';

    // Log the full combined message
    await messageService.logMessage({
      tenantId,
      conversationId: conv.id,
      direction: 'OUTBOUND',
      content: fullMessage,
      senderType: 'BOT',
      senderName: 'Bot (Follow-Up)',
    });

    // Webhook receives bubble 1 echo
    const bubble1 = 'Halo Bunda Mika 😊 Gimana kabarnya si kecil?';
    const isDup1 = await messageService.checkAndAttachOutboundDuplicate(
      conv.id,
      bubble1,
      'wa_msg_id_bubble_1',
      tenantId
    );
    expect(isDup1).toBe(true);

    // Webhook receives bubble 2 echo
    const bubble2 = 'Di fase ini bagus banget untuk lanjut lagi supaya tumbuh kembangnya tetap optimal ✨';
    const isDup2 = await messageService.checkAndAttachOutboundDuplicate(
      conv.id,
      bubble2,
      'wa_msg_id_bubble_2',
      tenantId
    );
    expect(isDup2).toBe(true);
  });

  it('3. simulateHumanReply maintains in-flight registration without premature wiping', async () => {
    const testPhone = '6281999888777';
    // Create text exceeding singleThreshold (> 350 chars) so it splits into 2 bubbles
    const para1 = 'Halo Bunda tercinta! Terima kasih banyak sudah mempercayakan perawatan Bunda dan si Kecil kepada kami. Semoga semuanya senantiasa sehat dan bugar.';
    const para2 = 'Nggak kerasa ya bun, sudah sekitar 1 bulan sejak terakhir massage. Di fase ini bagus banget untuk lanjut lagi supaya tumbuh kembangnya tetap optimal ✨ Kebetulan minggu depan masih ada beberapa jadwal kosong. Kalau bunda mau, saya bisa bantu aturkan jadwal untuk treatment lagi bunda di minggu depan. 🙏😊';
    const multiBubbleText = `${para1}\n\n${para2}`;

    const result = await typingService.simulateHumanReply({
      chatId: testPhone,
      replyText: multiBubbleText,
      tenantId,
    });

    expect(result.success).toBe(true);

    // Immediately after execution, in-flight registry should still recognize the bubble
    // because TTL (45s) protects delayed echo webhooks
    const isInFlight = messageService.isInFlightBotOutbound(
      testPhone,
      para1,
      tenantId
    );
    expect(isInFlight).toBe(true);
  });

  it('4. broadcastQueueService.processBroadcastJob logs message to messages table', async () => {
    const { broadcastQueueService } = await import('../../src/services/broadcast-queue.service');
    const { prisma } = await import('../../src/db/client');

    const logSpy = vi.spyOn(messageService, 'logMessage');
    vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({
      success: true,
      bubblesSent: 1,
    });

    // Mock Date so it falls within business hours (e.g. 10:00)
    const fakeNow = new Date('2026-08-26T03:00:00.000Z'); // 10:00 WIB
    vi.setSystemTime(fakeNow);
    process.env.BROADCAST_THROTTLE_MIN_SECONDS = '0';
    process.env.BROADCAST_THROTTLE_MAX_SECONDS = '0';

    vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({
      id: 'fu-bq-1',
      tenant_id: tenantId,
      customer_id: customerId,
      status: 'QUEUED',
      type: 'NO_PURCHASE',
      stage: 1,
      customer: {
        id: customerId,
        phone,
        name: 'Bunda Sarah',
        status: 'active',
      },
    } as any);

    vi.spyOn(prisma.followUp, 'update').mockResolvedValue({ id: 'fu-bq-1', status: 'SENT' } as any);

    await broadcastQueueService.processBroadcastJob({
      followUpId: 'fu-bq-1',
      customerId,
      tenantId,
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        direction: 'OUTBOUND',
        senderType: 'BOT',
        senderName: 'Bot (Follow-Up)',
        content: expect.stringContaining('Sarah'),
      })
    );

    vi.useRealTimers();
  });
});

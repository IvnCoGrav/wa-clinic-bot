import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';
import { GroundingComposer } from '../../src/slot-engine/grounding-composer';
import { TypingService } from '../../src/services/typing.service';
import { messageService } from '../../src/services/message.service';
import { CustomerSlate } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Need-Time NLU & Non-Destructive Message Revocation Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. EntityExtractor (NLU) & Regex Guard', () => {
    it('should NOT classify "ini saya nunggu selesai nifas dulu yaaa bu" as discuss_with_family', () => {
      const text = 'ini saya nunggu selesai nifas dulu yaaa bu🙏🏻';
      const deterministic = EntityExtractor.preExtractDeterministic(text);

      expect(deterministic.intents).not.toContain('discuss_with_family');
    });

    it('should ONLY classify explicit family mentions as discuss_with_family', () => {
      const textSuami = 'sebentar ya bu saya tanya suami dulu';
      const deterministicSuami = EntityExtractor.preExtractDeterministic(textSuami);
      expect(deterministicSuami.intents).toContain('discuss_with_family');

      const textAyah = 'mau rembuk sama ayah dulu ya';
      const deterministicAyah = EntityExtractor.preExtractDeterministic(textAyah);
      expect(deterministicAyah.intents).toContain('discuss_with_family');

      const textKeluarga = 'nanti tak diskusikan sama keluarga dulu';
      const deterministicKeluarga = EntityExtractor.preExtractDeterministic(textKeluarga);
      expect(deterministicKeluarga.intents).toContain('discuss_with_family');
    });
  });

  describe('2. GroundingComposer & isBookingReady Gatekeeper', () => {
    const baseSlate: CustomerSlate = {
      customerId: 'cust-123',
      phone: '62895633838249',
      name: 'Bunda Test',
      tenantId: 'default-tenant',
      conversationId: 'conv-123',
      kelurahan: 'Berbek',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: -7.35,
      lng: 112.76,
      streetDetail: null,
      distanceKm: 3.2,
      ongkirFee: 0,
      ongkirPromoFee: 0,
      isLocationConfirmed: true,
      isOutOfCoverage: false,
      childAgeMonths: null,
      childAgeCategory: null,
      symptoms: [],
      medicalConcerns: [],
      selectedTreatmentName: 'Pijat Nifas',
      preferredDate: 'bulan depan',
      preferredTime: 'sore',
      pricelistSent: true,
      reservationFormSent: false,
      isHumanHandling: false,
      humanHandlingReason: null,
      lastInteractionAt: new Date(),
      projectedState: ConversationState.AWAITING_INTEREST,
    };

    it('should NOT trigger isBookingReady or suggestedPreFilledForm when date is vague ("bulan depan")', async () => {
      const extraction = {
        intents: ['select_treatment'] as any,
        locationText: null,
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: 'Pijat Nifas',
        preferredDateText: 'bulan depan',
        preferredTimeText: 'sore',
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.95,
      };

      const grounding = await GroundingComposer.compose(baseSlate, extraction, {
        customerInput: 'Alhamdulillah, Pijat Nifas untuk saya sendiri',
        tenantId: 'default-tenant',
      });

      expect(grounding.isBookingReady).toBe(false);
      expect(grounding.suggestedPreFilledForm).toBeNull();
    });

    it('should NOT trigger isBookingReady when customer has need_time intent', async () => {
      const extraction = {
        intents: ['need_time', 'select_treatment'] as any,
        locationText: null,
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: 'Pijat Nifas',
        preferredDateText: 'besok jam 10',
        preferredTimeText: '10:00',
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.95,
      };

      const grounding = await GroundingComposer.compose(baseSlate, extraction, {
        customerInput: 'ini saya nunggu selesai nifas dulu yaaa bu',
        tenantId: 'default-tenant',
      });

      expect(grounding.isBookingReady).toBe(false);
      expect(grounding.suggestedPreFilledForm).toBeNull();
    });

    it('should trigger isBookingReady when date is concrete ("besok pagi")', async () => {
      const concreteSlate: CustomerSlate = {
        ...baseSlate,
        preferredDate: 'besok pagi',
      };

      const extraction = {
        intents: ['select_treatment', 'request_booking'] as any,
        locationText: null,
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: 'Pijat Nifas',
        preferredDateText: 'besok pagi',
        preferredTimeText: '09:00',
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.95,
      };

      const grounding = await GroundingComposer.compose(concreteSlate, extraction, {
        customerInput: 'Mau booking Pijat Nifas besok pagi ya bu',
        tenantId: 'default-tenant',
      });

      expect(grounding.isBookingReady).toBe(true);
      expect(grounding.suggestedPreFilledForm).toBeTruthy();
    });
  });

  describe('3. Inbound Typing Preemption', () => {
    it('should abort ongoing typing simulation when abortActiveTyping is called', async () => {
      const mockWahaClient = {
        sendSeen: vi.fn().mockResolvedValue(true),
        startTyping: vi.fn().mockResolvedValue(true),
        stopTyping: vi.fn().mockResolvedValue(true),
        sendText: vi.fn().mockResolvedValue(true),
      };

      const typingSvc = new TypingService(mockWahaClient as any, 10);
      const chatId = '62895633838249@c.us';

      // Start human reply simulation
      const replyPromise = typingSvc.simulateHumanReply({
        chatId,
        replyText: 'Bubble 1\n\nBubble 2\n\nBubble 3',
        tenantId: 'default-tenant',
      });

      // Simulate inbound message preemption immediately
      TypingService.abortActiveTyping(chatId);

      const result = await replyPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('ABORTED_BY_PREEMPTION');
    });
  });

  describe('4. Non-Destructive Message Revocation & Cascade WhatsApp Revoke', () => {
    it('should preserve original content in memory when markMessageDeleted is called', async () => {
      const msg = await messageService.logMessage({
        conversationId: 'conv-test-revoke',
        direction: 'OUTBOUND' as any,
        content: 'Halo Bunda, ini teks asli sebelum ditarik',
        senderType: 'BOT',
        tenantId: 'default-tenant',
      });

      expect(msg.content).toBe('Halo Bunda, ini teks asli sebelum ditarik');

      const deleted = await messageService.markMessageDeleted(msg.id, 'default-tenant');
      expect(deleted).toBe(true);

      const history = messageService.getMemoryMessages();
      const updatedMsg = history.find((m) => m.id === msg.id);

      expect(updatedMsg).toBeDefined();
      expect(updatedMsg?.is_revoked).toBe(true);
      expect(updatedMsg?.content).toBe('Halo Bunda, ini teks asli sebelum ditarik');
    });

    it('should revoke all associated WhatsApp message IDs when a message with multiple sent_wa_message_ids is revoked', async () => {
      const { liveChatService } = await import('../../src/services/live-chat.service');
      const { conversationService } = await import('../../src/services/conversation.service');
      const { customerService } = await import('../../src/services/customer.service');
      const { resolveGatewayForTenant } = await import('../../src/integrations/whatsapp/factory');

      const customer = await customerService.getOrCreateCustomer('62895633838249', 'Bunda Test', 'default-tenant');
      const conv = await conversationService.getOrCreateConversation(customer.id, 'default-tenant');

      const msg = await messageService.logMessage({
        conversationId: conv.id,
        direction: 'OUTBOUND' as any,
        content: 'Halo Bunda!\n\nBerikut infonya.',
        senderType: 'BOT',
        tenantId: 'default-tenant',
        payloadRaw: {
          sent_wa_message_ids: ['wa_msg_1', 'wa_msg_2', 'wa_msg_3'],
        },
      });

      const gateway = await resolveGatewayForTenant('default-tenant');
      const deleteSpy = vi.spyOn(gateway, 'deleteMessage').mockResolvedValue({ success: true } as any);

      const revokeResult = await liveChatService.revokeMessage({
        conversationId: conv.id,
        messageId: msg.id,
        tenantId: 'default-tenant',
        adminName: 'Test Admin',
      });

      expect(revokeResult.success).toBe(true);
      // All 3 WhatsApp message IDs must be deleted via gateway
      expect(deleteSpy).toHaveBeenCalledWith('62895633838249', 'wa_msg_1', true);
      expect(deleteSpy).toHaveBeenCalledWith('62895633838249', 'wa_msg_2', true);
      expect(deleteSpy).toHaveBeenCalledWith('62895633838249', 'wa_msg_3', true);
      expect(deleteSpy).toHaveBeenCalledTimes(3);
    });

    it('should split text into bubbles and log each bubble individually with its own wa_message_id when conversationId is passed', async () => {
      const mockWahaClient = {
        sendSeen: vi.fn().mockResolvedValue(true),
        startTyping: vi.fn().mockResolvedValue(true),
        stopTyping: vi.fn().mockResolvedValue(true),
        sendText: vi.fn().mockResolvedValue(true),
        sendTextDetailed: vi.fn().mockImplementation((chatId, text) => {
          return Promise.resolve({
            success: true,
            messageId: `wamid_${Math.random().toString(36).substring(7)}`,
          });
        }),
      };

      const typingSvc = new TypingService(mockWahaClient as any, 100);
      const reservationText = `Tentu bisa Bunda, kami siap membantu.\n\nBerikut format pendaftaran reservasi:\nNama Bunda:\nNama Anak:\nUsia:\nAlamat & shareloc:\nLayanan:\n\nMohon bisa diisi ya Bunda agar kami jadwalkan.`;

      const result = await typingSvc.simulateHumanReply({
        chatId: '62895633838249@c.us',
        replyText: reservationText,
        tenantId: 'default-tenant',
        conversationId: 'conv-bubble-split-test',
        senderType: 'BOT',
      });

      expect(result.success).toBe(true);
      expect(result.bubblesSent).toBe(3);
      expect(result.sentBubbles?.length).toBe(3);
      expect(result.sentWaMessageIds?.length).toBe(3);

      const history = messageService.getMemoryMessages().filter((m) => m.conversation_id === 'conv-bubble-split-test');
      expect(history.length).toBe(3);

      // Verify each bubble has its own distinct content and wa_message_id
      expect(history[0].content).toContain('Tentu bisa Bunda');
      expect(history[0].wa_message_id).toBe(result.sentWaMessageIds?.[0]);

      expect(history[1].content).toContain('Berikut format pendaftaran reservasi');
      expect(history[1].wa_message_id).toBe(result.sentWaMessageIds?.[1]);

      expect(history[2].content).toContain('Mohon bisa diisi ya Bunda');
      expect(history[2].wa_message_id).toBe(result.sentWaMessageIds?.[2]);
    });
  });
});

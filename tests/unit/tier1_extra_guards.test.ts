import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeWahaJid } from '../../src/utils/jid';
import { pruneMemoryMap } from '../../src/routes/tracking.route';
import { handleHumanHandlingState } from '../../src/state-machine/handlers/human';
import { ConversationState } from '@prisma/client';
import { buildApp } from '../../src/app';
import { wahaClient } from '../../src/integrations/waha/client';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

describe('Tier 1 Extra Items — E1 (JID Normalization), E2 (Memory Pruning), E3 (HUMAN_HANDLING Guard)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await seedAiScopeAll();
  });

  // --- E1: JID Normalization Tests ---
  describe('E1: Webhook JID & Dual Payload Normalization (@lid vs @c.us)', () => {
    it('1. should normalize standard @c.us JID to E.164 phone number', () => {
      const res = normalizeWahaJid('628123456789@c.us');
      expect(res).toBe('628123456789');
    });

    it('2. should normalize multi-device @lid JID to clean digits', () => {
      const res = normalizeWahaJid('79903991054369@lid');
      expect(res).toBe('79903991054369');
    });

    it('3. should strip leading plus sign and non-digits', () => {
      const res = normalizeWahaJid('+628123456789@c.us');
      expect(res).toBe('628123456789');
    });

    it('4. should handle null or empty string safely', () => {
      expect(normalizeWahaJid(null)).toBe('');
      expect(normalizeWahaJid(undefined)).toBe('');
      expect(normalizeWahaJid('')).toBe('');
    });
  });

  // --- E2: Memory Store Pruning Tests ---
  describe('E2: Memory Store Size Limitation & Leak Protection', () => {
    it('1. should prune oldest entries when Map size exceeds maxLimit (FIFO eviction)', () => {
      const testMap = new Map<string, any>();
      for (let i = 0; i < 1050; i++) {
        testMap.set(`key_${i}`, { data: `value_${i}` });
      }

      expect(testMap.size).toBe(1050);
      pruneMemoryMap(testMap, 1000);

      expect(testMap.size).toBe(1000);
      expect(testMap.has('key_0')).toBe(false); // Oldest pruned!
      expect(testMap.has('key_49')).toBe(false); // Oldest pruned!
      expect(testMap.has('key_50')).toBe(true);  // Retained!
      expect(testMap.has('key_1049')).toBe(true); // Retained!
    });
  });

  // --- E3: HUMAN_HANDLING Guard Hardening Tests ---
  describe('E3: HUMAN_HANDLING Explicit Guard Clause Hardening', () => {
    it('1. handleHumanHandlingState should return shouldSendReply: false when is_human_handling is active', async () => {
      const mockContext: any = {
        tenantId: DEFAULT_TENANT_ID,
        customer: { id: 'cust_human_1', phone: '628123456789' },
        conversation: {
          id: 'conv_human_1',
          current_state: ConversationState.HUMAN_HANDLING,
          is_human_handling: true,
          human_handling_since: new Date(), // Active, < 6 hours
        },
        incomingMessage: { text: { body: 'Halo bidan' } },
      };

      const result = await handleHumanHandlingState(mockContext);

      expect(result.shouldSendReply).toBe(false);
      expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
      expect(result.isHumanHandling).toBe(true);
    });

    it('2. Live Webhook POST /webhook MUST return HUMAN_HANDLING_ACTIVE_SILENT and make ZERO outbound WAHA calls when handling manual chat', async () => {
      const phone = '6281122334455';
      const mockCust = { id: 'cust_manual_1', phone, status: 'active', tenant_id: DEFAULT_TENANT_ID, created_at: new Date() };
      const mockConv = {
        id: 'conv_manual_1',
        customer_id: mockCust.id,
        current_state: ConversationState.HUMAN_HANDLING,
        is_human_handling: true,
        human_handling_since: new Date(),
        previous_state: ConversationState.AWAITING_LOCATION,
      };

      vi.spyOn(customerService, 'getCustomerByPhone').mockResolvedValue(mockCust as any);
      vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue(mockCust as any);
      vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
      vi.spyOn(wahaClient, 'getChatLabels').mockResolvedValue(['hold']); // Active hold label
      vi.spyOn(wahaClient, 'getChatLabelsOrNull').mockResolvedValue(['hold']); // Active hold label

      const sendTextSpy = vi.spyOn(wahaClient, 'sendText').mockResolvedValue(undefined as any);

      const app = buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          event: 'message',
          payload: {
            id: 'msg_manual_123',
            from: `${phone}@c.us`,
            body: 'Bisa pesan jadwal hari ini?',
            fromMe: false,
            timestamp: Math.floor(Date.now() / 1000),
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('HUMAN_HANDLING_ACTIVE_SILENT');

      // CRITICAL PROOF: Bot MUST NOT send any outbound text!
      expect(sendTextSpy).not.toHaveBeenCalled();
      expect(sendTextSpy).toHaveBeenCalledTimes(0);
    });
  });
});

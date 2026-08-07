import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';
import { handleInterestState } from '../../src/state-machine/handlers/interest';
import { StateHandlerContext } from '../../src/state-machine/types';
import { ConversationState, Direction } from '@prisma/client';
import { messageService } from '../../src/services/message.service';

vi.mock('axios');

describe('AI Reasoning Logging & Storage Infrastructure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. generator.ts: generateFaqResponse mengisi lastReasoning dari parsed LLM reasoning', async () => {
    const generator = new LLMResponseGenerator();
    const expectedReasoning = 'Customer menanyakan layanan pijat bayi. Data ditemukan di RAG.';

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: expectedReasoning,
              needs_clarification: false,
              answer: 'Kami melayani pijat bayi di rumah Bunda 😊'
            })
          }
        }]
      }
    } as any);

    expect(generator.lastReasoning).toBeNull();
    const reply = await generator.generateFaqResponse('Apakah ada layanan pijat bayi?', [], 'conv-1', 'tenant-1');

    expect(reply).toContain('pijat bayi');
    expect(generator.lastReasoning).toBe(expectedReasoning);
  });

  it('2. interest.ts handler: handleInterestState menyertakan aiReasoning pada StateHandlerResult', async () => {
    const expectedReasoning = 'Reasoning untuk FAQ interest handler';
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: expectedReasoning,
              needs_clarification: false,
              answer: 'Kami melayani pijat bayi di rumah Bunda 😊'
            })
          }
        }]
      }
    } as any);

    const mockCtx: StateHandlerContext = {
      tenantId: 'tenant-test',
      customer: {
        id: 'cust-1',
        tenant_id: 'tenant-test',
        phone: '628123456789',
        kelurahan: 'Kupang',
        kecamatan: 'Tegalsari',
        kota: 'Surabaya',
        lat: -7.25,
        lng: 112.75,
        share_location_sent: true,
      } as any,
      conversation: {
        id: 'conv-100',
        tenant_id: 'tenant-test',
        customer_id: 'cust-1',
        current_state: ConversationState.AWAITING_INTEREST,
        is_human_handling: false,
      } as any,
      incomingMessage: {
        id: 'msg-inbound-1',
        from: '628123456789',
        type: 'text',
        text: { body: 'Apakah ada layanan pijat bayi di rumah?' },
      } as any,
      nluResult: {
        intents: ['faq_question'],
        confidence: 0.9,
        isFallback: false,
        text: 'Apakah ada layanan pijat bayi di rumah?',
      },
    };

    const result = await handleInterestState(mockCtx);

    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.shouldSendReply).toBe(true);
    expect(result.aiReasoning).toBe(expectedReasoning);
  });

  it('3. message.service.ts: getRecentMessagesWithReasoning mengembalikan pesan outbound yang punya payloadRaw.aiReasoning', async () => {
    const tenantId = 'tenant-reasoning-test-99';

    // Log pesan tanpa reasoning
    await messageService.logMessage({
      tenantId,
      conversationId: 'conv-normal',
      direction: Direction.OUTBOUND,
      content: 'Halo Bunda',
    });

    // Log pesan dengan aiReasoning
    await messageService.logMessage({
      tenantId,
      conversationId: 'conv-ai',
      direction: Direction.OUTBOUND,
      content: 'Biaya spa baby 150rb ya Bunda',
      payloadRaw: { aiReasoning: 'Customer menanyakan biaya spa baby.' },
    });

    const results = await messageService.getRecentMessagesWithReasoning(tenantId, 10);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const item = results.find(r => r.conversation_id === 'conv-ai');
    expect(item).toBeDefined();
    expect(item.payload_raw?.aiReasoning || item.payloadRaw?.aiReasoning).toBe('Customer menanyakan biaya spa baby.');
  });
});

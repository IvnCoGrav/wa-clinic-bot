import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { stateMachine } from '../../src/state-machine/machine';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('State Machine & Conversation Orchestrator Unit Tests', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    process.env.WAHA_API_KEY = 'my_waha_api_key_secret';
    vi.restoreAllMocks();
  });

  it('1. INITIAL -> AWAITING_LOCATION: Greeting on new customer message', async () => {
    const phone = `62811${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Budi', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.INITIAL,
        previousState: null,
        locationAttempts: 0,
        isHumanHandling: false,
      },
      DEFAULT_TENANT_ID
    );
    customer.kelurahan = null;
    customer.lat = null;
    customer.lng = null;

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_init_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Halo min' },
      },
    });

    expect(result.nextState).toBe(ConversationState.AWAITING_LOCATION);
    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('Bidan Yusi');
  });

  it('2. AWAITING_LOCATION (Native Location): calculates ongkir and transitions to AWAITING_INTEREST', async () => {
    const phone = `62822${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Siti', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.AWAITING_LOCATION,
      },
      DEFAULT_TENANT_ID
    );

    const activeConv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: activeConv,
      incomingMessage: {
        id: `msg_loc_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'location',
        location: {
          latitude: -7.3450,
          longitude: 112.7500,
        },
      },
    });

    expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(result.replyText).toContain('ongkir');
  });

  it('3. AWAITING_LOCATION (Text Location 3x Attempt Counter): Escalates to HUMAN_HANDLING on 3rd failure', async () => {
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({ isPrecise: false });

    const phone = `62833${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Andi', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.AWAITING_LOCATION,
        locationAttempts: 2,
      },
      DEFAULT_TENANT_ID
    );

    const activeConv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: activeConv,
      incomingMessage: {
        id: `msg_esc_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Lokasi yang tidak diketahui' },
      },
    });

    const updatedConv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.isHumanHandling).toBe(true);
    expect(updatedConv.previous_state).toBe(ConversationState.AWAITING_LOCATION);
    expect(result.replyText || '').toContain('ongkir');
  });

  it('4. AWAITING_INTEREST -> HUMAN_HANDLING: asking_schedule intent saves previous_state', async () => {
    const phone = `62844${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Dewi', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.AWAITING_INTEREST,
      },
      DEFAULT_TENANT_ID
    );

    const activeConv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: activeConv,
      incomingMessage: {
        id: `msg_sched_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Apakah hari Senin jam 2 siang bisa treatment?' },
      },
    });

    const updatedConv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.isHumanHandling).toBe(true);
    expect(updatedConv.previous_state).toBe(ConversationState.AWAITING_INTEREST);
  });

  it('5. AUTO-RELEASE TIMEOUT: Restores current_state to previous_state after > 6 hours timeout', async () => {
    const phone = `62855${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Eko', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.HUMAN_HANDLING,
        previousState: ConversationState.AWAITING_LOCATION,
        isHumanHandling: true,
        humanHandlingSince: sevenHoursAgo,
      },
      DEFAULT_TENANT_ID
    );

    const convBefore = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    const autoReleaseResult = conversationService.checkAndApplyAutoRelease(convBefore, DEFAULT_TENANT_ID);

    expect(autoReleaseResult.released).toBe(true);
    expect(autoReleaseResult.updatedConversation.is_human_handling).toBe(false);
    expect(autoReleaseResult.updatedConversation.current_state).toBe(ConversationState.AWAITING_LOCATION);
  });

  it('6. Price Question Interception in AWAITING_LOCATION: Must NOT trigger geocoding failure retry with "Hallo"', async () => {
    const phone = `62866${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Rina', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    await conversationService.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.AWAITING_LOCATION,
        locationAttempts: 0,
      },
      DEFAULT_TENANT_ID
    );

    const result = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_price_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hallo kak ini benar harganya 60rb saja' },
      },
    });

    expect(result.nextState).toBe(ConversationState.AWAITING_LOCATION);
    expect(result.replyText).not.toContain('lebih tepatnya Hallo ini benar');
    expect(result.shouldSendReply).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase E — Form tak lengkap: 2x diminta melengkapi, ke-3x eskalasi sunyi
 * (reason 'reservation_incomplete'). Counter reset saat form valid.
 */
describe('Fase E — form tak lengkap berulang → eskalasi', () => {
  const sentToCustomer: string[] = [];
  const testStateMachine = new ConversationStateMachine({
    simulateHumanReply: async (params: any) => {
      sentToCustomer.push(params.replyText);
      return { success: true };
    },
  } as any);

  const INCOMPLETE_FORM = `Berikut list untuk reservasi :

Hari dan tanggal : 2026-07-22
Nama Bunda:
Alamat & Shareloc :
Kec :
Kota :
No. Hp : 08123456789`;

  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    sentToCustomer.length = 0;
    vi.restoreAllMocks();
  });

  it('2x prompt melengkapi, ke-3x sunyi + reservation_incomplete', async () => {
    const phone = `62887${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Form', DEFAULT_TENANT_ID);
    const v3Spy = vi.spyOn(V3AgentRunner, 'processMessage');

    async function turn(n: number) {
      return testStateMachine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
        incomingMessage: {
          id: `msg_form_${n}_${Date.now()}`,
          from: phone,
          timestamp: '1700000000',
          type: 'text',
          text: { body: INCOMPLETE_FORM },
        },
      });
    }

    const r1 = await turn(1);
    expect(r1.shouldSendReply).toBe(true);
    expect(r1.replyText).toMatch(/mohon diisi bagian/i);
    expect(r1.nextState).toBe(ConversationState.RESERVATION_SENT);

    // Turn 2: conversation masih RESERVATION_SENT (belum human) → prompt lagi.
    const convMid = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(convMid.is_human_handling).toBe(false);
    const r2 = await turn(2);
    expect(r2.shouldSendReply).toBe(true);
    expect(r2.replyText).toMatch(/mohon diisi bagian/i);

    const r3 = await turn(3);
    expect(r3.shouldSendReply).toBe(false);
    expect(r3.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(v3Spy).not.toHaveBeenCalled();

    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('reservation_incomplete');
    // Cabang form early-return: pengiriman oleh caller (queue worker), bukan
    // processMessage — maka cukup pastikan 2 prompt + 1 sunyi di level result.
    expect([r1.shouldSendReply, r2.shouldSendReply, r3.shouldSendReply]).toEqual([true, true, false]);
  });

  it('counter tersimpan di sesi (persistensi antar turn)', async () => {
    const phone = `62886${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Counter', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await GoalTracker.updateGoalSession(conv.id, { formRetryCount: 1 }, DEFAULT_TENANT_ID);
    const sess = await GoalTracker.getGoalSession(conv.id, DEFAULT_TENANT_ID);
    expect(sess.formRetryCount).toBe(1);
  });
});

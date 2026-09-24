import { describe, it, expect } from 'vitest';
import { ConversationState } from '@prisma/client';
import {
  reportTurnError,
  OUTAGE_TRANSITION_REPLY,
  TurnState,
} from '../../../src/v3/agent/pipeline/generation-stage';

function makeTurn(): TurnState {
  return {
    tenantId: 'default-tenant',
    phone: '6280000000000',
    conversationId: 'conv-test',
    incomingText: 'jadwal besok bisa?',
    selectedModel: 'glm-5.3-flash',
    baseUrl: '',
    apiKey: '',
    turnStartedAt: Date.now(),
    correlationId: 'corr-test',
    totalTokens: { prompt: 0, completion: 0, total: 0 },
    currentSystemPrompt: '',
    messages: [],
    executedTools: [],
    retrievedChunks: [],
    fewShotExemplars: [],
    reasoning: null,
    perCallLogged: false,
  };
}

describe('R1 outage transition (anti silent-drop)', () => {
  it('outage LLM mengirim pesan transisi + tetap eskalasi', async () => {
    const out = await reportTurnError(makeTurn(), { genderGreeting: 'Bunda' } as any, new Error('boom timeout'), 'jadwal besok bisa?');
    expect(out.shouldSendReply).toBe(true);
    expect(out.isEscalated).toBe(true);
    expect(out.replyText).toBe(OUTAGE_TRANSITION_REPLY);
    expect(out.replyText).toContain('Bidan');
    expect(out.nextState).toBe(ConversationState.HUMAN_HANDLING);
  });

  it('transisi tidak membocorkan detail error teknis / PII', async () => {
    const out = await reportTurnError(makeTurn(), { genderGreeting: 'Bunda' } as any, new Error('boom timeout secret-key-xyz'), 'halo');
    expect(out.replyText).not.toContain('boom');
    expect(out.replyText).not.toContain('secret-key-xyz');
    expect(out.replyText).not.toContain('6280000000000');
  });
});

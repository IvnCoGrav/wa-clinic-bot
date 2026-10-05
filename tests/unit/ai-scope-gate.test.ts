import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AiCustomerScope, AiOverride, ConversationState } from '@prisma/client';
import { enforceAiScopeGate } from '../../src/services/ai-scope-gate.service';
import { AiEligibilityConfigService } from '../../src/config/ai-eligibility-config';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../src/services/ai-eligibility.service';

/**
 * Test AI Rollout Scope Gate (enforceAiScopeGate) — lapisan pipeline-level:
 *   - Eligible / scope ALL            -> pass (tanpa eskalasi, tanpa log)
 *   - Ineligible + reset boundary     -> silence (escalate + log + status khusus)
 *   - Ineligible + mid-flow aktif     -> defer (pass; sesi dibiarkan selesai)
 *   - Ineligible + mid-flow idle 24j+ -> silence (machine akan reset → tidak menunda)
 *   - Sudah HUMAN_HANDLING            -> pass (alur human handling existing)
 *   - Override FORCE_ON / FORCE_OFF   -> menang atas scope
 *
 * CATATAN: "reset boundary" = INITIAL / COMPLETED ATAU idle > IDLE_TIMEOUT_MS
 * (default 24 jam), selaras dgn idle-reset di machine.ts. Definisi detail:
 * JSDoc di ai-scope-gate.service.ts.
 */

const TENANT = 'default-tenant';
const CUTOFF = new Date('2026-08-01T00:00:00Z');

function legacyCustomer(override: AiOverride | null = null) {
  return {
    id: 'cust_legacy',
    phone: '628100000001',
    ai_override: override,
    created_at: new Date('2026-07-20T00:00:00Z'), // < CUTOFF → legacy
  };
}

function newCustomer(override: AiOverride | null = null) {
  return {
    id: 'cust_new',
    phone: '628100000002',
    ai_override: override,
    created_at: new Date('2026-08-03T00:00:00Z'), // > CUTOFF → new
  };
}

function makeConversation(state: ConversationState, extra: any = {}) {
  return {
    id: 'conv_1',
    customer_id: 'cust_x',
    current_state: state,
    is_human_handling: false,
    last_message_at: new Date(),
    ...extra,
  };
}

describe('enforceAiScopeGate', () => {
  let escalateSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    escalateSpy = vi.spyOn(conversationService, 'escalateToHumanHandling').mockResolvedValue({});
    logSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);
    process.env.IDLE_TIMEOUT_MS = '86400000';
    await AiEligibilityConfigService.saveConfig(TENANT, {
      ai_customer_scope: AiCustomerScope.NEW_ONLY,
      ai_scope_cutoff_at: CUTOFF,
    });
  });

  afterEach(() => {
    delete process.env.IDLE_TIMEOUT_MS;
  });

  it('scope NEW_ONLY + customer legacy + INITIAL -> silence (eskalasi + log + status)', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.INITIAL),
      tenantId: TENANT,
      content: 'halo bunda',
      waMessageId: 'w1',
      payloadRaw: {},
    });
    expect(result.action).toBe('silence');
    expect(result).toMatchObject({ status: 'AI_SCOPE_INELIGIBLE_SILENCED' });
    expect(escalateSpy).toHaveBeenCalledTimes(1);
    const callArgs = escalateSpy.mock.calls[0];
    expect(callArgs[1]).toBe('628100000001');
    expect(callArgs[4]).toBe(AI_ELIGIBILITY_ESCALATION_REASON);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('scope NEW_ONLY + customer legacy + COMPLETED (sesi selesai) -> silence', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.COMPLETED),
      tenantId: TENANT,
      content: 'bunda masih ada?',
      waMessageId: 'w2',
      payloadRaw: {},
    });
    expect(result.action).toBe('silence');
    expect(escalateSpy).toHaveBeenCalledTimes(1);
  });

  it('scope NEW_ONLY + customer legacy + AWAITING_LOCATION fresh (mid-flow) -> defer (pass)', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.AWAITING_LOCATION, { last_message_at: new Date() }),
      tenantId: TENANT,
      content: 'alamat saya di surabaya',
      waMessageId: 'w3',
      payloadRaw: {},
    });
    expect(result.action).toBe('pass');
    expect(escalateSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('scope NEW_ONLY + customer legacy + AWAITING_LOCATION idle > 24 jam -> silence (reset boundary via idle)', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.AWAITING_LOCATION, {
        last_message_at: new Date(Date.now() - 48 * 60 * 60 * 1000),
      }),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'w4',
      payloadRaw: {},
    });
    expect(result.action).toBe('silence');
    expect(escalateSpy).toHaveBeenCalledTimes(1);
  });

  it('scope NEW_ONLY + customer baru (created_at >= cutoff) + INITIAL -> pass', async () => {
    const result = await enforceAiScopeGate({
      customer: newCustomer(),
      conversation: makeConversation(ConversationState.INITIAL),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'w5',
      payloadRaw: {},
    });
    expect(result.action).toBe('pass');
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  it('conversation sudah HUMAN_HANDLING -> pass (tidak re-eskalasi)', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.HUMAN_HANDLING, { is_human_handling: true }),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'w6',
      payloadRaw: {},
    });
    expect(result.action).toBe('pass');
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  it('FORCE_ON override menang: customer legacy tetap eligible -> pass', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(AiOverride.FORCE_ON),
      conversation: makeConversation(ConversationState.INITIAL),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'w7',
      payloadRaw: {},
    });
    expect(result.action).toBe('pass');
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  it('FORCE_OFF override menang: customer baru sekalipun -> silence', async () => {
    const result = await enforceAiScopeGate({
      customer: newCustomer(AiOverride.FORCE_OFF),
      conversation: makeConversation(ConversationState.INITIAL),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'w8',
      payloadRaw: {},
    });
    expect(result.action).toBe('silence');
    expect(escalateSpy).toHaveBeenCalledTimes(1);
  });

  it('scope ALL (rollout full) tanpa override -> pass utk customer legacy sekalipun', async () => {
    await AiEligibilityConfigService.saveConfig(TENANT, {
      ai_customer_scope: AiCustomerScope.ALL,
      ai_scope_cutoff_at: CUTOFF,
    });
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.INITIAL),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'w9',
      payloadRaw: {},
    });
    expect(result.action).toBe('pass');
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  // ── T-A/T-B/T-C: jam acuan idle = chat MASUK customer (bukan aktivitas apa pun) ──
  // Kasus pemicu 6285109356888: follow-up bot (outbound) menyegarkan last_message_at
  // sehingga percakapan yang sudah tidur 6 hari di mata customer dibaca "aktif" → bot
  // menjawab. Kolom benar = last_customer_message_at; last_message_at = fallback lawas.

  it('T-A: legacy + RESERVATION_SENT + follow-up bot fresh tapi customer idle 6 hari -> silence (bukan defer)', async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.RESERVATION_SENT, {
        last_message_at: new Date(Date.now() - 5 * 60 * 1000), // pesan follow-up bot 5 mnt lalu
        last_customer_message_at: sixDaysAgo, // chat masuk customer terakhir 6 hari lalu
      }),
      tenantId: TENANT,
      content: 'massage terakhir 5 hr yg lalu tgl 30 Sept',
      waMessageId: 'ta',
      payloadRaw: {},
    });
    expect(result.action).toBe('silence');
    expect(escalateSpy).toHaveBeenCalledTimes(1);
  });

  it('T-B: legacy + RESERVATION_SENT + customer baru chat 5 mnt (mid-flow asli) -> pass', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.RESERVATION_SENT, {
        last_message_at: fiveMinAgo,
        last_customer_message_at: fiveMinAgo,
      }),
      tenantId: TENANT,
      content: 'iya bun',
      waMessageId: 'tb',
      payloadRaw: {},
    });
    expect(result.action).toBe('pass');
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  it('T-C1: fallback migrasi — last_customer_message_at null + last_message_at fresh -> pass (perilaku lama)', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.RESERVATION_SENT, {
        last_message_at: new Date(),
        last_customer_message_at: null,
      }),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'tc1',
      payloadRaw: {},
    });
    expect(result.action).toBe('pass');
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  it('T-C2: fallback migrasi — last_customer_message_at null + last_message_at 48 jam -> silence', async () => {
    const result = await enforceAiScopeGate({
      customer: legacyCustomer(),
      conversation: makeConversation(ConversationState.RESERVATION_SENT, {
        last_message_at: new Date(Date.now() - 48 * 60 * 60 * 1000),
        last_customer_message_at: null,
      }),
      tenantId: TENANT,
      content: 'halo',
      waMessageId: 'tc2',
      payloadRaw: {},
    });
    expect(result.action).toBe('silence');
    expect(escalateSpy).toHaveBeenCalledTimes(1);
  });
});
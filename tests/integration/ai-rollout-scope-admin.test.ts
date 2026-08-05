import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { AiEligibilityConfigService } from '../../src/config/ai-eligibility-config';
import { AiCustomerScope, ConversationState } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../src/services/ai-eligibility.service';

/**
 * Admin API AI Rollout Scope — GET/PATCH /api/admin/ai-rollout-scope
 * dan PATCH /api/admin/customers/:id/ai-override.
 * DB mock offline: saveConfig bekerja in-memory (cache), setAiOverride fallback
 * di-spy, release FORCE_ON memakai spy conversation.
 */
describe('AI Rollout Scope Admin API', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_scope';
    process.env.ENABLE_WAHA_HOLD_LABEL = 'false';
  });

  it('T1: GET returns config default + summary dari DB', async () => {
    vi.mocked(prisma.customer.count).mockResolvedValue(100);
    (prisma.conversation as any).count = vi.fn().mockResolvedValue(7);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-rollout-scope',
      headers: { 'x-api-key': 'test_admin_key_scope' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.summary).toMatchObject({ totalCustomers: 100, silencedByScope: 7 });
    expect(body.summary.legacyCustomers).toBe(100 - body.summary.newCustomers);
  });

  it('T2: PATCH scope NEW_ONLY + cutoff tersimpan (cache) & audit', async () => {
    const cutoff = '2026-08-05T00:00:00.000Z';
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-rollout-scope',
      headers: { 'x-api-key': 'test_admin_key_scope' },
      payload: { aiCustomerScope: 'NEW_ONLY', aiScopeCutoffAt: cutoff },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.ai_customer_scope).toBe('NEW_ONLY');
    expect(new Date(body.data.ai_scope_cutoff_at).toISOString()).toBe(cutoff);

    // Cache ter-update → GET berikutnya mengembalikan scope NEW_ONLY
    expect(AiEligibilityConfigService.getConfig(DEFAULT_TENANT_ID).ai_customer_scope).toBe(AiCustomerScope.NEW_ONLY);
  });

  it('T3: PATCH body invalid → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-rollout-scope',
      headers: { 'x-api-key': 'test_admin_key_scope' },
      payload: { aiCustomerScope: 'INVALID_SCOPE' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T4: PATCH override FORCE_OFF pada customer disimpan + audit', async () => {
    const spySet = vi.spyOn(customerService, 'setAiOverride').mockResolvedValue({ id: 'cust_1', phone: '628111', ai_override: 'FORCE_OFF' } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/cust_1/ai-override',
      headers: { 'x-api-key': 'test_admin_key_scope' },
      payload: { aiOverride: 'FORCE_OFF' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.aiOverride).toBe('FORCE_OFF');
    expect(spySet).toHaveBeenCalledWith('cust_1', DEFAULT_TENANT_ID, 'FORCE_OFF');
  });

  it('T5: PATCH override FORCE_ON melepas conversation tersenyap LEGACY_AI_SCOPE_DISABLED', async () => {
    vi.spyOn(customerService, 'setAiOverride').mockResolvedValue({ id: 'cust_1', phone: '628111', ai_override: 'FORCE_ON' } as any);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
      id: 'conv_legacy',
      customer_id: 'cust_1',
      tenant_id: DEFAULT_TENANT_ID,
      is_human_handling: true,
      escalation_reason: AI_ELIGIBILITY_ESCALATION_REASON,
      previous_state: ConversationState.AWAITING_INTEREST,
    } as any);
    const spyUpdate = vi.spyOn(conversationService, 'updateConversationState').mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/cust_1/ai-override',
      headers: { 'x-api-key': 'test_admin_key_scope' },
      payload: { aiOverride: 'FORCE_ON' },
    });

    expect(res.statusCode).toBe(200);
    expect(spyUpdate).toHaveBeenCalledTimes(1);
    const args = spyUpdate.mock.calls[0];
    expect(args[1]).toMatchObject({
      isHumanHandling: false,
      escalationReason: null,
      currentState: ConversationState.AWAITING_INTEREST,
    });
  });

  it('T6: PATCH override aiOverride invalid → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/cust_1/ai-override',
      headers: { 'x-api-key': 'test_admin_key_scope' },
      payload: { aiOverride: 'MAYBE' },
    });
    expect(res.statusCode).toBe(400);
  });
});
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveAiEligibilityWithReason,
  resolveAiEligibility,
  EXISTING_PATIENT_ESCALATION_REASON,
  LEGACY_CUSTOMER_ESCALATION_REASON,
  AI_ELIGIBILITY_ESCALATION_REASON,
} from '../../src/services/ai-eligibility.service';
import { enforceAiScopeGate } from '../../src/services/ai-scope-gate.service';
import { AiEligibilityConfigService } from '../../src/config/ai-eligibility-config';
import { ConversationState } from '@prisma/client';

describe('Legacy & Repeat Patient Manual Bypass Tests', () => {
  const baseTenantConfig = {
    ai_customer_scope: 'ALL' as const,
    ai_scope_cutoff_at: new Date('2026-08-01T00:00:00Z'),
    legacy_bypass_bot: true,
    repeat_patient_bypass_bot: true,
  };

  describe('resolveAiEligibilityWithReason', () => {
    it('1. Pasien yang sudah pernah treatment / repeat order harus di-bypass ke CS manual jika repeat_patient_bypass_bot = true', () => {
      const repeatCustomer1 = {
        id: 'cust_repeat_1',
        has_confirmed_reservation: true,
        created_at: new Date('2026-08-20T00:00:00Z'),
      };
      const res1 = resolveAiEligibilityWithReason(repeatCustomer1, baseTenantConfig);
      expect(res1.eligible).toBe(false);
      expect(res1.reason).toBe(EXISTING_PATIENT_ESCALATION_REASON);

      const repeatCustomer2 = {
        id: 'cust_repeat_2',
        purchase_count: 2,
        created_at: new Date('2026-08-20T00:00:00Z'),
      };
      const res2 = resolveAiEligibilityWithReason(repeatCustomer2, baseTenantConfig);
      expect(res2.eligible).toBe(false);
      expect(res2.reason).toBe(EXISTING_PATIENT_ESCALATION_REASON);

      const repeatCustomer3 = {
        id: 'cust_repeat_3',
        status: 'repeat',
        created_at: new Date('2026-08-20T00:00:00Z'),
      };
      const res3 = resolveAiEligibilityWithReason(repeatCustomer3, baseTenantConfig);
      expect(res3.eligible).toBe(false);
      expect(res3.reason).toBe(EXISTING_PATIENT_ESCALATION_REASON);
    });

    it('2. Pasien repeat harus diizinkan dibalas bot jika toggle repeat_patient_bypass_bot = false (dan scope ALL)', () => {
      const configWithRepeatAllowed = {
        ...baseTenantConfig,
        repeat_patient_bypass_bot: false,
      };
      const repeatCustomer = {
        id: 'cust_repeat_allowed',
        has_confirmed_reservation: true,
        created_at: new Date('2026-08-20T00:00:00Z'),
      };
      const res = resolveAiEligibilityWithReason(repeatCustomer, configWithRepeatAllowed);
      expect(res.eligible).toBe(true);
    });

    it('3. Kontak legacy harus di-bypass ke CS manual jika legacy_bypass_bot = true', () => {
      const legacyCustomer1 = {
        id: 'cust_legacy_1',
        is_legacy_source: true,
        created_at: new Date('2026-08-20T00:00:00Z'),
      };
      const res1 = resolveAiEligibilityWithReason(legacyCustomer1, baseTenantConfig);
      expect(res1.eligible).toBe(false);
      expect(res1.reason).toBe(LEGACY_CUSTOMER_ESCALATION_REASON);

      const legacyCustomer2 = {
        id: 'cust_legacy_2',
        status: 'legacy',
        created_at: new Date('2026-08-20T00:00:00Z'),
      };
      const res2 = resolveAiEligibilityWithReason(legacyCustomer2, baseTenantConfig);
      expect(res2.eligible).toBe(false);
      expect(res2.reason).toBe(LEGACY_CUSTOMER_ESCALATION_REASON);
    });

    it('4. Kontak legacy harus diizinkan jika toggle legacy_bypass_bot = false (dan scope ALL)', () => {
      const configWithLegacyAllowed = {
        ...baseTenantConfig,
        legacy_bypass_bot: false,
      };
      const legacyCustomer = {
        id: 'cust_legacy_allowed',
        is_legacy_source: true,
        created_at: new Date('2026-08-20T00:00:00Z'),
      };
      const res = resolveAiEligibilityWithReason(legacyCustomer, configWithLegacyAllowed);
      expect(res.eligible).toBe(true);
    });

    it('5. Override FORCE_ON selalu menang atas batasan bypass legacy dan repeat', () => {
      const forcedCustomer = {
        id: 'cust_forced',
        is_legacy_source: true,
        has_confirmed_reservation: true,
        ai_override: 'FORCE_ON',
      };
      const res = resolveAiEligibilityWithReason(forcedCustomer, baseTenantConfig);
      expect(res.eligible).toBe(true);
    });

    it('6. Scope NEW_ONLY tetap membungkam customer sebelum tanggal cutoff', () => {
      const newOnlyConfig = {
        ai_customer_scope: 'NEW_ONLY' as const,
        ai_scope_cutoff_at: new Date('2026-08-15T00:00:00Z'),
        legacy_bypass_bot: false,
        repeat_patient_bypass_bot: false,
      };
      const oldCustomer = {
        id: 'cust_old',
        created_at: new Date('2026-08-10T00:00:00Z'),
      };
      const res = resolveAiEligibilityWithReason(oldCustomer, newOnlyConfig);
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe(AI_ELIGIBILITY_ESCALATION_REASON);
    });
  });

  describe('enforceAiScopeGate Integration', () => {
    beforeEach(() => {
      AiEligibilityConfigService.clearCache();
    });

    it('7. enforceAiScopeGate harus men-silence repeat customer di reset boundary dan mencatat reason EXISTING_PATIENT_MANUAL', async () => {
      AiEligibilityConfigService.saveConfig('default-tenant', {
        ai_customer_scope: 'ALL' as any,
        legacy_bypass_bot: true,
        repeat_patient_bypass_bot: true,
      });

      const customer = {
        id: 'cust_gate_repeat',
        phone: '628111222333',
        status: 'repeat',
        created_at: new Date(),
      };

      const conversation = {
        id: 'conv_gate_repeat',
        current_state: ConversationState.INITIAL,
        is_human_handling: false,
        last_message_at: null,
      };

      const res = await enforceAiScopeGate({
        customer,
        conversation,
        tenantId: 'default-tenant',
        content: 'Halo, saya mau booking treatment lagi',
        waMessageId: 'msg_gate_001',
        payloadRaw: {},
      });

      expect(res.action).toBe('silence');
      expect(res.status).toBe('AI_SCOPE_INELIGIBLE_SILENCED');
    });

    it('8. enforceAiScopeGate harus men-silence legacy customer di reset boundary dan mencatat reason LEGACY_CUSTOMER_MANUAL', async () => {
      AiEligibilityConfigService.saveConfig('default-tenant', {
        ai_customer_scope: 'ALL' as any,
        legacy_bypass_bot: true,
        repeat_patient_bypass_bot: true,
      });

      const customer = {
        id: 'cust_gate_legacy',
        phone: '628555666777',
        is_legacy_source: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
      };

      const conversation = {
        id: 'conv_gate_legacy',
        current_state: ConversationState.INITIAL,
        is_human_handling: false,
        last_message_at: null,
      };

      const res = await enforceAiScopeGate({
        customer,
        conversation,
        tenantId: 'default-tenant',
        content: 'Halo Kala spa',
        waMessageId: 'msg_gate_002',
        payloadRaw: {},
      });

      expect(res.action).toBe('silence');
      expect(res.status).toBe('AI_SCOPE_INELIGIBLE_SILENCED');
    });
  });
});

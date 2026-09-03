/**
 * Edge case: 4-Turn Dialogue — Verifikasi 2 masalah struktural:
 * 1. NLU Knowledge Blindness: Oksitosin tidak lagi dianggap unlisted service
 * 2. Non-Idempotent Location: Ongkir tidak mengirim ulang di Turn 3
 */
import { describe, it, expect } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { SlateStore } from '../../src/slot-engine/slate-store';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';
import { ConversationState } from '@prisma/client';

const mockCtx: any = {
  customer: { id: 'c_test', phone: '628123', name: 'Bunda', tenant_id: 'default-tenant', preferences: {} },
  conversation: { id: 'conv_test', current_state: ConversationState.INITIAL, is_human_handling: false, last_discussed_treatment: null, last_message_at: new Date() },
  history: [],
};

function makeSlate(overrides: any = {}) {
  let slate = SlateStore.hydrateSlate(mockCtx);
  return { ...slate, ...overrides };
}

describe('4-Turn Edge Case: NLU Catalog Grounding + Location Idempotency', () => {
  it('Turn 4: "Oksitosin massage fullbody sekitar berapa menit" should NOT be ESCALATE_HUMAN_UNLISTED_SERVICE', async () => {
    const slate = makeSlate({
      isLocationConfirmed: true,
      kelurahan: 'Ngagel Dadi',
      kecamatan: 'Gubeng',
      kota: 'Surabaya',
      distanceKm: 5.2,
      ongkirFee: 15000,
      ongkirPromoFee: 10000,
      isOutOfCoverage: false,
    });

    // Simulate NLU extraction for "Oksitosin massage fullbody sekitar berapa menit ya kak"
    const extraction = await EntityExtractor.extract(
      'Oksitosin massage fullbody sekitar berapa menit ya kak',
      { history: mockCtx.history, customerPhone: slate.phone, conversationId: slate.conversationId, tenantId: slate.tenantId }
    );

    console.log('Extraction intents:', extraction.intents);
    console.log('Extraction treatmentReferenced:', extraction.treatmentReferenced);

    const decision = await DecisionMatrix.evaluate(slate, extraction, {
      tenantId: slate.tenantId,
      incomingText: 'Oksitosin massage fullbody sekitar berapa menit ya kak',
      history: mockCtx.history,
    });

    console.log('Decision action:', decision.action);
    console.log('Decision reason:', decision.reason);

    // Should NOT escalate — Oksitosin is a real catalog service
    expect(decision.action).not.toBe('ESCALATE_HUMAN_UNLISTED_SERVICE');
    // Should generate AI response to answer the duration question
    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
  });

  it('Turn 3: Repeated location after confirmed should NOT re-trigger ongkir', async () => {
    const slate = makeSlate({
      isLocationConfirmed: true,
      kelurahan: 'Ngagel Dadi',
      kecamatan: 'Gubeng',
      kota: 'Surabaya',
      distanceKm: 5.2,
      ongkirFee: 15000,
      ongkirPromoFee: 10000,
      isOutOfCoverage: false,
      selectedTreatmentName: 'Pijat Bayi Ceria',
      preferredDate: '8 Agustus',
    });

    // Simulate NLU re-extracting location from history (hallucination)
    const extraction = {
      intents: ['ask_schedule'] as any[],
      locationText: 'Ngagel Dadi',
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: '8 Agustus',
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
    };

    const decision = await DecisionMatrix.evaluate(slate, extraction, {
      tenantId: slate.tenantId,
      incomingText: 'Untuk tanggal 8 agustus cukur dan pijat bayi kak',
      history: [
        { role: 'user', content: 'Di jl. Ngagel dadi kak' },
        { role: 'assistant', content: 'Ongkir Rp 10.000 ya Bunda' },
      ],
    });

    console.log('Turn 3 decision:', decision.action, decision.reason);

    // Should NOT re-enter ongkir flow — location already confirmed, no explicit change
    expect(decision.action).not.toBe('RESOLVE_LOCATION_AND_DELIVERY');
    // Should proceed to booking/schedule since treatment + date are set
    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
  });
});

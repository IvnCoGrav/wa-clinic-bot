import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';
import * as modelFallback from '../../src/integrations/llm/model-fallback';

describe('Zero-Regex Chat Handling & Anti-Loop Scenario Tests', () => {
  const initialSlate: CustomerSlate = {
    customerId: 'cust-123',
    phone: '6289520520222',
    name: 'Bunda',
    tenantId: 'default-tenant',
    conversationId: 'conv-123',
    kelurahan: null,
    kecamatan: null,
    kota: null,
    lat: null,
    lng: null,
    streetDetail: null,
    distanceKm: null,
    ongkirFee: null,
    ongkirPromoFee: null,
    isLocationConfirmed: false,
    isOutOfCoverage: false,
    childAgeMonths: null,
    childAgeCategory: null,
    symptoms: [],
    medicalConcerns: [],
    selectedTreatmentName: null,
    preferredDate: null,
    preferredTime: null,
    pricelistSent: false,
    reservationFormSent: false,
    isHumanHandling: false,
    humanHandlingReason: null,
    lastInteractionAt: new Date(),
    projectedState: ConversationState.INITIAL,
  };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'mock_key';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();
  });

  it('Turn 1: "Bu ini lokasi mna" should be extracted as ask_clinic_origin with location_text = null and return clinicOriginPolicy', async () => {
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      baseUrl: 'https://api.sumopod.com',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intents: ['ask_clinic_origin'],
                location_text: null,
                street_detail: null,
                child_age_months: null,
                symptoms: [],
                treatment_referenced: null,
                preferred_date_text: null,
                preferred_time_text: null,
                customer_name: null,
                is_medical_emergency: false,
                confidence_score: 0.95,
              }),
            },
          },
        ],
      },
    } as any);

    const extraction = await EntityExtractor.extract('Bu ini lokasi mna', {
      customerPhone: '6289520520222',
    });

    expect(extraction.intents).toContain('ask_clinic_origin');
    expect(extraction.locationText).toBeNull();
    expect(extraction.intents).not.toContain('provide_location');

    const decision = await DecisionMatrix.evaluate(initialSlate, extraction, {
      incomingText: 'Bu ini lokasi mna',
      tenantId: 'default-tenant',
    });

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toContain('Homecare');
    expect(decision.deterministicTemplateReply).toContain('Waru');
    expect(decision.updatedSlate.isOutOfCoverage).toBe(false);
  });

  it('Turn 4: "saya kira seluruh SBY bs" should be extracted as ask_coverage_scope and return coverageAreaPolicy', async () => {
    const oocSlate: CustomerSlate = {
      ...initialSlate,
      isOutOfCoverage: true,
      distanceKm: 80.32,
      kelurahan: 'mna',
    };

    const extraction: ExtractedEntities = {
      intents: ['ask_coverage_scope'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const decision = await DecisionMatrix.evaluate(oocSlate, extraction, {
      incomingText: 'saya kira seluruh SBY bs',
      tenantId: 'default-tenant',
    });

    // DecisionMatrix must NOT block with out of coverage rejection loop!
    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toContain('Surabaya');
    expect(decision.deterministicTemplateReply).toContain('Sidoarjo');
  });

  it('Turn 5: "robot" should be extracted as request_human and escalate to human CS', async () => {
    const oocSlate: CustomerSlate = {
      ...initialSlate,
      isOutOfCoverage: true,
      distanceKm: 80.32,
      kelurahan: 'mna',
    };

    const extraction: ExtractedEntities = {
      intents: ['request_human'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const decision = await DecisionMatrix.evaluate(oocSlate, extraction, {
      incomingText: 'robot',
      tenantId: 'default-tenant',
    });

    expect(decision.action).toBe('ESCALATE_HUMAN_AGENT_REQUEST');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.deterministicTemplateReply).toContain('Admin');
  });

  it('Subsequent conversation turns on previously out-of-coverage customer should flow into AI Generator without looping static rejection', async () => {
    const oocSlate: CustomerSlate = {
      ...initialSlate,
      isOutOfCoverage: true,
      distanceKm: 80.32,
      kelurahan: 'mna',
    };

    const extraction: ExtractedEntities = {
      intents: ['chitchat'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const decision = await DecisionMatrix.evaluate(oocSlate, extraction, {
      incomingText: 'koq bs tau lokasi sy',
      tenantId: 'default-tenant',
      history: [
        { role: 'user', content: 'Bu ini lokasi mna' },
        { role: 'assistant', content: 'Mohon maaf bunda, lokasi Bunda berjarak 80.3 km...' },
      ],
    });

    // Must NOT return REJECT_OUT_OF_COVERAGE! Must proceed to GENERATE_AI_RESPONSE
    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
  });
});

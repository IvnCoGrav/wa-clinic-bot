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

  it('Turn 1: "Bu ini lokasi mna" should be extracted as ask_clinic_origin with location_text from deterministic and return clinicOriginPolicy', async () => {
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

    const decision = await DecisionMatrix.evaluate(initialSlate, extraction, {
      incomingText: 'Bu ini lokasi mna',
      tenantId: 'default-tenant',
    });

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toMatch(/Waru.*Sidoarjo/i);
  });
});

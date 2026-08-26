import { describe, it, expect, vi } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { GroundingComposer } from '../../src/slot-engine/grounding-composer';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Deterministic Decision Matrix & Grounding Package Composer (Part 4)', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'cust_123',
    phone: '6288235780925',
    name: 'Bunda Melati',
    tenantId: 'tenant_default',
    conversationId: 'conv_123',
    kelurahan: 'Pradah Kalikendal',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.281,
    lng: 112.684,
    streetDetail: null,
    distanceKm: 16.99,
    ongkirFee: 25000,
    ongkirPromoFee: 20000,
    isLocationConfirmed: true,
    isOutOfCoverage: false,
    childAgeMonths: 2,
    childAgeCategory: 'BABY',
    symptoms: ['grok-grok'],
    medicalConcerns: [],
    selectedTreatmentName: null,
    preferredDate: null,
    preferredTime: null,
    pricelistSent: true,
    isHumanHandling: false,
    humanHandlingReason: null,
    lastInteractionAt: new Date(),
    projectedState: ConversationState.AWAITING_INTEREST,
  };

  const emptyExtraction: ExtractedEntities = {
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
    confidenceScore: 0.9,
  };

  it('Priority 1: should immediately escalate on medical emergency', async () => {
    const emergencyExtraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['medical_emergency'],
      isMedicalEmergency: true,
      symptoms: ['kejang dan tidak sadar'],
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, emergencyExtraction);
    expect(decision.action).toBe('ESCALATE_HUMAN_EMERGENCY');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.updatedSlate.humanHandlingReason).toBe('medical_concern');
  });

  it('Priority 2: should remain silent when human CS is actively handling', async () => {
    const humanSlate: CustomerSlate = {
      ...baseSlate,
      isHumanHandling: true,
      humanHandlingReason: 'manual_takeover',
    };

    const decision = await DecisionMatrix.evaluate(humanSlate, emptyExtraction);
    expect(decision.action).toBe('SILENT_HUMAN_ACTIVE');
  });

  it('Priority 4: should reject out-of-coverage requests politely', async () => {
    const outOfCoverageSlate: CustomerSlate = {
      ...baseSlate,
      isOutOfCoverage: true,
      distanceKm: 35.5,
    };

    const decision = await DecisionMatrix.evaluate(outOfCoverageSlate, emptyExtraction);
    expect(decision.action).toBe('REJECT_OUT_OF_COVERAGE');
    expect(decision.deterministicTemplateReply).toContain('di luar jangkauan');
  });

  it('Priority 5: should return reservation form when treatment and date are set', async () => {
    const readyBookingExtraction: ExtractedEntities = {
      ...emptyExtraction,
      treatmentReferenced: 'Pijat Bayi Pulih Ceria',
      preferredDateText: 'Besok Sabtu jam 10 pagi',
      intents: ['select_treatment', 'request_booking'],
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, readyBookingExtraction);
    expect(decision.action).toBe('SEND_RESERVATION_FORM');
    expect(decision.deterministicTemplateReply).toContain('list untuk reservasi');
    expect(decision.updatedSlate.selectedTreatmentName).toBe('Pijat Bayi Pulih Ceria');
  });

  it('Priority 6: should route general inquiries to AI response generation', async () => {
    const faqExtraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['consult_symptom', 'ask_price'],
      symptoms: ['grok-grok'],
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, faqExtraction);
    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
  });

  describe('GroundingComposer Token Diet', () => {
    it('should filter only baby services for a 2-month-old infant', async () => {
      const grounding = await GroundingComposer.compose(baseSlate, emptyExtraction);

      expect(grounding.deliveryFacts?.distanceKm).toBe(16.99);
      expect(grounding.deliveryFacts?.ongkirPromo).toBe(20000);
      expect(grounding.clinicFacts.homebase).toContain('Waru, Sidoarjo');

      // Memastikan paket yang dikirim tidak memuat paket Moms/Dewasa
      const hasMomsService = grounding.filteredCatalog.some((s) => s.category === 'MOMS');
      expect(hasMomsService).toBe(false);
      expect(grounding.filteredCatalog.length).toBeLessThanOrEqual(5);
    });

    it('should filter only kids services for a 3-year-old (36 months) child', async () => {
      const kidsSlate: CustomerSlate = {
        ...baseSlate,
        childAgeMonths: 36,
        childAgeCategory: 'KIDS',
      };

      const grounding = await GroundingComposer.compose(kidsSlate, emptyExtraction);
      const hasMomsService = grounding.filteredCatalog.some((s) => s.category === 'MOMS');
      expect(hasMomsService).toBe(false);
    });
  });
});

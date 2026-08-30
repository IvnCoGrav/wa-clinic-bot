import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';
import { GroundingComposer } from '../../src/slot-engine/grounding-composer';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Real Customer WhatsApp Conversation Regression Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseSlate: CustomerSlate = {
    phone: '6289999499284',
    tenantId: 'tenant_default',
    name: 'Sandbox Customer',
    kelurahan: null,
    kecamatan: null,
    kota: null,
    lat: null,
    lng: null,
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
    projectedState: ConversationState.INITIAL,
    rawPreferences: {},
  };

  it('Skenario 1: Change of Mind ("gak jadi bund di brebek aja") harus mengoreksi lokasi ke Berbek, bukan Not Interested', async () => {
    const slateTurn1: CustomerSlate = {
      ...baseSlate,
      selectedTreatmentName: 'Pijat Bayi Ceria',
      preferredDate: 'hari ini',
      projectedState: ConversationState.AWAITING_LOCATION,
    };

    const extraction = EntityExtractor.preExtractDeterministic('gak jadi bund di brebek aja');
    expect(extraction.locationText).toBe('Berbek');
    expect(extraction.intents || []).toContain('provide_location');

    const fullExtraction: ExtractedEntities = {
      intents: ['provide_location'],
      locationText: 'Berbek',
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

    const decision = await DecisionMatrix.evaluate(slateTurn1, fullExtraction, {
      incomingText: 'gak jadi bund di brebek aja',
    });

    expect(decision.action).not.toBe('NOT_INTERESTED_COMPLETED');
    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.updatedSlate.kelurahan).toBe('Berbek');
    expect(decision.updatedSlate.selectedTreatmentName).toBe('Pijat Bayi Ceria');
    expect(decision.updatedSlate.preferredDate).toBe('hari ini');
    expect(decision.deterministicTemplateReply).toContain('GRATIS ongkir');
    expect(decision.deterministicTemplateReply).toContain('Pijat Bayi Ceria');
    expect(decision.deterministicTemplateReply).toContain('hari ini');
  });

  it('Skenario 2: Pertanyaan Pasca Vaksin BCG & Polio TIDAK BOLEH memicu silent escalation ke CS', async () => {
    const slateWithLocation: CustomerSlate = {
      ...baseSlate,
      kelurahan: 'Buduran',
      kecamatan: 'Buduran',
      kota: 'Kabupaten Sidoarjo',
      lat: -7.43,
      lng: 112.72,
      distanceKm: 13.3,
      ongkirFee: 25000,
      ongkirPromoFee: 15000,
      isLocationConfirmed: true,
      childAgeMonths: 0.4,
      selectedTreatmentName: 'Pijat Bayi Ceria',
      projectedState: ConversationState.AWAITING_INTEREST,
    };

    const queryText =
      'kalo misal sudah boleh pijat, hari ini kan kebetulan anak saya habis vaksin bcg dan polio apakah berpengaruh kalo semisal saya ambil hari ini pijatnya?';

    const extraction = EntityExtractor.preExtractDeterministic(queryText);
    expect(extraction.intents || []).not.toContain('ask_unlisted_service');

    const fullExtraction: ExtractedEntities = {
      intents: ['consult_symptom', 'ask_schedule'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: 'hari ini',
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const decision = await DecisionMatrix.evaluate(slateWithLocation, fullExtraction, {
      incomingText: queryText,
    });

    expect(decision.action).not.toBe('ESCALATE_HUMAN_UNLISTED_SERVICE');
    expect(decision.action).toBe('GENERATE_AI_RESPONSE');

    const grounding = await GroundingComposer.compose(decision.updatedSlate, fullExtraction, {
      customerInput: queryText,
    });

    expect(grounding.customerPreferencesText).toContain('DATA TERKONFIRMASI');
    expect(grounding.customerPreferencesText).toContain('Pijat Bayi Ceria');
  });

  it('Skenario 3: Konsultasi Newborn 26 hari batuk pilek grok-grok -> Switch ke Pulih Ceria & Generate Pre-filled Form', async () => {
    const slateReady: CustomerSlate = {
      ...baseSlate,
      kelurahan: 'Berbek',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
      lat: -7.34,
      lng: 112.75,
      distanceKm: 3.2,
      ongkirFee: 0,
      ongkirPromoFee: 0,
      isLocationConfirmed: true,
      preferredDate: 'hari ini',
      selectedTreatmentName: 'Pijat Bayi Ceria',
      projectedState: ConversationState.AWAITING_INTEREST,
    };

    const queryText =
      'Usia adek 26hari Bu bidan, lg batuk pilek jd susah tidur karena hidung buntu sm nafasnya grok". Jd baiknya ambil treatment yg mna Bu bidan?';

    const extraction: ExtractedEntities = {
      intents: ['provide_age', 'consult_symptom', 'select_treatment'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: 0.86,
      symptoms: ['batuk', 'pilek', 'susah tidur', 'hidung buntu', 'grok-grok'],
      treatmentReferenced: 'Pijat Bayi Pulih Ceria',
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.98,
    };

    const decision = await DecisionMatrix.evaluate(slateReady, extraction, {
      incomingText: queryText,
    });

    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
    expect(decision.updatedSlate.selectedTreatmentName).toBe('Pijat Bayi Pulih Ceria');
    expect(decision.updatedSlate.symptoms).toContain('batuk');
    expect(decision.updatedSlate.symptoms).toContain('grok-grok');

    const grounding = await GroundingComposer.compose(decision.updatedSlate, extraction, {
      customerInput: queryText,
    });

    expect(grounding.isBookingReady).toBe(true);
    expect(grounding.suggestedPreFilledForm).not.toBeNull();
    expect(grounding.suggestedPreFilledForm).toContain('Berbek');
    expect(grounding.suggestedPreFilledForm).toContain('Pijat Bayi Pulih Ceria');
    expect(grounding.suggestedPreFilledForm).toContain('hari ini');
  });
});

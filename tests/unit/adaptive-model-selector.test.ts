import { describe, it, expect } from 'vitest';
import { AdaptiveModelSelector } from '../../src/slot-engine/adaptive-model-selector';
import { ExtractedEntities, CustomerSlate } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('AdaptiveModelSelector (Complexity-Driven Model Selection)', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'cust_123',
    phone: '6288235780925',
    name: 'Bunda Melati',
    tenantId: 'default-tenant',
    conversationId: 'conv_123',
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

  it('should select fast/standard model for simple greeting / general FAQ', () => {
    const result = AdaptiveModelSelector.selectModel(baseSlate, emptyExtraction, {
      customerInput: 'Halo Bidan Yusi',
      history: [],
    });

    expect(result.task).toBe('CHAT_REPLY');
    expect(result.isDeepModel).toBe(false);
  });

  it('should select deep model when customer has multiple complex symptoms', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['consult_symptom'],
      symptoms: ['batuk', 'pilek', 'grok-grok', 'demam'],
    };

    const result = AdaptiveModelSelector.selectModel(baseSlate, extraction, {
      customerInput: 'Anak saya batuk, pilek, grok-grok sama demam sudah 2 hari',
      history: [],
    });

    expect(result.task).toBe('CHAT_REPLY_DEEP');
    expect(result.isDeepModel).toBe(true);
    expect(result.reason).toContain('Multi-gejala klinis');
  });

  it('should select deep model when customer asks combined clinical consultation + price/schedule', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['consult_symptom', 'ask_price'],
      symptoms: ['kolik'],
    };

    const result = AdaptiveModelSelector.selectModel(baseSlate, extraction, {
      customerInput: 'Kalau bayi sering kolik kembung biayanya berapa dan bisa dipijat hari sabtu?',
      history: [],
    });

    expect(result.task).toBe('CHAT_REPLY_DEEP');
    expect(result.isDeepModel).toBe(true);
  });

  it('should select deep model for Moms and Baby bundling discussions', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['select_treatment'],
    };

    const result = AdaptiveModelSelector.selectModel(baseSlate, extraction, {
      customerInput: 'Mau ambil paket laktasi untuk saya dan pijat flu untuk baby bisa?',
      history: [],
    });

    expect(result.task).toBe('CHAT_REPLY_DEEP');
    expect(result.isDeepModel).toBe(true);
    expect(result.reason).toContain('Moms & Baby');
  });
});

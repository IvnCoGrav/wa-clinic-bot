import { describe, it, expect } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { ReplyGenerator } from '../../src/slot-engine/reply-generator';
import { CustomerSlate, ExtractedEntities, GroundingPackage } from '../../src/slot-engine/types';

describe('Slot Engine Turn-0 Initial Greeting Tests', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'c_opener_test',
    phone: '628999999999',
    tenantId: 'default-tenant',
    isLocationConfirmed: false,
    kelurahan: null,
    kecamatan: null,
    kota: null,
    distanceKm: null,
    ongkirFee: null,
    ongkirPromoFee: null,
    childAgeMonths: null,
    childAgeCategory: null,
    selectedTreatmentName: null,
    medicalConcerns: [],
    symptoms: [],
    isOutOfCoverage: false,
    reservationFormSent: false,
    lastInteractionAt: new Date().toISOString(),
    conversationState: 'INITIAL',
  };

  it('1. Customer kirim "bisa kah" di awal percakapan -> harus membalas template greeting resmi Bidan Yusi', async () => {
    const extraction: ExtractedEntities = {
      intents: ['general_inquiry'],
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

    const decision = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'bisa kah',
      history: [],
    });

    expect(decision.deterministicTemplateReply).toBeDefined();
    expect(decision.deterministicTemplateReply).toContain('Halo Bunda ! ✨');
    expect(decision.deterministicTemplateReply).toContain('Perkenalkan, saya Bidan Yusi');
    expect(decision.deterministicTemplateReply).toContain('Kalau boleh tau rumahnya dimana ya Bunda? 😊');
  });

  it('2. Customer kirim "halo", "selamat malam", "p" di awal chat -> harus membalas template greeting resmi', async () => {
    for (const text of ['halo', 'Selmat malam', 'p', 'bisa homecare?']) {
      const extraction: ExtractedEntities = {
        intents: ['general_inquiry'],
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

      const decision = await DecisionMatrix.evaluate(baseSlate, extraction, {
        incomingText: text,
        history: [],
      });

      expect(decision.deterministicTemplateReply).toBeDefined();
      expect(decision.deterministicTemplateReply).toContain('Bidan Yusi');
      expect(decision.deterministicTemplateReply).toContain('Kalau boleh tau rumahnya dimana ya Bunda? 😊');
    }
  });

  it('3. Customer kirim pertanyaan spesifik di Turn-0 -> ReplyGenerator wajib menyertakan header perkenalan Bidan Yusi', async () => {
    const extraction: ExtractedEntities = {
      intents: ['consult_symptom'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: ['batuk', 'pilek'],
      treatmentReferenced: 'Pijat Bayi Pulih Ceria',
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
    };

    const grounding: GroundingPackage = {
      filteredCatalog: [],
      deliveryFacts: null,
      clinicFacts: { homebase: 'Waru', coverage: 'Surabaya & Sidoarjo' },
      symptomsDiscussed: ['batuk', 'pilek'],
      missingSlotsToPrompt: 'LOCATION',
    };

    const reply = await ReplyGenerator.generate(baseSlate, extraction, grounding, {
      history: [],
      customerInput: 'Kalau mau pijat batuk pilek bisa ?',
      customerPhone: '628999999999',
    });

    expect(reply).toContain('Bidan Yusi');
  });
});

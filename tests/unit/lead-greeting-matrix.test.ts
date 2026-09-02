import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { CustomerSlate, ExtractedEntities, ConversationState } from '../../src/slot-engine/types';
import { TEMPLATES } from '../../src/config/persona';

describe('Lead Greeting Opener Regex & Decision Matrix Suite', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'test-cust',
    tenantId: 'default-tenant',
    phone: '6285608026036',
    isLocationConfirmed: false,
    kelurahan: null,
    kecamatan: null,
    kota: null,
    lat: null,
    lng: null,
    distanceKm: null,
    ongkirNormal: null,
    ongkirPromo: null,
    isOutOfCoverage: false,
    childAgeMonths: null,
    childAgeCategory: null,
    symptoms: [],
    medicalConcerns: [],
    selectedTreatmentName: null,
    preferredDate: null,
    preferredTime: null,
    missingSlots: ['LOCATION'],
    pricelistSent: false,
    reservationFormSent: false,
    projectedState: 'INITIAL' as any,
    isHumanHandling: false,
    humanHandlingReason: null,
    lastInteractionAt: new Date(),
    streetDetail: null,
    ongkirFee: null,
    ongkirPromoFee: null,
    conversationId: 'conv-test',
  };

  const emptyExtraction: ExtractedEntities = {
    intents: [],
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

  const testGreetings = [
    'Pagi kak',
    'pagi kak',
    'Pagi ka',
    'Pagi kakk',
    'pagi mba',
    'pagi mbak',
    'pagi bu',
    'pagi bu bidan',
    'pagi bidan',
    'pagi bunda',
    'pagi bun',
    'Pagi min',
    'pagi admin',
    'selamat pagi kak',
    'Selamat pagi ka',
    'slmt pagi kak',
    'met pagi kak',
    'selamat pagi bu bidan',
    'Siang kak',
    'siang mba',
    'siang bu',
    'selamat siang kak',
    'Sore kak',
    'sore mba',
    'sore bu',
    'selamat sore kak',
    'Malam kak',
    'malam bu',
    'selamat malam kak',
    'Halo',
    'halo kak',
    'halo ka',
    'halo mba',
    'halo mbak',
    'halo bu',
    'halo bu bidan',
    'halo bunda',
    'halo bund',
    'halo sis',
    'Hai kak',
    'hi kak',
    'hey kak',
    'hei kak',
    'assalamualaikum kak',
    'assalamu\'alaikum bu bidan',
    'assalamualaikum bunda',
    'permisi kak',
    'permisi bu',
    'permisi mau tanya kak',
    'permisi min',
    'p',
    'P',
    'ping',
    'tes',
    'test',
    'mau tanya kak',
    'mau tanya dong',
    'mau tanya min',
    'tanya kak',
    'info kak',
    'info dong',
    'info lengkap kak',
    'tertarik kak',
    'bisa booking kak?',
    'bisa reservasi kak?',
    'bisa homecare kak?',
    'Promo[hk] Halo Bu Bidan, saya tertarik dengan layanan home-treatment',
  ];

  for (const text of testGreetings) {
    it(`should cleanly match greeting for input: "${text}"`, async () => {
      const decision = await DecisionMatrix.evaluate(baseSlate, emptyExtraction, {
        tenantId: 'default-tenant',
        incomingText: text,
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.deterministicTemplateReply).toBeTruthy();
      expect(decision.deterministicTemplateReply).toContain('Perkenalkan, saya Bidan Yusi');
      expect(decision.deterministicTemplateReply).not.toContain('Pijat Bayi Ceria');
    });
  }

  it('should NOT trigger lead greeting if customer asks price / ongkir directly', async () => {
    const pricingExtraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_price'],
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, pricingExtraction, {
      tenantId: 'default-tenant',
      incomingText: 'Pagi kak mau tanya ongkir ke waru berapa ya?',
      history: [],
    });

    // Should NOT be lead greeting, but go to price/location resolution
    expect(decision.reason).not.toContain('Sapaan pembuka lead pertama');
  });

  it('should NOT trigger lead greeting if customer already selected treatment', async () => {
    const treatmentExtraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['select_treatment'],
      treatmentReferenced: 'Pijat Kids Ceria',
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, treatmentExtraction, {
      tenantId: 'default-tenant',
      incomingText: 'Pagi kak, mau pijat kids ceria',
      history: [],
    });

    expect(decision.reason).not.toContain('Sapaan pembuka lead pertama');
  });
});

import { describe, it, expect } from 'vitest';
import { FewShotExemplarBank, DEFAULT_FEW_SHOT_EXEMPLARS } from '../../src/slot-engine/few-shot-exemplars';
import { ExtractedEntities, CustomerSlate } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('FewShotExemplarBank (Positive Exemplar Selection)', () => {
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

  it('should select schedule anti-affirmation exemplar when customer asks about day/date', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_schedule'],
      preferredDateText: 'Sabtu',
    };

    const exemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Hari sabtu bisa kak?');
    expect(exemplars.length).toBeGreaterThan(0);
    expect(exemplars.some((e) => e.id === 'schedule_inquiry_anti_affirmation')).toBe(true);

    const promptText = FewShotExemplarBank.formatExemplarsForPrompt(exemplars);
    expect(promptText).toContain('CONTOH PERCAKAPAN IDEAL BIDAN YUSI');
    expect(promptText).toContain('Untuk ketersediaan jadwal di hari Sabtu');
  });

  it('should select symptom flu exemplar when customer asks about cough/flu', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['consult_symptom'],
      symptoms: ['batuk', 'pilek', 'grok-grok'],
    };

    const exemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Anak saya batuk pilek grok grok');
    expect(exemplars.length).toBeGreaterThan(0);
    expect(exemplars.some((e) => e.id === 'symptom_flu_consultation')).toBe(true);

    const promptText = FewShotExemplarBank.formatExemplarsForPrompt(exemplars);
    expect(promptText).toContain('*Pijat Bayi Pulih Ceria*');
  });

  it('should select price inquiry exemplar when customer asks about cost', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_price'],
    };

    const exemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Berapa tarif pijat flu ya?');
    expect(exemplars.length).toBeGreaterThan(0);
    expect(exemplars.some((e) => e.id === 'price_inquiry')).toBe(true);
  });

  it('should select payment method exemplar when customer asks about QRIS/transfer', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['chitchat'],
    };

    const exemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Bisa bayar pakai QRIS gak?');
    expect(exemplars.length).toBeGreaterThan(0);
    expect(exemplars.some((e) => e.id === 'payment_method_inquiry')).toBe(true);
  });

  it('should select maternal lactation exemplar when customer asks about oxytocin/breastfeeding', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['chitchat'],
    };

    const exemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Pijat laktasi dan oksitosin itu untuk ibu ya?');
    expect(exemplars.length).toBeGreaterThan(0);
    expect(exemplars.some((e) => e.id === 'maternal_lactation_inquiry')).toBe(true);
  });

  it('should NOT match tag as sub-word (flu inside fluktuasi)', () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['chitchat'],
      symptoms: [],
    };

    // "fluktuasi" mengandung substring "flu" — word-boundary matching harus menolak.
    const exemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Harga treatmentnya fluktuasi terus ya bun?');
    expect(exemplars.some((e) => e.id === 'symptom_flu_consultation')).toBe(false);

    // "influence" mengandung substring "flu" — juga harus ditolak.
    const exemplars2 = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Does the price influence the schedule?');
    expect(exemplars2.some((e) => e.id === 'symptom_flu_consultation')).toBe(false);
  });

  it('should prioritize a CUSTOM exemplar (non-default id) by its intent tags', () => {
    const custom: (typeof DEFAULT_FEW_SHOT_EXEMPLARS)[0] = {
      id: 'custom_diskon_promo_001',
      tenantId: 'default-tenant',
      scenario: 'Customer menanyakan promo diskon bundling',
      tags: ['diskon', 'promo', 'potongan'],
      customerMessage: 'Ada diskon buat ambil 2 paket gak?',
      idealResponse: 'Tentu ada Bunda, untuk pembelian 2 paket kami berikan potongan spesial 😊',
      isActive: true,
      sortOrder: 99,
    };

    // Seed cache modul dengan exemplar kustom admin (id NON-bawaan).
    FewShotExemplarBank.__setCacheForTest?.('default-tenant', [custom]);

    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['diskon'],
      symptoms: [],
    };
    const exemplars = FewShotExemplarBank.selectRelevantExemplars(extraction, baseSlate, 'Ada diskon khusus promo gak?');
    expect(exemplars.some((e) => e.id === 'custom_diskon_promo_001')).toBe(true);

    // Bersihkan seed agar tidak mencemari test lain.
    FewShotExemplarBank.__clearCacheForTest?.('default-tenant');
  });
});

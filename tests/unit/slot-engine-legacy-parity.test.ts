import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../src/config/persona';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';

describe('Slot Engine Legacy Parity & Conversational SOP Hardening', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'cust_123',
    phone: '628123456789',
    name: null,
    tenantId: 'default-tenant',
    conversationId: 'conv_123',
    isLocationConfirmed: false,
    kelurahan: null,
    kecamatan: null,
    kota: null,
    lat: null,
    lng: null,
    streetDetail: null,
    distanceKm: null,
    ongkirFee: null,
    ongkirPromoFee: null,
    isOutOfCoverage: false,
    childAgeMonths: null,
    childAgeCategory: null,
    symptoms: [],
    medicalConcerns: [],
    selectedTreatmentName: null,
    preferredDate: null,
    preferredTime: null,
    reservationFormSent: false,
    pricelistSent: false,
    isHumanHandling: false,
    humanHandlingReason: null,
    lastInteractionAt: new Date(),
    projectedState: 'INITIAL' as any,
  };

  const emptyExtraction: ExtractedEntities = {
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
    intents: [],
  };

  it('1. TEMPLATES.ongkirInfo must format distance, normal vs promo price, and ask treatment choice', () => {
    const text = TEMPLATES.ongkirInfo({
      distanceKm: 9.17,
      normalPrice: 15000,
      promoPrice: 10000,
    });

    expect(text).toContain('Jika dilihat dari jaraknya kurang lebih 9.2 km');
    expect(text).toContain('ada tambahan ongkir Rp 15.000');
    expect(text).toContain('ongkir menjadi Rp 10.000 saja bunda');
    expect(text).toContain('Jadi bisa ya bunda ☺️');
    expect(text).toContain('Rencana mau treatment apa bunda ?🤗');
  });

  it('2. Pure Location Message must trigger deterministic TEMPLATES.ongkirInfo and send pricelist image', async () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      locationText: 'Tambakoso Waru',
      intents: ['provide_location'],
    };

    const decision = await DecisionMatrix.evaluate(
      baseSlate,
      extraction,
      { incomingText: 'Saya di Tambakoso Waru' }
    );

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.shouldSendPricelistImage).toBe(true);
    expect(decision.deterministicTemplateReply).toContain('ongkir menjadi Rp');
    expect(decision.deterministicTemplateReply).toContain('Rencana mau treatment apa bunda ?🤗');
  });

  it('3. Double Ongkir Guard: prevents repeating ongkir text when pin/text is resent within 45s', async () => {
    const confirmedSlate: CustomerSlate = {
      ...baseSlate,
      isLocationConfirmed: true,
      kelurahan: 'Tambakoso',
      distanceKm: 9.17,
      ongkirFee: 15000,
      ongkirPromoFee: 10000,
      pricelistSent: true,
    };

    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      locationText: 'Tambakoso Waru',
      intents: ['provide_location'],
    };

    const recentHistory = [
      {
        role: 'assistant' as const,
        content: 'Jika dilihat dari jaraknya kurang lebih 9.2 km... ongkir menjadi Rp 10.000',
        createdAt: new Date(), // within 45s
      },
    ];

    const decision = await DecisionMatrix.evaluate(
      confirmedSlate,
      extraction,
      { incomingText: 'Tambakoso Waru', history: recentHistory }
    );

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.shouldSendPricelistImage).toBe(false);
    expect(decision.deterministicTemplateReply).toContain('lokasi di Tambakoso sudah kami simpan');
  });

  it('4. Tanya Suami / Need Time: gives warm response without pressuring for schedule or form', async () => {
    const decision = await DecisionMatrix.evaluate(
      baseSlate,
      emptyExtraction,
      { incomingText: 'Nanti saya diskusikan dengan suami dulu ya mbak' }
    );

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toContain('silakan didiskusikan dulu dengan suami yaa');
  });

  it('5. Tanya Asal Klinik: explains Homecare concept in Waru Sidoarjo', async () => {
    const decision = await DecisionMatrix.evaluate(
      baseSlate,
      emptyExtraction,
      { incomingText: 'Lokasi kliniknya di mana ya mbak?' }
    );

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toContain('Homebase kami ada di Waru, Sidoarjo');
    expect(decision.deterministicTemplateReply).toContain('layanan Homecare');
  });

  it('6. DynamicCloserService for TREATMENT: asks for treatment choice, not jumping to schedule', () => {
    const slateWithLocation: CustomerSlate = {
      ...baseSlate,
      isLocationConfirmed: true,
      kelurahan: 'Tambakoso',
      distanceKm: 9.17,
      ongkirPromoFee: 10000,
      childAgeMonths: 1,
      selectedTreatmentName: null,
    };

    const instruction = DynamicCloserService.getCloserInstruction(slateWithLocation);
    expect(instruction).toContain('PANDUAN KONSULTASI & PENUTUP (TANYA PILIHAN TREATMENT)');
    expect(instruction).toContain('mau ambil paket');
    expect(instruction).toContain('DILARANG langsung menanyakan hari/jadwal sebelum Bunda memilih treatment');
  });
});

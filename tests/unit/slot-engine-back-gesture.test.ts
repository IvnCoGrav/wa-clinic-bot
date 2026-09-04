import { describe, it, expect, vi, afterEach } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { SlateStore } from '../../src/slot-engine/slate-store';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

describe('Back Gesture, Change-of-Mind & State Regression (Non-Regex)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseSlate: CustomerSlate = {
    customerId: 'cust_back_1',
    phone: '6281234567890',
    name: 'Bunda Back',
    tenantId: 'default-tenant',
    conversationId: 'conv_back_1',
    kelurahan: 'Wonokromo',
    kecamatan: 'Wonokromo',
    kota: 'Kota Surabaya',
    lat: -7.29,
    lng: 112.74,
    streetDetail: null,
    distanceKm: 5.0,
    ongkirFee: 0,
    ongkirPromoFee: 0,
    isLocationConfirmed: true,
    isOutOfCoverage: false,
    childAgeMonths: 3,
    childAgeCategory: 'BABY',
    symptoms: [],
    medicalConcerns: [],
    selectedTreatmentName: 'Pijat Bayi Ceria',
    preferredDate: 'Minggu',
    preferredTime: null,
    pricelistSent: true,
    reservationFormSent: false,
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

  it('1. Ganti lokasi implisit TANPA kata kerja ("Klo yg di jojoran baru berapa ongkirnya?") → resolve lokasi baru', async () => {
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({
      isPrecise: true,
      kelurahan: 'Jojoran Baru',
      kecamatan: 'Sukolilo',
      kota: 'Kota Surabaya',
      lat: -7.285,
      lng: 112.795,
    } as any);

    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_price'],
      locationText: 'Jojoran Baru',
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'Klo yg di jojoran baru berapa ongkirnya?',
      tenantId: 'default-tenant',
    });

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.updatedSlate.kelurahan).toBe('Jojoran Baru');
    expect(decision.updatedSlate.isLocationConfirmed).toBe(true);
  });

  it('2. Batal treatment ("gak jadi pijat bayi dulu, mau tanya-tanya") → selectedTreatmentName null, batal handoff', async () => {
    const slate: CustomerSlate = { ...baseSlate };
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['chitchat'],
      clearedSlots: ['treatment'],
    };

    const updated = SlateStore.updateSlateWithExtraction(slate, extraction);
    expect(updated.selectedTreatmentName).toBeNull();
    expect(updated.preferredDate).toBe('Minggu'); // slot lain tidak ikut terhapus
    expect(updated.projectedState).not.toBe(ConversationState.HUMAN_HANDLING);

    const decision = await DecisionMatrix.evaluate(updated, extraction, {
      incomingText: 'Mbak gak jadi pijat bayi dulu deh mau tanya-tanya dulu',
      tenantId: 'default-tenant',
    });
    expect(decision.action).not.toBe('ESCALATE_HUMAN_SCHEDULE');
    expect(decision.updatedSlate.isHumanHandling).toBe(false);
  });

  it('3. Tunda hari ("Jangan hari Minggu dulu ya mbak") → preferredDate/Time null', () => {
    const slate: CustomerSlate = { ...baseSlate };
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      clearedSlots: ['preferred_date'],
    };

    const updated = SlateStore.updateSlateWithExtraction(slate, extraction);
    expect(updated.preferredDate).toBeNull();
    expect(updated.preferredTime).toBeNull();
    expect(updated.selectedTreatmentName).toBe('Pijat Bayi Ceria'); // treatment tetap
  });

  it('4. Regresi ke tanya fasilitas ("bawa matras sendiri gak ya?") → dijawab dulu, TANPA handoff', async () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['chitchat'],
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'Bidan yang datang bawa matras sendiri gak ya?',
      tenantId: 'default-tenant',
    });

    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
    expect(decision.updatedSlate.isHumanHandling).toBe(false);
  });
});

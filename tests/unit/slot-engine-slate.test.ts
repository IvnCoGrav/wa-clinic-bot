import { describe, it, expect, vi } from 'vitest';
import { SlateStore } from '../../src/slot-engine/slate-store';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Customer Entity Slate & State Projection Model (Part 2)', () => {
  const mockContext: any = {
    customer: {
      id: 'cust_123',
      phone: '6288235780925',
      name: 'Bunda Melati',
      tenant_id: 'tenant_default',
      kelurahan: 'Pradah Kalikendal',
      kecamatan: 'Dukuh Pakis',
      kota: 'Kota Surabaya',
      lat: -7.281,
      lng: 112.684,
      pricelist_sent: true,
      preferences: {
        childAgeMonths: 2,
        symptoms: ['grok-grok'],
        distanceKm: 16.99,
        ongkirFee: 25000,
        ongkirPromoFee: 20000,
      },
    },
    conversation: {
      id: 'conv_123',
      current_state: ConversationState.AWAITING_INTEREST,
      is_human_handling: false,
      last_discussed_treatment: null,
      last_message_at: new Date(),
    },
    incomingMessage: {
      id: 'msg_123',
      from: '6288235780925',
      type: 'text',
      text: { body: 'Darmo permai selatan gang 17' },
    },
    tenantId: 'tenant_default',
  };

  it('should hydrate CustomerSlate accurately from context & database snapshot', () => {
    const slate = SlateStore.hydrateSlate(mockContext);

    expect(slate.customerId).toBe('cust_123');
    expect(slate.phone).toBe('6288235780925');
    expect(slate.name).toBe('Bunda Melati');
    expect(slate.kelurahan).toBe('Pradah Kalikendal');
    expect(slate.isLocationConfirmed).toBe(true);
    expect(slate.childAgeMonths).toBe(2);
    expect(slate.childAgeCategory).toBe('BABY');
    expect(slate.symptoms).toContain('grok-grok');
    expect(slate.distanceKm).toBe(16.99);
    expect(slate.projectedState).toBe(ConversationState.AWAITING_INTEREST);
  });

  it('should update slate with street details without overwriting confirmed kelurahan', () => {
    const initialSlate = SlateStore.hydrateSlate(mockContext);
    const extraction: ExtractedEntities = {
      intents: ['supplement_address'],
      locationText: null,
      streetDetail: 'Darmo permai selatan gang 17',
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const updated = SlateStore.updateSlateWithExtraction(initialSlate, extraction);

    expect(updated.kelurahan).toBe('Pradah Kalikendal'); // Unchanged
    expect(updated.streetDetail).toBe('Darmo permai selatan gang 17');
    expect(updated.projectedState).toBe(ConversationState.AWAITING_INTEREST);
  });

  it('should correctly categorize child age and append new symptoms', () => {
    const emptySlate = SlateStore.hydrateSlate({
      ...mockContext,
      customer: { ...mockContext.customer, kelurahan: null, lat: null, lng: null, preferences: {} },
    });

    const extraction: ExtractedEntities = {
      intents: ['provide_age', 'consult_symptom'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: 36, // 3 years old
      symptoms: ['batuk', 'pilek'],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
    };

    const updated = SlateStore.updateSlateWithExtraction(emptySlate, extraction);

    expect(updated.childAgeMonths).toBe(36);
    expect(updated.childAgeCategory).toBe('KIDS');
    expect(updated.symptoms).toEqual(['batuk', 'pilek']);
  });

  it('should project RESERVATION_SENT when treatment and booking date are set', () => {
    const slate: CustomerSlate = {
      ...SlateStore.hydrateSlate(mockContext),
      selectedTreatmentName: 'Pijat Bayi Pulih Ceria',
      preferredDate: 'Besok Sabtu',
    };

    const projected = SlateStore.computeProjectedState(slate);
    expect(projected).toBe(ConversationState.RESERVATION_SENT);
  });

  it('should correctly identify missing critical slots in order of priority', () => {
    const unlocatedSlate: CustomerSlate = {
      ...SlateStore.hydrateSlate(mockContext),
      kelurahan: null,
      lat: null,
      lng: null,
      isLocationConfirmed: false,
      childAgeMonths: null,
      selectedTreatmentName: null,
      symptoms: [],
      preferredDate: null,
    };

    const missing = SlateStore.getMissingCriticalSlots(unlocatedSlate);
    expect(missing).toEqual(['LOCATION', 'AGE', 'TREATMENT_CHOICE', 'RESERVATION_DETAILS']);
  });

  it('should persist slate updates to prisma mock client', async () => {
    const mockPrisma: any = {
      customer: { update: vi.fn().mockResolvedValue({}) },
      conversation: { update: vi.fn().mockResolvedValue({}) },
    };

    const slate = SlateStore.hydrateSlate(mockContext);
    slate.streetDetail = 'Gang Melati No 5';

    await SlateStore.persistSlate(slate, mockPrisma);

    expect(mockPrisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust_123' },
        data: expect.objectContaining({
          preferences: expect.objectContaining({ streetDetail: 'Gang Melati No 5' }),
        }),
      })
    );

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv_123' },
        data: expect.objectContaining({ current_state: ConversationState.AWAITING_INTEREST }),
      })
    );
  });

  it('should dynamically reconcile incompatible treatment when age switches from KIDS (6yo) to BABY (16 months)', () => {
    // Initial slate from discussing 6yo (Kids Ceria)
    const initialSlate: CustomerSlate = {
      ...SlateStore.hydrateSlate(mockContext),
      childAgeMonths: 72,
      childAgeCategory: 'KIDS',
      selectedTreatmentName: 'Pijat Kids Ceria',
    };

    // Customer asks: "Kalau umur 16 bulan bu juga sama 45 menit?" -> Extractor extracts age 16 months without new treatment
    const extraction: ExtractedEntities = {
      intents: ['provide_age', 'ask_duration'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: 16,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const updated = SlateStore.updateSlateWithExtraction(initialSlate, extraction);

    expect(updated.childAgeMonths).toBe(16);
    expect(updated.childAgeCategory).toBe('BABY');
    // Pijat Kids Ceria (for >2yo) MUST be reconciled to Baby category treatment, NOT retained (dynamic catalog)
    expect(updated.selectedTreatmentName).toContain('Pijat Bayi Ceria');
    expect(updated.selectedTreatmentName).not.toContain('Kids');
  });
});


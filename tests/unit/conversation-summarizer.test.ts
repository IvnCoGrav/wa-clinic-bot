import { describe, it, expect } from 'vitest';
import { ConversationStateSummarizer } from '../../src/slot-engine/conversation-summarizer';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('ConversationStateSummarizer (0-Token Context Distillation)', () => {
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

  it('Turn 1: should generate minimal summary for brand new conversation', () => {
    const summary = ConversationStateSummarizer.summarize(baseSlate, emptyExtraction, {
      history: [],
      customerInput: 'Halo',
    });

    expect(summary).toContain('[RINGKASAN KONTEKS PERCAKAPAN SAAT INI]');
    expect(summary).toContain('Percakapan baru dimulai (Turn awal)');
    expect(summary).toContain('Bunda mengajukan pertanyaan seputar layanan');
  });

  it('Turn 2: should track confirmed location, ongkir, and prohibit ongkir repetition', () => {
    const slateWithLocation: CustomerSlate = {
      ...baseSlate,
      kelurahan: 'Sidotopo Wetan',
      distanceKm: 22.6,
      ongkirPromoFee: 25000,
      ongkirFee: 35000,
      isLocationConfirmed: true,
    };

    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['consult_symptom'],
      symptoms: ['batuk', 'pilek'],
    };

    const summary = ConversationStateSummarizer.summarize(slateWithLocation, extraction, {
      history: [
        { role: 'user', content: 'Platuk tauladan sidotopo wetan' },
        { role: 'assistant', content: 'Ongkirnya 25rb ya Bunda' },
      ],
      customerInput: 'Kalau mau pijat batuk pilek bisa?',
    });

    expect(summary).toContain('Ongkir Rp 25.000 promo (Sidotopo Wetan, ~22.6 km)');
    expect(summary).toContain('🚫 Info ongkir atau perhitungan jarak');
    expect(summary).toContain('batuk, pilek');
    expect(summary).toContain('Pijat Bayi Pulih Ceria');
  });

  it('Turn 3: should track schedule inquiry and prohibit asking "di hari apa" again', () => {
    const slateWithTreatment: CustomerSlate = {
      ...baseSlate,
      kelurahan: 'Sidotopo Wetan',
      distanceKm: 22.6,
      ongkirPromoFee: 25000,
      isLocationConfirmed: true,
      selectedTreatmentName: 'Pijat Bayi Pulih Ceria',
      symptoms: ['batuk', 'pilek'],
    };

    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_schedule'],
      preferredDateText: 'Sabtu',
    };

    const summary = ConversationStateSummarizer.summarize(slateWithTreatment, extraction, {
      history: [
        { role: 'user', content: 'Platuk tauladan sidotopo wetan' },
        { role: 'assistant', content: 'Ongkirnya 25rb ya Bunda' },
        { role: 'user', content: 'Kalau mau pijat batuk pilek bisa?' },
        { role: 'assistant', content: 'Untuk batuk pilek kami sarankan Pulih Ceria' },
      ],
      customerInput: 'Sabtu bisa kak?',
    });

    expect(summary).toContain('Treatment yang dipilih/ditanyakan: *Pijat Bayi Pulih Ceria*');
    expect(summary).toContain('🚫 Menanyakan ulang "rencana mau treatment apa"');
    expect(summary).toContain('🚫 Menanyakan "mau treatment di hari apa" karena Bunda sudah menyebutkan Sabtu');
    expect(summary).toContain('ketersediaan jadwal Bidan yang bertugas akan dibantu cekkan terlebih dahulu');
  });

  it('Turn 4: should track sent reservation form and prohibit resending full form', () => {
    const slateWithForm: CustomerSlate = {
      ...baseSlate,
      kelurahan: 'Sidotopo Wetan',
      isLocationConfirmed: true,
      selectedTreatmentName: 'Pijat Bayi Pulih Ceria',
      reservationFormSent: true,
    };

    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_price'],
    };

    const summary = ConversationStateSummarizer.summarize(slateWithForm, extraction, {
      history: [
        { role: 'user', content: 'Sabtu bisa?' },
        { role: 'assistant', content: 'Berikut format reservasinya ya Bunda...' },
      ],
      customerInput: 'Ini total harganya berapa ya?',
    });

    expect(summary).toContain('Format formulir reservasi sudah pernah dikirimkan');
    expect(summary).toContain('🚫 Mengirim ulang teks formulir reservasi panjang');
  });
});

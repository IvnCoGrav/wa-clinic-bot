import { describe, it, expect, vi } from 'vitest';
import { CustomerSlate } from '../../src/slot-engine/types';
import { GroundingComposer } from '../../src/slot-engine/grounding-composer';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { ResponseValidator } from '../../src/slot-engine/response-validator';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';

describe('Multi-Turn Symptom & Ongkir Guard E2E', () => {
  it('Turn 6 ("12 bulan bubid") after symptoms and confirmed ongkir should keep Pulih Ceria and avoid repeating ongkir', async () => {
    const slate: CustomerSlate = {
      customerId: 'cust-123',
      phone: '6289999766269',
      name: null,
      tenantId: 'default-tenant',
      conversationId: 'conv-123',
      kelurahan: 'Wonorejo',
      kecamatan: 'Tegalsari',
      kota: 'Kota Surabaya',
      lat: -7.271,
      lng: 112.731,
      streetDetail: 'wonorejo II no 25',
      distanceKm: 16.02,
      ongkirFee: 25000,
      ongkirPromoFee: 20000,
      isLocationConfirmed: true,
      isOutOfCoverage: false,
      childAgeMonths: 12,
      childAgeCategory: 'BABY',
      symptoms: ['susah tidur', 'gampang rewel', 'kebangun nangis'],
      medicalConcerns: [],
      selectedTreatmentName: null,
      preferredDate: null,
      preferredTime: null,
      pricelistSent: true,
      reservationFormSent: false,
      isHumanHandling: false,
      humanHandlingReason: null,
      lastInteractionAt: new Date(),
      projectedState: 'AWAITING_INTEREST' as any,
    };

    const history = [
      { role: 'user' as const, content: 'Alamatnya sby mana ya bubid?' },
      { role: 'assistant' as const, content: 'Homebase kami ada di Waru, Sidoarjo Bunda 😊...' },
      { role: 'user' as const, content: 'Kalo homecare ke wonorejo II np 25 tegalsari surabaya ada biaya ongkir ga ya?' },
      { role: 'assistant' as const, content: 'Tentu saja, Bunda. Jika dilihat dari jaraknya kurang lebih 16.02 km, dari pricelist kami ada tambahan ongkir Rp 25.000. Tetapi karena bulan ini ada promo, kami bisa kasih Bunda ongkir menjadi Rp 20.000 saja. Jadi bisa ya Bunda ☺️ Rencana mau treatment apa Bunda? 😊' },
      { role: 'user' as const, content: 'Durasi pijat bayi brp menit bu?' },
      { role: 'assistant' as const, content: 'Untuk treatment pijat bayi, durasinya berkisar sekitar 40 menit, Bunda. Waktu ini sudah termasuk persiapan dan pemulihan si kecil setelah pijat. Mau ambil paket *Pijat Bayi Ceria* untuk si kecil, atau mungkin ada keluhan lain yang ingin kami bantu? 😊' },
      { role: 'user' as const, content: 'Anakku susah tidur dan gampang rewel kalau malam bun, bagusnya treatment yg apa ya?' },
      { role: 'assistant' as const, content: 'Tentu bisa Bunda, untuk keluhan susah tidur dan rewel, kami rekomendasikan paket *Pijat Bayi Pulih Ceria*. Treatment ini dirancang khusus untuk membantu meredakan ketidaknyamanan si kecil dan memberikan relaksasi yang lebih baik. Kalau boleh tahu, berapa usia si kecil saat ini ya Bunda agar rekomendasinya tepat? 😊' },
      { role: 'user' as const, content: 'Oya kak ini anakku tidurnya gampang rewel , ga siang ,malam, bentar2 kebangun nangis.. tidur ga bisa pules samsek. Maunya d gendongg baru diem..🥹' },
      { role: 'assistant' as const, content: 'Tentu Bunda, kami paham betul kondisi si kecil yang rewel dan sulit tidur. Paket *Pijat Bayi Pulih Ceria* sangat tepat untuk membantu meredakan ketidaknyamanan yang dialami si kecil dan memberikan rasa rileks agar tidurnya lebih nyaman. Kalau boleh tahu, berapa usia si kecil saat ini ya Bunda agar kami bisa lebih tepat dalam memberikan rekomendasi? 😊' },
    ];

    // 1. Test GroundingComposer output
    const extraction = {
      intents: [] as any,
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0,
    };

    const grounding = await GroundingComposer.compose(slate, extraction, {
      customerInput: '12 bulan bubid',
      tenantId: 'default-tenant',
    });

    expect(grounding.customerPreferencesText).toContain('Pijat Bayi Pulih Ceria');
    expect(grounding.customerPreferencesText).toContain('DILARANG MEREKOMENDASIKAN PIJAT BIASA');
    expect(grounding.filteredCatalog[0].name).toContain('Pijat Bayi Pulih Ceria');

    // 2. Test Dynamic Closer output
    const closer = DynamicCloserService.getCloserInstruction(
      slate,
      grounding.suggestedPreFilledForm,
      history,
      '12 bulan bubid'
    );

    expect(closer).toContain('Pijat Bayi Pulih Ceria');
    expect(closer).toContain('DILARANG MENYEBUTKAN/MENGULANG ONGKIR KARENA SUDAH DIJELASKAN');

    // 3. Test ResponseValidator cleans duplicate ongkir
    const mockDuplicatedReply = `Tentu bisa Bunda, bayi usia 12 bulan dengan keluhan susah tidur sangat tepat diberikan paket *Pijat Bayi Pulih Ceria*.

Jika dilihat dari jaraknya kurang lebih 16.02 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp 25.000 tetapi karena bulan ini ada promo, kami bisa kasih Bunda ongkir menjadi Rp 20.000 saja. Jadi bisa ya Bunda ☺️

Untuk paket *Pijat Bayi Pulih Ceria*, rencana mau kami bantu jadwalkan untuk hari apa Bunda? 😊`;

    const validated = ResponseValidator.validate(mockDuplicatedReply, slate, { isOngkirAlreadySent: true });
    expect(validated.sanitizedReply).not.toContain('Jika dilihat dari jaraknya kurang lebih 16.02 km');
    expect(validated.sanitizedReply).toContain('Pijat Bayi Pulih Ceria');
    expect(validated.sanitizedReply).toContain('jadwalkan untuk hari apa Bunda?');
  });

  it('Turn 3 ("Kalau mau pijat batuk pilek bisa ?") immediately after ongkir calculation should NOT trigger duplicate location guard', async () => {
    const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');

    const confirmedSlate: CustomerSlate = {
      customerId: 'cust-platuk',
      phone: '6288888888',
      name: null,
      tenantId: 'default-tenant',
      kelurahan: 'Sidotopo Wetan',
      kecamatan: 'Kenjeran',
      kota: 'Kota Surabaya',
      lat: -7.228,
      lng: 112.775,
      streetDetail: 'Platuk tauladan 19a',
      distanceKm: 22.6,
      ongkirFee: 35000,
      ongkirPromoFee: 25000,
      isLocationConfirmed: true,
      isOutOfCoverage: false,
      childAgeMonths: null,
      childAgeCategory: null,
      symptoms: [],
      medicalConcerns: [],
      selectedTreatmentName: null,
      preferredDate: null,
      preferredTime: null,
      pricelistSent: true,
      reservationFormSent: false,
      isHumanHandling: false,
      humanHandlingReason: null,
      lastInteractionAt: new Date(),
      conversationState: 'COLLECTING_SLOTS' as any,
    };

    const history = [
      { role: 'user' as const, content: 'Platuk tauladan 19a , sidotopo wetan , kenjeran' },
      {
        role: 'assistant' as const,
        content:
          'Jika dilihat dari jaraknya kurang lebih 22.6 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp 35.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp 25.000 saja bunda. Jadi bisa ya bunda ☺️\n\nRencana mau treatment apa bunda ?🤗',
      },
    ];

    const extraction = {
      intents: ['select_treatment', 'consult_symptom'],
      locationText: 'Sidotopo Wetan, Kenjeran',
      streetDetail: 'Platuk tauladan 19a',
      childAgeMonths: null,
      symptoms: ['batuk', 'pilek'],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const decision = await DecisionMatrix.evaluate(confirmedSlate, extraction, {
      incomingText: 'Kalau mau pijat batuk pilek bisa ?',
      history,
    });

    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
    expect(decision.deterministicTemplateReply).toBeUndefined();
  });
});

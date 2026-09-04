import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processSlotEngine } from '../../src/slot-engine/slot-engine';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Slot Engine Form & Schedule Integration Tests', () => {
  const baseCustomer = {
    id: 'cust_yosefin_123',
    phone: '6282167281657',
    name: 'Bunda Yosefin',
    tenant_id: 'default-tenant',
    kelurahan: 'Tambakoso',
    kecamatan: 'Waru',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.362,
    lng: 112.784,
    share_location_sent: false,
    pricelist_sent: true,
    status: 'active',
  };

  const baseConversation = {
    id: 'conv_yosefin_123',
    customer_id: 'cust_yosefin_123',
    tenant_id: 'default-tenant',
    current_state: ConversationState.AWAITING_INTEREST,
    is_human_handling: false,
    last_discussed_treatment: 'Pijat Bayi Ceria',
    last_message_at: new Date(),
  };

  it('1. Form Reservasi Valid: Harusnya parse, simpan reservasi, update kontak, eskalasi ke HUMAN_HANDLING dan balas konfirmasi', async () => {
    const rawFormText = `Berikut list untuk reservasi :

Hari dan tanggal : jumat 28 Juli
Nama Bunda: Yosefin
Alamat & Shareloc : alana, Tambakoso
Kec : Waru
Kota : Kabupaten Sidoarjo
No. Hp : 6282167281657

Pilihan treatment (bayi & Kids)

Nama Bayi : Annabeth
Usia Bayi/Anak : 1 bulan
Treatment : pijat bayi ceria 

Pilihan treatment (Moms) :bundling pijat laktasi dan oksitosin

Usia Kehamilan (Jika hamil):
Treatment : -`;

    const ctx = {
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: {
        id: 'msg_form_001',
        chatId: '6282167281657@c.us',
        from: '6282167281657',
        text: { body: rawFormText },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history: [],
    };

    const result = await processSlotEngine(ctx as any);

    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(result.isHumanHandling).toBe(true);
    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('data reservasi sudah kami terima');
    expect(result.replyText).toContain('share location (pin)'); // Minta shareloc pin jika belum pernah kirim
  });

  it('2. Form Reservasi Kurang Lengkap: Harusnya minta customer melengkapi tanpa crash', async () => {
    const incompleteFormText = `Berikut list untuk reservasi :

Hari dan tanggal : 
Nama Bunda:
Alamat & Shareloc : 
Kec : 
Kota : 
No. Hp : 

Pilihan treatment (bayi & Kids)

Nama Bayi : 
Usia Bayi/Anak : 
Treatment : `;

    const ctx = {
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: {
        id: 'msg_form_002',
        chatId: '6282167281657@c.us',
        from: '6282167281657',
        text: { body: incompleteFormText },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history: [],
    };

    const result = await processSlotEngine(ctx as any);

    expect(result.nextState).toBe(ConversationState.RESERVATION_SENT);
    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('mohon diisi bagian');
  });

  it('3. Anti-Loop Ongkir: DecisionMatrix tidak boleh re-trigger template ongkir jika lokasi sudah confirmed dan pesan bertanya treatment/usia', async () => {
    const slateWithLocationConfirmed: CustomerSlate = {
      customerId: 'cust_yosefin_123',
      phone: '6282167281657',
      name: 'Bunda Yosefin',
      tenantId: 'default-tenant',
      conversationId: 'conv_yosefin_123',
      kelurahan: 'Tambakoso',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
      lat: -7.362,
      lng: 112.784,
      streetDetail: null,
      distanceKm: 9.2,
      ongkirFee: 15000,
      ongkirPromoFee: 10000,
      isLocationConfirmed: true,
      isOutOfCoverage: false,
      childAgeMonths: 1,
      childAgeCategory: 'BABY',
      symptoms: [],
      medicalConcerns: [],
      selectedTreatmentName: null,
      preferredDate: null,
      preferredTime: null,
      pricelistSent: true,
      isHumanHandling: false,
      humanHandlingReason: null,
      lastInteractionAt: new Date(),
      projectedState: ConversationState.AWAITING_INTEREST,
    };

    // Ekstraksi yang keliru membawa locationText dari riwayat masa lalu
    const extractionWithStaleLocation: ExtractedEntities = {
      intents: ['consult_symptom', 'provide_age'],
      locationText: 'alana tambak oso waru', // stale dari history
      streetDetail: null,
      childAgeMonths: 1,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
    };

    const decision = await DecisionMatrix.evaluate(
      slateWithLocationConfirmed,
      extractionWithStaleLocation,
      { incomingText: 'Hm biasa untuk bayi 1 bulan apa ya', tenantId: 'default-tenant' }
    );

    // Harusnya diteruskan ke AI FAQ response generation, BUKAN RESOLVE_LOCATION_AND_DELIVERY (ongkir template)
    expect(decision.action).toBe('GENERATE_AI_RESPONSE');
  });

  it('4. Pergantian Lokasi Eksplisit: DecisionMatrix harus re-resolve jika ada kata ganti/pindah', async () => {
    const slateWithLocationConfirmed: CustomerSlate = {
      customerId: 'cust_yosefin_123',
      phone: '6282167281657',
      name: 'Bunda Yosefin',
      tenantId: 'default-tenant',
      conversationId: 'conv_yosefin_123',
      kelurahan: 'Tambakoso',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
      lat: -7.362,
      lng: 112.784,
      streetDetail: null,
      distanceKm: 9.2,
      ongkirFee: 15000,
      ongkirPromoFee: 10000,
      isLocationConfirmed: true,
      isOutOfCoverage: false,
      childAgeMonths: 1,
      childAgeCategory: 'BABY',
      symptoms: [],
      medicalConcerns: [],
      selectedTreatmentName: null,
      preferredDate: null,
      preferredTime: null,
      pricelistSent: true,
      isHumanHandling: false,
      humanHandlingReason: null,
      lastInteractionAt: new Date(),
      projectedState: ConversationState.AWAITING_INTEREST,
    };

    const extractionWithNewLocation: ExtractedEntities = {
      intents: ['provide_location'],
      locationText: 'Rungkut Menanggal Surabaya',
      streetDetail: null,
      childAgeMonths: 1,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
    };

    const decision = await DecisionMatrix.evaluate(
      slateWithLocationConfirmed,
      extractionWithNewLocation,
      { incomingText: 'Maaf mau ganti alamat di Rungkut Menanggal Surabaya', tenantId: 'default-tenant' }
    );

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
  });

  it('6. Booking-ready ala Bidan Yusi (lokasi + treatment + hari Minggu) → handoff Admin + balasan cek-jadwal singkat', async () => {
    const readySlate: CustomerSlate = {
      customerId: 'cust_jojoran_1',
      phone: '6281234567890',
      name: 'Bunda Jojoran',
      tenantId: 'default-tenant',
      conversationId: 'conv_jojoran_1',
      kelurahan: 'Jojoran Baru',
      kecamatan: 'Sukolilo',
      kota: 'Kota Surabaya',
      lat: -7.28,
      lng: 112.79,
      streetDetail: null,
      distanceKm: 6.8,
      ongkirFee: 15000,
      ongkirPromoFee: 15000,
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
      isHumanHandling: false,
      humanHandlingReason: null,
      lastInteractionAt: new Date(),
      projectedState: ConversationState.AWAITING_TREATMENT,
    };

    const extraction: ExtractedEntities = {
      intents: ['select_treatment', 'ask_schedule'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: 'baby massage saja',
      preferredDateText: 'Minggu',
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
    };

    const decision = await DecisionMatrix.evaluate(readySlate, extraction, {
      incomingText: 'baby massage saja, Hari minggu apa bisa ?',
      tenantId: 'default-tenant',
    });

    expect(decision.action).toBe('ESCALATE_HUMAN_SCHEDULE');
    expect(decision.deterministicTemplateReply).toContain('kami cek jadwal dulu yaa bunda, ditunggu sebentar ya bund');
    expect(decision.deterministicTemplateReply).not.toContain('list untuk reservasi');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.updatedSlate.humanHandlingReason).toBe('booking_schedule_check');
    expect(decision.updatedSlate.projectedState).toBe(ConversationState.HUMAN_HANDLING);
  });

  it('5. Persona & Dynamic Closer Guard: Aturan penegasan jadwal tidak boleh halusinasi', () => {
    const personaRules = PersonaComposer.getPersonaRules();
    expect(personaRules).toContain('ATURAN PENJADWALAN & KETERSEDIAAN SLOT');
    expect(personaRules).toContain('DILARANG KERAS mengonfirmasi ketersediaan jadwal pasti secara sepihak');

    const closerInstruction = DynamicCloserService.getCloserInstruction({
      isLocationConfirmed: true,
      kelurahan: 'Tambakoso',
      selectedTreatmentName: 'Pijat Bayi Ceria',
      preferredDate: null,
    } as any);

    expect(closerInstruction).toContain('DILARANG mengonfirmasi bahwa slot/jam tersebut pasti tersedia');
  });
});

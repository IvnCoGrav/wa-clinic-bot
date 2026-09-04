import { describe, it, expect } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';

describe('Slot Engine - Human Handling & Escalation Flows Tests', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'c_test_escalations',
    phone: '6281234567890',
    tenantId: 'default-tenant',
    isLocationConfirmed: true,
    kelurahan: 'Semambung',
    kecamatan: 'Gedangan',
    kota: 'Sidoarjo',
    distanceKm: 16.1,
    ongkirFee: 25000,
    ongkirPromoFee: 20000,
    childAgeMonths: null,
    childAgeCategory: null,
    selectedTreatmentName: 'Pijat Bayi Ceria',
    medicalConcerns: [],
    symptoms: [],
    isOutOfCoverage: false,
    reservationFormSent: false,
    isHumanHandling: false,
    humanHandlingReason: null,
    lastInteractionAt: new Date().toISOString(),
    conversationState: 'COLLECTING_SLOTS',
  };

  const emptyExtraction: ExtractedEntities = {
    locationText: null,
    streetDetail: null,
    childAgeMonths: null,
    childAgeCategory: null,
    treatmentReferenced: null,
    symptoms: [],
    intents: [],
    preferredDateText: null,
    preferredTimeText: null,
    customerName: null,
    isMedicalEmergency: false,
    confidenceScore: 0.95,
  };

  it('1. Asking Schedule: treatment sudah dipilih + tanya slot hari ini → handoff Admin (ESCALATE_HUMAN_SCHEDULE)', async () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_schedule'],
      preferredDateText: 'hari ini',
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'Klo hari ini apa masih ada slot?',
    });

    expect(decision.action).toBe('ESCALATE_HUMAN_SCHEDULE');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.updatedSlate.humanHandlingReason).toBe('booking_schedule_check');
    expect(decision.deterministicTemplateReply).toContain('kami cek jadwal dulu yaa bunda');
  });

  it('2. Asking Schedule Jam: treatment sudah dipilih + sebut "jam 10 bisa" → handoff Admin (ESCALATE_HUMAN_SCHEDULE)', async () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['ask_schedule'],
      preferredTimeText: '10:00',
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'jam 10 bisa',
    });

    expect(decision.action).toBe('ESCALATE_HUMAN_SCHEDULE');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.updatedSlate.humanHandlingReason).toBe('booking_schedule_check');
  });

  it('3. Permintaan CS Manusia: Saat customer minta "mau bicara sama admin", matrix harus eskalasi ke ESCALATE_HUMAN_AGENT_REQUEST', async () => {
    const decision = await DecisionMatrix.evaluate(baseSlate, emptyExtraction, {
      incomingText: 'mau bicara sama admin dong kak',
    });

    expect(decision.action).toBe('ESCALATE_HUMAN_AGENT_REQUEST');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.updatedSlate.humanHandlingReason).toBe('human_agent_requested');
    expect(decision.deterministicTemplateReply).toContain('teruskan ke tim Admin');
  });

  it('4. Komplain Pelayanan: Saat customer sampaikan komplain layanan, matrix harus silent eskalasi ke ESCALATE_HUMAN_COMPLAINT', async () => {
    const extraction: ExtractedEntities = {
      ...emptyExtraction,
      intents: ['complaint'],
    };

    const decision = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'Kemarin terapisnya telat dan pelayanannya kurang memuaskan, saya kecewa',
    });

    expect(decision.action).toBe('ESCALATE_HUMAN_COMPLAINT');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.updatedSlate.humanHandlingReason).toBe('customer_complaint');
  });

  it('5. Not Interested: Saat customer tolak halus "gak jadi kak kemahalan", matrix harus hasilkan NOT_INTERESTED_COMPLETED', async () => {
    const decision = await DecisionMatrix.evaluate(baseSlate, emptyExtraction, {
      incomingText: 'gak jadi kak kemahalan buat saya',
    });

    expect(decision.action).toBe('NOT_INTERESTED_COMPLETED');
    expect(decision.deterministicTemplateReply).toContain('tidak apa-apa. Terima kasih banyak');
  });

  it('6. Reschedule / Pembatalan: Saat customer minta "kak mau ganti jadwal yang kemarin", matrix harus eskalasi ke ESCALATE_RESCHEDULE_CANCEL', async () => {
    const decision = await DecisionMatrix.evaluate(baseSlate, emptyExtraction, {
      incomingText: 'kak mau ganti jadwal yang kemarin ya',
    });

    expect(decision.action).toBe('ESCALATE_RESCHEDULE_CANCEL');
    expect(decision.updatedSlate.isHumanHandling).toBe(true);
    expect(decision.updatedSlate.humanHandlingReason).toBe('reschedule_or_cancellation');
    expect(decision.deterministicTemplateReply).toContain('perubahan atau pembatalan jadwal');
  });
});

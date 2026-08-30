import { describe, it, expect, vi } from 'vitest';
import { UnifiedResponseSanitizer } from '../../src/utils/language-sanitizer';
import { GroundingComposer } from '../../src/slot-engine/grounding-composer';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { TEMPLATES } from '../../src/config/persona';
import { ConversationState } from '@prisma/client';

describe('Conversational Consultation Flow & Form Attachment Hardening', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'cust_flow_test',
    phone: '628123456789',
    name: null,
    tenantId: 'default-tenant',
    conversationId: 'conv_flow_test',
    kelurahan: 'Tambakoso',
    kecamatan: 'Waru',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.35,
    lng: 112.78,
    streetDetail: 'Alana',
    distanceKm: 9.2,
    ongkirFee: 20000,
    ongkirPromoFee: 15000,
    isLocationConfirmed: true,
    isOutOfCoverage: false,
    childAgeMonths: 1,
    childAgeCategory: 'BABY',
    symptoms: [],
    medicalConcerns: [],
    selectedTreatmentName: 'Pijat Bayi Ceria',
    preferredDate: null,
    preferredTime: null,
    pricelistSent: false,
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

  describe('1. Sanitizer & Greeting Preservation', () => {
    it('should preserve official greeting header even when historyCount > 0 when preserveGreeting: true', () => {
      const officialGreeting = TEMPLATES.greeting({ isIslamic: false });
      const sanitized = UnifiedResponseSanitizer.sanitize(officialGreeting, {
        historyCount: 1,
        preserveGreeting: true,
      });

      expect(sanitized).toContain('Halo Bunda ! ✨');
      expect(sanitized).toContain('Perkenalkan, saya Bidan Yusi');
      expect(sanitized).toContain('Treatment moms & Baby');
      expect(sanitized).not.toContain('Treatment moms & bayi');
    });

    it('should strip repetitive greeting cleanly without leaving stray emojis on regular follow-up turns', () => {
      const followUpText = 'Halo Bunda! ✨ Kami bantu cekkan ketersediaan jadwal Bidan untuk hari Sabtu ya.';
      const cleaned = UnifiedResponseSanitizer.sanitize(followUpText, {
        historyCount: 2,
      });

      expect(cleaned).not.toMatch(/^✨/);
      expect(cleaned).not.toMatch(/^Halo Bunda/);
      expect(cleaned).toContain('Kami bantu cekkan ketersediaan jadwal Bidan untuk hari Sabtu ya.');
    });

    it('should sanitize over-affirmation "Tentu bisa, kami bantu cekkan..." into neutral schedule check', () => {
      const affirmationText = 'Tentu bisa, kami bantu cekkan ketersediaan jadwal Bidan yang ready untuk hari Sabtu ya, Bun 😊 Untuk jam preferensinya, apakah pagi, siang, atau sore yang lebih memudahkan?';
      const cleaned = UnifiedResponseSanitizer.sanitize(affirmationText, {
        historyCount: 1,
      });

      expect(cleaned).not.toContain('Tentu bisa');
      expect(cleaned).not.toContain('Bun ');
      expect(cleaned).toContain('Kami bantu cekkan ketersediaan jadwal Bidan yang ready untuk hari Sabtu ya, Bunda 😊');
      expect(cleaned).toContain('Untuk jam preferensinya, apakah pagi, siang, atau sore yang lebih memudahkan?');
    });
  });

  describe('2. Consultation Phase vs Booking Form Trigger', () => {
    it('Turn 2 Consultation: should NOT attach prefilled form when customer only asks for eligibility', async () => {
      const consultationExtraction: ExtractedEntities = {
        ...emptyExtraction,
        intents: ['provide_location', 'provide_age', 'consult_symptom'],
        locationText: 'alana tambak oso waru',
        childAgeMonths: 1,
        treatmentReferenced: 'pijat bayi',
        preferredDateText: null, // Customer belum pilih hari/jadwal
      };

      const grounding = await GroundingComposer.compose(baseSlate, consultationExtraction, {
        customerInput: 'Saya lokasinya di alana tambak oso waru bisa pijat bayi 1 bulan gak ya',
      });

      expect(grounding.isBookingReady).toBe(false);
      expect(grounding.suggestedPreFilledForm).toBeNull();

      const closerInstruction = DynamicCloserService.getCloserInstruction(baseSlate, grounding.suggestedPreFilledForm);
      expect(closerInstruction).toContain('PANDUAN PENAWARAN JADWAL (SCHEDULE)');
      expect(closerInstruction).toContain('rencana mau treatment di hari apa');
    });

    it('Turn 3 Booking Intent: should attach prefilled form when customer confirms day/schedule', async () => {
      const bookingExtraction: ExtractedEntities = {
        ...emptyExtraction,
        intents: ['select_treatment', 'request_booking'],
        treatmentReferenced: 'Pijat Bayi Ceria',
        preferredDateText: 'hari Sabtu besok',
      };

      const grounding = await GroundingComposer.compose(baseSlate, bookingExtraction, {
        customerInput: 'Boleh sus mau ambil Pijat Bayi Ceria untuk hari Sabtu besok',
      });

      expect(grounding.isBookingReady).toBe(true);
      expect(grounding.suggestedPreFilledForm).not.toBeNull();
      expect(grounding.suggestedPreFilledForm).toContain('Tambakoso');
      expect(grounding.suggestedPreFilledForm).toContain('Waru');
      expect(grounding.suggestedPreFilledForm).toContain('Pijat Bayi Ceria');
      expect(grounding.suggestedPreFilledForm).toContain('hari Sabtu besok');

      const closerInstruction = DynamicCloserService.getCloserInstruction(baseSlate, grounding.suggestedPreFilledForm);
      expect(closerInstruction).toContain('PANDUAN RESERVASI & PENUTUP');
      expect(closerInstruction).toContain('sertakan format reservasi berikut');
    });
  });

  describe('3. Dynamic Closer Service Safeguards', () => {
    it('should guide location inquiry when location is not confirmed', () => {
      const unconfirmedSlate: CustomerSlate = {
        ...baseSlate,
        isLocationConfirmed: false,
        kelurahan: null,
      };
      const instruction = DynamicCloserService.getCloserInstruction(unconfirmedSlate, null);
      expect(instruction).toContain('Tanyakan alamat/daerah di kalimat penutup');
    });

    it('should prohibit sending duplicate forms when reservationFormSent is true', () => {
      const formSentSlate: CustomerSlate = {
        ...baseSlate,
        reservationFormSent: true,
      };
      const instruction = DynamicCloserService.getCloserInstruction(formSentSlate, 'Formulir...');
      expect(instruction).toContain('DILARANG KERAS mengulang mengirim format formulir reservasi yang panjang');
    });
  });
});

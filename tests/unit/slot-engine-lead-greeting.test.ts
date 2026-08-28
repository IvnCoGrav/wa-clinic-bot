import { describe, it, expect, vi } from 'vitest';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { FastFaqDetector } from '../../src/slot-engine/fast-faq-detector';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { TEMPLATES } from '../../src/config/persona';
import { ConversationState } from '@prisma/client';

describe('Slot Engine Lead Greeting & False-Positive Hardening (Unit Tests)', () => {
  const initialSlate: CustomerSlate = {
    customerId: 'cust_lead_test',
    phone: '6289999195023',
    name: null,
    tenantId: 'default-tenant',
    conversationId: 'conv_lead_test',
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
    projectedState: ConversationState.AWAITING_LOCATION,
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

  describe('1. Entity Extractor False-Positive Sanitization', () => {
    it('should strip generic business terms from treatmentReferenced', () => {
      const genericInputs = [
        'home-treatment',
        'layanan home-treatment',
        'homecare',
        'home care',
        'perawatan',
        'treatment',
        'pijat',
        'spa',
        'layanan kami',
        'promo',
        'paket',
      ];

      for (const term of genericInputs) {
        const raw: ExtractedEntities = {
          ...emptyExtraction,
          treatmentReferenced: term,
        };
        const sanitized = EntityExtractor.sanitizeExtractedEntities(raw);
        expect(sanitized.treatmentReferenced).toBeNull();
      }
    });

    it('should preserve specific catalog treatment names', () => {
      const realTreatments = [
        'Pijat Bayi Ceria',
        'Pijat Pulih Ceria',
        'Pijat Laktasi',
        'Sinar Moksa',
        'Pijat Anak Ceria',
      ];

      for (const t of realTreatments) {
        const raw: ExtractedEntities = {
          ...emptyExtraction,
          treatmentReferenced: t,
        };
        const sanitized = EntityExtractor.sanitizeExtractedEntities(raw);
        expect(sanitized.treatmentReferenced).toBe(t);
      }
    });

    it('should strip generic location placeholders like "rumah" or "klinik"', () => {
      const genericLocations = ['rumah', 'ke rumah', 'di rumah', 'klinik', 'tempat', 'sini', 'surabaya / sidoarjo'];
      for (const loc of genericLocations) {
        const raw: ExtractedEntities = {
          ...emptyExtraction,
          locationText: loc,
          intents: ['provide_location'],
        };
        const sanitized = EntityExtractor.sanitizeExtractedEntities(raw);
        expect(sanitized.locationText).toBeNull();
        expect(sanitized.intents).not.toContain('provide_location');
      }
    });

    it('should strip courtesy words and greetings from symptoms', () => {
      const raw: ExtractedEntities = {
        ...emptyExtraction,
        symptoms: ['sehat selalu', 'konsultasi', 'batuk', 'info lengkap'],
      };
      const sanitized = EntityExtractor.sanitizeExtractedEntities(raw);
      expect(sanitized.symptoms).toEqual(['batuk']);
    });

    it('should strip pronouns from customerName', () => {
      const invalidNames = ['Saya', 'Aku', 'Bunda', 'Bidan', 'Bu Bidan'];
      for (const name of invalidNames) {
        const raw: ExtractedEntities = {
          ...emptyExtraction,
          customerName: name,
        };
        const sanitized = EntityExtractor.sanitizeExtractedEntities(raw);
        expect(sanitized.customerName).toBeNull();
      }
    });
  });

  describe('2. Decision Matrix Lead Greeting Detection', () => {
    it('should return instant TEMPLATES.greeting for "Promo[tg] Halo Bu Bidan, saya tertarik dengan layanan home-treatment"', async () => {
      const incomingText = 'Promo[tg]\n\nHalo Bu Bidan, saya tertarik dengan layanan home-treatment';
      const extraction: ExtractedEntities = {
        ...emptyExtraction,
        treatmentReferenced: null, // sanitized
      };

      const decision = await DecisionMatrix.evaluate(initialSlate, extraction, {
        incomingText,
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.deterministicTemplateReply).toBe(TEMPLATES.greeting({ isIslamic: false }));
      expect(decision.deterministicTemplateReply).toContain('Perkenalkan, saya Bidan Yusi');
      expect(decision.deterministicTemplateReply).toContain('Kalau boleh tau rumahnya dimana ya Bunda?');
    });

    it('should return Islamic greeting for "Promo[pr22] Assalamu\'alaikum Bidan Yusi, mau tanya layanan"', async () => {
      const incomingText = "Promo[pr22] Assalamu'alaikum Bidan Yusi, mau tanya layanan";
      const extraction: ExtractedEntities = {
        ...emptyExtraction,
      };

      const decision = await DecisionMatrix.evaluate(initialSlate, extraction, {
        incomingText,
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.deterministicTemplateReply).toBe(TEMPLATES.greeting({ isIslamic: true }));
      expect(decision.deterministicTemplateReply).toContain('Waalaikumsalam Bunda ! ✨');
    });

    it('should route multi-intent message ("Promo[tg] Halo Bu Bidan, untuk bayi 1 bulan biayanya berapa?") to ReplyGenerator', async () => {
      const incomingText = 'Promo[tg] Halo Bu Bidan, untuk bayi 1 bulan biayanya berapa?';
      const extraction: ExtractedEntities = {
        ...emptyExtraction,
        intents: ['ask_price', 'provide_age'],
        childAgeMonths: 1,
      };

      const decision = await DecisionMatrix.evaluate(initialSlate, extraction, {
        incomingText,
        history: [],
      });

      expect(decision.action).toBe('GENERATE_AI_RESPONSE');
      expect(decision.deterministicTemplateReply).toBeUndefined();
    });
  });

  describe('3. Persona Composer Turn-0 & Turn > 1 Rules', () => {
    it('should enforce Bidan Yusi identity and clinic greeting on Turn 0 (historyCount === 0)', () => {
      const rules = PersonaComposer.getPersonaRules({ historyCount: 0 });
      expect(rules).toContain('ATURAN SAPAAN PEMBUKA (CHAT PERTAMA/TURN-0)');
      expect(rules).toContain('Perkenalkan, saya Bidan Yusi');
      expect(rules).toContain('Kala Moms and Baby Spa');
    });

    it('should prohibit repetitive "Halo Bunda!" on follow-up turns (historyCount > 0)', () => {
      const rules = PersonaComposer.getPersonaRules({ historyCount: 2 });
      expect(rules).toContain('ATURAN SAPAAN PERCAKAPAN LANJUTAN');
      expect(rules).toContain('DILARANG KERAS membuka pesan dengan "Halo Bunda!"');
    });
  });

  describe('4. Fast-Track FAQ Hijack Prevention on New Sessions', () => {
    it('should reject Fast FAQ for initial lead opener when location is unconfirmed', () => {
      const leadOpener = 'Promo[tg] Halo Bu Bidan, saya tertarik dengan layanan home-treatment';
      const isFaq = FastFaqDetector.isPotentialFastFaq(leadOpener, initialSlate);
      expect(isFaq).toBe(false);
    });

    it('should reject Fast FAQ for initial greeting asking "apakah bisa datang ke rumah?" before location onboarding', () => {
      const text = 'Halo Bu Bidan, apakah bisa datang ke rumah?';
      const isFaq = FastFaqDetector.isPotentialFastFaq(text, initialSlate);
      expect(isFaq).toBe(false);
    });

    it('should allow Fast FAQ for pure general questions when location is already confirmed', () => {
      const confirmedSlate: CustomerSlate = {
        ...initialSlate,
        isLocationConfirmed: true,
        kelurahan: 'Tropodo',
      };
      const text = 'Metode pembayarannya bisa transfer bank apa saja ya?';
      const isFaq = FastFaqDetector.isPotentialFastFaq(text, confirmedSlate);
      expect(isFaq).toBe(true);
    });
  });
});

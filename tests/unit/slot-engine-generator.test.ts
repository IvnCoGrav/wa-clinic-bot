import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator, sanitizeFinalReply } from '../../src/slot-engine/reply-generator';
import { processSlotEngine } from '../../src/slot-engine/slot-engine';
import { CustomerSlate, ExtractedEntities, GroundingPackage } from '../../src/slot-engine/types';
import * as modelFallback from '../../src/integrations/llm/model-fallback';
import { ConversationState } from '@prisma/client';

describe('Single-Pass Warm Generator & Post-Processing Sanitizer (Part 5)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test_key_123';
    process.env.LLM_API_KEY = 'test_key_123';
  });

  describe('sanitizeFinalReply', () => {
    it('should format Rp currency with proper spacing', () => {
      expect(sanitizeFinalReply('Biayanya Rp25.000 ya')).toContain('Rp 25.000');
      expect(sanitizeFinalReply('ongkirnyaRp15.000')).toContain('ongkirnya Rp 15.000');
    });

    it('should fix glued words from template concatenation', () => {
      expect(sanitizeFinalReply('Untukjarak 14 km kami ada promo')).toContain('Untuk jarak');
      expect(sanitizeFinalReply('Darijarak 10 km')).toContain('Dari jarak');
    });

    it('should append warm smile emoji if completely missing', () => {
      const output = sanitizeFinalReply('Bisa dijadwalkan besok');
      expect(output).toMatch(/[😊☺️🥰🌸]/);
    });

    it('should sanitize overclaim phrases to supportive phrases', () => {
      expect(sanitizeFinalReply('Pijat ini bisa menyembuhkan batuk si kecil')).toContain('membantu meredakan batuk');
      expect(sanitizeFinalReply('Dijamin membuat si kecil tidur pulas')).toContain('membantu si kecil tidur lebih nyaman');
      expect(sanitizeFinalReply('InsyaAllah pasti sembuh setelah dipijat')).toContain('membantu proses pemulihan');
      expect(sanitizeFinalReply('Bisa menghilangkan batuk dan grok-grok')).toContain('membantu melegakan batuk');
    });
  });

  describe('ReplyGenerator.generate', () => {
    const mockSlate: CustomerSlate = {
      customerId: 'cust_123',
      phone: '6288235780925',
      name: 'Bunda Melati',
      tenantId: 'tenant_default',
      conversationId: 'conv_123',
      kelurahan: 'Pradah Kalikendal',
      kecamatan: 'Dukuh Pakis',
      kota: 'Kota Surabaya',
      lat: -7.281,
      lng: 112.684,
      streetDetail: null,
      distanceKm: 16.99,
      ongkirFee: 25000,
      ongkirPromoFee: 20000,
      isLocationConfirmed: true,
      isOutOfCoverage: false,
      childAgeMonths: 2,
      childAgeCategory: 'BABY',
      symptoms: ['grok-grok'],
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

    const mockExtraction: ExtractedEntities = {
      intents: ['consult_symptom', 'ask_clinic_origin'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: 2,
      symptoms: ['grok-grok'],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const mockGrounding: GroundingPackage = {
      filteredCatalog: [
        {
          name: 'Pijat Bayi Pulih Ceria',
          category: 'BABY',
          promoPrice: 120000,
          description: 'Pijat batuk pilek dan relaksasi',
        },
      ],
      deliveryFacts: {
        distanceKm: 16.99,
        ongkirNormal: 25000,
        ongkirPromo: 20000,
        kelurahan: 'Pradah Kalikendal',
      },
      clinicFacts: {
        homebase: 'Waru, Sidoarjo',
        coverage: 'Surabaya & Sidoarjo',
      },
      symptomsDiscussed: ['grok-grok'],
      missingSlotsToPrompt: 'TREATMENT_CHOICE',
    };

    it('should generate warm single-pass response with mocked LLM', async () => {
      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
        model: 'MiniMax-M2.7-highspeed',
        baseUrl: 'https://api.sumopod.com',
        data: {
          choices: [
            {
              message: {
                content:
                  'Halo Bunda Melati! Homebase kami di Waru Sidoarjo dan kami melayani homecare ke Pradah Kalikendal dengan ongkir promo Rp 20.000. Untuk keluhan grok-grok si kecil usia 2 bulan, sangat cocok dengan Pijat Pulih Ceria + Sinar Moksa agar napasnya plong. Mau dijadwalkan kapan Bunda? 😊',
              },
            },
          ],
        },
      } as any);

      const reply = await ReplyGenerator.generate(mockSlate, mockExtraction, mockGrounding, {
        customerInput: 'Anak saya 2 bulan grok-grok, bidannya dari mana?',
      });

      expect(reply).toContain('Waru Sidoarjo');
      expect(reply).toContain('Rp 20.000');
      expect(reply).toContain('Pijat Pulih Ceria');
      expect(reply).toContain('😊');
    });

    it('should include duration metadata and relevant FAQs in grounding facts', async () => {
      const { GroundingComposer } = await import('../../src/slot-engine/grounding-composer');
      const grounding = await GroundingComposer.compose(mockSlate, mockExtraction, {
        customerInput: 'Durasi per anak berapa ya?',
        tenantId: 'tenant_default',
      });

      expect(grounding.filteredCatalog[0].durationMinutes).toBeDefined();
      expect(grounding.filteredCatalog[0].durationMinutes).toBe(40);

      const spyCall = vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
        model: 'gpt-4o-mini',
        baseUrl: 'https://ai.sumopod.com/v1',
        data: {
          choices: [
            {
              message: {
                content:
                  'Untuk durasi pijat bayi sekitar 40 menit per anak ya Bunda 😊 Kami pastikan si kecil nyaman selama prosesnya. Mau kami bantu jadwalkan kunjungan Bidan ke rumah, Bunda? 😊',
              },
            },
          ],
        },
      } as any);

      const reply = await ReplyGenerator.generate(mockSlate, mockExtraction, grounding, {
        customerInput: 'Durasi per anak berapa ya?',
      });

      expect(spyCall).toHaveBeenCalled();
      const passedPayload = (spyCall.mock.calls[0][0] as any).payload;
      const systemPromptContent = passedPayload.messages[0].content;

      expect(systemPromptContent).toContain('Durasi: ~40 menit');
      expect(systemPromptContent).toContain('DURASI STANDAR LAYANAN');
      expect(reply).toContain('40 menit');
    });
  });

  describe('processSlotEngine End-to-End Orchestrator', () => {
    it('should process message end-to-end and return structured StateHandlerResult', async () => {
      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValue({
        model: 'MiniMax-M2.7-highspeed',
        baseUrl: 'https://api.sumopod.com',
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents: ['consult_symptom'],
                  location_text: null,
                  street_detail: null,
                  child_age_months: 2,
                  symptoms: ['grok-grok'],
                  treatment_referenced: null,
                  preferred_date_text: null,
                  preferred_time_text: null,
                  customer_name: null,
                  is_medical_emergency: false,
                  confidence_score: 0.95,
                }),
              },
            },
          ],
        },
      } as any);

      const mockCtx: any = {
        customer: {
          id: 'cust_123',
          phone: '6288235780925',
          name: 'Bunda Melati',
          kelurahan: 'Pradah Kalikendal',
          lat: -7.281,
          lng: 112.684,
          pricelist_sent: true,
          preferences: { distanceKm: 16.99, ongkirPromoFee: 20000 },
        },
        conversation: {
          id: 'conv_123',
          current_state: ConversationState.AWAITING_INTEREST,
          is_human_handling: false,
        },
        incomingMessage: {
          text: { body: 'Anak saya 2 bulan grok-grok' },
        },
      };

      const result = await processSlotEngine(mockCtx);

      expect(result.shouldSendReply).toBe(true);
      expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
      expect(result.replyText).toBeDefined();
    });
  });
});

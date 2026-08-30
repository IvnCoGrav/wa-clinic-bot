import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processSlotEngine } from '../../src/slot-engine/slot-engine';
import { ConversationState } from '@prisma/client';
import * as modelFallback from '../../src/integrations/llm/model-fallback';

describe('Multi-Turn Conversation Replay Test Suite (Part 6)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test_key_123';
    process.env.LLM_API_KEY = 'test_key_123';
    vi.restoreAllMocks();
  });

  describe('Skenario 1: Kasus Mbak Karimah (Grok-grok + Asal Klinik)', () => {
    it('Turn 1 -> Turn 2: harus menyelesaikan lokasi dan menjawab keluhan + asal klinik secara simultan', async () => {
      // Setup state percakapan di awal Turn 1
      const customer: any = {
        id: 'cust_karimah',
        phone: '6289999602953',
        name: 'Mbak Karimah',
        tenant_id: 'tenant_default',
        kelurahan: null,
        lat: null,
        lng: null,
        pricelist_sent: false,
        preferences: {},
      };

      const conversation: any = {
        id: 'conv_karimah',
        current_state: ConversationState.AWAITING_LOCATION,
        is_human_handling: false,
        last_discussed_treatment: null,
      };

      // --- TURN 1: Customer memberikan lokasi ---
      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback')
        // Mocking Extractor untuk Turn 1
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intents: ['provide_location'],
                    location_text: 'Tambak Cemandi Sedati',
                    street_detail: null,
                    child_age_months: null,
                    symptoms: [],
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
        } as any)
        // Mocking Generator untuk Turn 1
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content:
                    'Baik Bunda Karimah, untuk area Tambak Cemandi Sedati jaraknya sekitar 14.9 km dengan ongkir promo Rp 15.000. Kalau boleh tahu si kecil usianya berapa bulan ya Bunda? 😊',
                },
              },
            ],
          },
        } as any);

      const turn1Result = await processSlotEngine({
        customer,
        conversation,
        incomingMessage: { text: { body: 'Desa Tambak Cemandi, Kec Sedati, Kab Sidoarjo' } },
        tenantId: 'tenant_default',
      } as any);

      expect(turn1Result.shouldSendReply).toBe(true);
      expect(turn1Result.nextState).toBe(ConversationState.AWAITING_INTEREST);
      expect(turn1Result.replyText).toContain('jaraknya kurang lebih');
      expect(turn1Result.replyText).toContain('Rp 15.000');

      // Update customer & conversation snapshot setelah Turn 1
      customer.kelurahan = 'Tambak Cemandi';
      customer.kecamatan = 'Sedati';
      customer.kota = 'Kabupaten Sidoarjo';
      customer.lat = -7.382;
      customer.lng = 112.783;
      customer.pricelist_sent = true;
      customer.preferences = {
        distanceKm: 14.97,
        ongkirFee: 25000,
        ongkirPromoFee: 15000,
      };
      conversation.current_state = ConversationState.AWAITING_INTEREST;

      // --- TURN 2: Customer mengirim keluhan grok-grok + tanya asal klinik ---
      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback')
        // Mocking Extractor untuk Turn 2
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intents: ['provide_age', 'consult_symptom', 'ask_clinic_origin'],
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
        } as any)
        // Mocking Generator untuk Turn 2
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content:
                    'Homebase klinik kami di Waru, Sidoarjo ya Bunda, dan kami menyediakan layanan homecare langsung ke rumah Bunda di Tambak Cemandi. Untuk dedek bayi usia 2 bulan yang nafasnya grok-grok, sangat cocok dengan Pijat Pulih Ceria dikombinasikan Sinar Moksa untuk menghangatkan dan melegakan saluran napasnya. Mau dijadwalkan untuk hari apa Bunda? 😊',
                },
              },
            ],
          },
        } as any);

      const turn2Result = await processSlotEngine({
        customer,
        conversation,
        incomingMessage: {
          text: {
            body: 'Anaknya usia 2 bulan, nafasnya grok grok terus. Bu bidannya ini dari daerah mana?',
          },
        },
        tenantId: 'tenant_default',
      } as any);

      expect(turn2Result.shouldSendReply).toBe(true);
      expect(turn2Result.replyText).toContain('Waru, Sidoarjo');
      expect(turn2Result.replyText).toContain('Pijat Pulih Ceria');
      expect(turn2Result.replyText).toContain('Sinar Moksa');
    });
  });

  describe('Skenario 2: Kasus Bunda Melati (Pradah Kalikendal + Penambahan Detail Jalan)', () => {
    it('harus mencatat detail gang/nomor rumah tanpa mereset lokasi atau hitung ulang ongkir ganda', async () => {
      // Customer yang sudah terkonfirmasi di Pradah Kalikendal
      const customer: any = {
        id: 'cust_melati',
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
          distanceKm: 16.99,
          ongkirFee: 25000,
          ongkirPromoFee: 20000,
        },
      };

      const conversation: any = {
        id: 'conv_melati',
        current_state: ConversationState.AWAITING_INTEREST,
        is_human_handling: false,
      };

      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback')
        // Mocking Extractor
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intents: ['supplement_address'],
                    location_text: null,
                    street_detail: 'Darmo permai selatan gang 17',
                    child_age_months: null,
                    symptoms: [],
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
        } as any)
        // Mocking Generator
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content:
                    'Baik Bunda Melati, alamat lengkap di Darmo Permai Selatan Gang 17 sudah kami catat ya bund. Untuk si kecil mau kami bantu jadwalkan treatment apa hari ini? 😊',
                },
              },
            ],
          },
        } as any);

      const result = await processSlotEngine({
        customer,
        conversation,
        incomingMessage: { text: { body: 'Darmo permai selatan gang 17' } },
        tenantId: 'tenant_default',
      } as any);

      expect(result.shouldSendReply).toBe(true);
      expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
      expect(result.replyText).toContain('Darmo Permai Selatan Gang 17');
    });
  });

  describe('Skenario 3: Kasus Fitra (Multi-Intent + Afirmasi Bebas ke Booking Form)', () => {
    it('harus memproses afirmasi bebas dan mengirim format reservasi lengkap', async () => {
      const customer: any = {
        id: 'cust_fitra',
        phone: '6281234567890',
        name: 'Bunda Fitra',
        tenant_id: 'tenant_default',
        kelurahan: 'Kureksari',
        kecamatan: 'Waru',
        kota: 'Kabupaten Sidoarjo',
        lat: -7.351,
        lng: 112.742,
        pricelist_sent: true,
        preferences: {
          distanceKm: 2.1,
          ongkirFee: 0,
          ongkirPromoFee: 0,
          childAgeMonths: 36,
          selectedTreatmentName: 'Pijat Anak Ceria',
        },
      };

      const conversation: any = {
        id: 'conv_fitra',
        current_state: ConversationState.AWAITING_INTEREST,
        is_human_handling: false,
        last_discussed_treatment: 'Pijat Anak Ceria',
      };

      vi.spyOn(modelFallback, 'callChatCompletionsWithFallback')
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intents: ['select_treatment', 'request_booking', 'affirmation'],
                    location_text: null,
                    street_detail: null,
                    child_age_months: null,
                    symptoms: [],
                    treatment_referenced: 'Pijat Anak Ceria',
                    preferred_date_text: 'Sabtu pagi jam 9',
                    preferred_time_text: '09.00',
                    customer_name: null,
                    is_medical_emergency: false,
                    confidence_score: 0.95,
                  }),
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          model: 'MiniMax-M2.7-highspeed',
          data: {
            choices: [
              {
                message: {
                  content:
                    'Baik Bunda Fitra, berikut list untuk reservasi ya bund:\n\nNama Bunda: Bunda Fitra\nUsia Anak: 36 bulan\nTreatment: Pijat Anak Ceria\nLokasi: Kureksari, Waru, Sidoarjo\nJadwal: Sabtu pagi jam 09.00\n\nSilakan kirim data lengkapnya ya bund! 😊',
                },
              },
            ],
          },
        } as any);

      const result = await processSlotEngine({
        customer,
        conversation,
        incomingMessage: { text: { body: 'Boleh deh bund mau yang itu aja untuk hari Sabtu pagi jam 9' } },
        tenantId: 'tenant_default',
      } as any);

      expect(result.shouldSendReply).toBe(true);
      expect(result.nextState).toBe(ConversationState.RESERVATION_SENT);
      expect(result.replyText).toContain('list untuk reservasi');
      expect(result.replyText).toContain('Bunda Fitra');
      expect(result.replyText).toContain('Kureksari');
    });
  });
});

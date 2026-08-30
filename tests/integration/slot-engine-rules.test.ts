import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processSlotEngine } from '../../src/slot-engine/slot-engine';
import { ConversationState } from '@prisma/client';
import * as modelFallback from '../../src/integrations/llm/model-fallback';

describe('Integration Test Suite: Seluruh Rules & Kebijakan Kala Spa', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test_key_123';
    process.env.LLM_API_KEY = 'test_key_123';
    vi.restoreAllMocks();
  });

  const baseCustomer: any = {
    id: 'cust_test',
    phone: '6288235780925',
    name: 'Bunda Test',
    tenant_id: 'tenant_default',
    kelurahan: null,
    lat: null,
    lng: null,
    pricelist_sent: false,
    preferences: {},
  };

  const baseConversation: any = {
    id: 'conv_test',
    current_state: ConversationState.INITIAL,
    is_human_handling: false,
  };

  it('Rule 1 & 2: Salam Islami & Izin Bertanya -> harus dijawab Waalaikumsalam dan menyambut konsultasi hangat', async () => {
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intents: [],
                location_text: null,
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
    } as any);

    const result = await processSlotEngine({
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: { text: { body: 'Assalamualaikum kak, mau tanya-tanya dulu boleh?' } },
      tenantId: 'tenant_default',
    } as any);

    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('Waalaikumsalam Bunda');
    expect(result.replyText).toContain('Tentu boleh sekali, Bunda!');
    expect(result.replyText).toContain('siap bantu jelaskan');
  });

  it('Rule 3: Lokasi Murni -> harus mengirim Template Ongkir Deterministik + Gambar Brosur Pricelist', async () => {
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intents: ['provide_location'],
                location_text: 'Darmo permai selatan gang 17',
                street_detail: 'gang 17',
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
    } as any);

    const result = await processSlotEngine({
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: { text: { body: 'Darmo permai selatan gang 17' } },
      tenantId: 'tenant_default',
    } as any);

    expect(result.shouldSendReply).toBe(true);
    expect(result.sendPricelistImage).toBe(true);
    expect(result.replyText).toContain('jaraknya kurang lebih');
    expect(result.replyText).toContain('Rp 20.000');
    expect(result.replyText).toMatch(/mau (?:pilih )?treatment apa bunda/i);
  });

  it('Rule 4: Kebijakan Transport Multi-Anak -> harus membalas 1x ongkir per kedatangan/alamat', async () => {
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intents: ['ask_price'],
                location_text: null,
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
    } as any);

    const result = await processSlotEngine({
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: { text: { body: 'Untuk 2 anak ongkirnya 1 kali kan bund?' } },
      tenantId: 'tenant_default',
    } as any);

    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('dihitung per kedatangan/kunjungan');
    expect(result.replyText).toContain('tetap dihitung 1 kali saja');
  });

  it('Rule 5: Kebijakan Metode Pembayaran -> harus membalas opsi BCA/Mandiri, QRIS, dan Cash', async () => {
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intents: ['ask_payment_method'],
                location_text: null,
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
    } as any);

    const result = await processSlotEngine({
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: { text: { body: 'Metode pembayaran bisa transfer apa saja ya?' } },
      tenantId: 'tenant_default',
    } as any);

    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('BCA / Mandiri');
    expect(result.replyText).toContain('QRIS');
    expect(result.replyText).toContain('Cash');
  });

  it('Rule 6: Kebijakan Kualifikasi Terapis -> harus mengonfirmasi terapis Bidan Resmi bersertifikat STR aktif', async () => {
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback').mockResolvedValueOnce({
      model: 'MiniMax-M2.7-highspeed',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intents: ['ask_therapist_qualification'],
                location_text: null,
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
    } as any);

    const result = await processSlotEngine({
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: { text: { body: 'Terapisnya bidan resmi bersertifikat atau bukan ya?' } },
      tenantId: 'tenant_default',
    } as any);

    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('Bidan Resmi bersertifikat');
    expect(result.replyText).toContain('STR aktif');
  });

  it('Rule 7: Keluhan Grok-Grok & Gumoh Usia 2 Bulan -> harus merekomendasikan Pijat Pulih Ceria + Sinar Moksa tanpa False Escalation', async () => {
    // Extractor mock
    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback')
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.7-highspeed',
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents: ['consult_symptom', 'provide_age'],
                  location_text: null,
                  street_detail: null,
                  child_age_months: 2,
                  symptoms: ['grok-grok', 'kembung', 'gumoh'],
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
      // Generator mock
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.7-highspeed',
        data: {
          choices: [
            {
              message: {
                content:
                  'Tidak perlu khawatir ya Bunda, di usia 2 bulan saluran cerna si kecil memang sedang beradaptasi. Untuk keluhan grok-grok dan kembung, kami sangat menyarankan *Pijat Pulih Ceria* dikombinasikan dengan terapi hangat *Sinar Moksa* agar dahak encer dan perutnya lega. Mau dijadwalkan kapan Bunda? 😊',
              },
            },
          ],
        },
      } as any);

    const result = await processSlotEngine({
      customer: { ...baseCustomer },
      conversation: { ...baseConversation },
      incomingMessage: {
        text: {
          body: 'Anaknya usia 2 bulan, nafasnya grok grok terus sering kembung sama gumoh',
        },
      },
      tenantId: 'tenant_default',
    } as any);

    expect(result.isHumanHandling).toBeFalsy();
    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toContain('Pijat Pulih Ceria');
    expect(result.replyText).toContain('Sinar Moksa');
    expect(result.replyText).not.toContain('**'); // Wajib format satu bintang
  });

  it('Rule 8: Permintaan Booking -> harus mengirimkan format pendaftaran reservasi lengkap', async () => {
    const customerWithLocation = {
      ...baseCustomer,
      kelurahan: 'Pradah Kalikendal',
      kecamatan: 'Dukuh Pakis',
      kota: 'Kota Surabaya',
      lat: -7.281,
      lng: 112.684,
      pricelist_sent: true,
      preferences: {
        distanceKm: 16.99,
        ongkirPromoFee: 20000,
        selectedTreatmentName: 'Pijat Pulih Ceria',
      },
    };

    vi.spyOn(modelFallback, 'callChatCompletionsWithFallback')
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.7-highspeed',
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents: ['select_treatment', 'request_booking'],
                  location_text: null,
                  street_detail: null,
                  child_age_months: null,
                  symptoms: [],
                  treatment_referenced: 'Pijat Pulih Ceria',
                  preferred_date_text: 'hari Sabtu',
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
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.7-highspeed',
        data: {
          choices: [
            {
              message: {
                content:
                  'Baik Bunda, berikut list untuk reservasi ya bund:\n\nNama Bunda: Bunda Test\nTreatment: Pijat Pulih Ceria\nLokasi: Pradah Kalikendal, Dukuh Pakis, Kota Surabaya\nJadwal: Hari Sabtu\n\nSilakan kirim data lengkapnya ya bund! 😊',
              },
            },
          ],
        },
      } as any);

    const result = await processSlotEngine({
      customer: customerWithLocation,
      conversation: { ...baseConversation, current_state: ConversationState.AWAITING_INTEREST },
      incomingMessage: { text: { body: 'Boleh bund mau ambil Pijat Pulih Ceria untuk hari Sabtu' } },
      tenantId: 'tenant_default',
    } as any);

    expect(result.shouldSendReply).toBe(true);
    expect(result.nextState).toBe(ConversationState.RESERVATION_SENT);
    expect(result.replyText).toContain('list untuk reservasi');
    expect(result.replyText).toContain('Pradah Kalikendal');
  });
});

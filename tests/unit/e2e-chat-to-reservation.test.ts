import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { stateMachine } from '../../src/state-machine/machine';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { deliveryService } from '../../src/services/delivery.service';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { knowledgeBaseService } from '../../src/services/knowledge.service';
import { llmResponseGenerator } from '../../src/integrations/llm/generator';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * E2E: Alur lengkap customer chat → lokasi → ongkir → reservasi.
 * 7 case berbeda.
 */

function mockDelivery() {
  return vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
    distanceKm: 4.8,
    ongkir: 0,
    normalPrice: 0,
    promoPrice: 0,
    promoDiscount: 0,
    isOutOfCoverage: false,
    routeUsed: 'HAVERSINE' as any,
  });
}

function mockKnowledgeMatch() {
  return vi.spyOn(knowledgeBaseService, 'searchRelevantChunks').mockResolvedValue([
    {
      id: 'chunk-1',
      tenantId: DEFAULT_TENANT_ID,
      sourceType: 'faq',
      title: 'Jam Operasional',
      content: `Pertanyaan: Jam buka berapa?
Jawaban: Kami buka setiap hari 08.00 - 20.00 WIB.`,
      documentName: 'faq',
    },
  ]);
}

function mockGenerator() {
  return vi.spyOn(llmResponseGenerator, 'generateFaqResponse').mockResolvedValue(
    'Kami buka setiap hari 08.00 - 20.00 WIB. 😊'
  );
}

async function newCustomer(prefix: string, name: string) {
  const phone = `${prefix}${Date.now()}`;
  const customer = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
  const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
  await conversationService.updateConversationState(
    conversation.id,
    { currentState: ConversationState.INITIAL, locationAttempts: 0, isHumanHandling: false, previousState: null },
    DEFAULT_TENANT_ID
  );
  return { phone, customer };
}

async function sendText(ctx: { phone: string; customer: any }, text: string) {
  return stateMachine.processMessage({
    tenantId: DEFAULT_TENANT_ID,
    customer: ctx.customer,
    conversation: await conversationService.getOrCreateConversation(ctx.customer.id, DEFAULT_TENANT_ID),
    incomingMessage: {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      from: ctx.phone,
      timestamp: '1700000000',
      type: 'text',
      text: { body: text },
    },
  });
}

describe('E2E: Customer Chat → Lokasi → Ongkir → Reservasi (7 Case)', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    mockDelivery();
    vi.restoreAllMocks();
    mockDelivery();
  });

  it('CASE 1 — Happy path: halo → lokasi teks → ongkir → tertarik → reservasi', async () => {
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({
      isPrecise: true, kelurahan: 'Wedoro', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo',
      lat: -7.348395, lng: 112.7494759, formattedAddress: 'Wedoro, Waru, Kabupaten Sidoarjo',
    });

    const ctx = await newCustomer('628810', 'Bunda Test1');

    const r1 = await sendText(ctx, 'halo');
    expect(r1.nextState).toBe(ConversationState.AWAITING_LOCATION);
    expect(r1.replyText).toContain('Bidan Yusi');

    const r2 = await sendText(ctx, 'saya di wedoro waru');
    expect(r2.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(r2.replyText).toContain('ongkir');

    const r3 = await sendText(ctx, 'mau pijat bayi dong');
    expect(r3.nextState).toBe(ConversationState.RESERVATION_SENT);
    expect(r3.replyText).toContain('list untuk reservasi');

    const r4 = await sendText(ctx, `Berikut list untuk reservasi:
Hari dan tanggal : 15 Agustus 2026
Nama Bunda: Bunda Test1
Alamat & Shareloc : Jl. Raya Wedoro no 1
Kec : Waru
Kota : Sidoarjo
No. Hp : 0812345678
Pilihan treatment (Baby & Kids)
Nama Bayi : Zayn
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi Ceria`);
    expect(r4.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(r4.isHumanHandling).toBe(true);
    expect(r4.replyText).toContain('reservasi');
  });

  it('CASE 2 — Share location native → ongkir → reservasi (tanpa nanya ulang lokasi)', async () => {
    const ctx = await newCustomer('628811', 'Bunda Test2');

    const r1 = await sendText(ctx, 'halo');
    expect(r1.nextState).toBe(ConversationState.AWAITING_LOCATION);

    // Share location native
    const r2 = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer: ctx.customer,
      conversation: await conversationService.getOrCreateConversation(ctx.customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_loc_${Date.now()}`,
        from: ctx.phone,
        timestamp: '1700000000',
        type: 'location',
        location: { latitude: -7.3450, longitude: 112.7500 },
      },
    });
    expect(r2.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(r2.replyText).toContain('ongkir');

    const r3 = await sendText(ctx, 'mau booking');
    expect(r3.nextState).toBe(ConversationState.RESERVATION_SENT);

    const r4 = await sendText(ctx, `Berikut list untuk reservasi:
Hari dan tanggal : besok
Nama Bunda: Bunda Test2
Alamat & Shareloc : Wedoro
Kec : Waru
Kota : Sidoarjo
No. Hp : 0812000002
Pilihan treatment (Baby & Kids)
Nama Bayi : Aisyah
Usia Bayi/Anak : 3 bulan
Treatment : Pijat Bayi Pulih Ceria`);
    expect(r4.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(r4.isHumanHandling).toBe(true);
  });

  it('CASE 3 — Alamat lengkap di pesan pertama (deteksi lokasi dini) → ongkir → reservasi', async () => {
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({
      isPrecise: true, kelurahan: 'Wedoro', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo',
      lat: -7.348395, lng: 112.7494759, formattedAddress: 'Wedoro, Waru, Kabupaten Sidoarjo',
    });

    const ctx = await newCustomer('628812', 'Bunda Test3');

    // Pesan pertama sudah berisi alamat lengkap
    const r1 = await sendText(ctx, 'halo bunda, saya di wedoro waru sidoarjo');
    expect(r1.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(r1.replyText).toContain('ongkir');

    const r2 = await sendText(ctx, 'tertarik');
    expect(r2.nextState).toBe(ConversationState.RESERVATION_SENT);
  });

  it('CASE 4 — Lokasi tersimpan + afirmasi → langsung ke reservasi tanpa tanya lokasi lagi', async () => {
    const ctx = await newCustomer('628813', 'Bunda Test4');
    // Customer lama: sudah punya lokasi confirmed
    await customerService.updateCustomerLocation(
      ctx.customer.id,
      {
        kelurahan: 'Wedoro', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo',
        lat: -7.348395, lng: 112.7494759,
        distanceKm: 4.8, ongkir: 0, isOutOfCoverage: false,
      },
      DEFAULT_TENANT_ID
    );
    const updated = await customerService.getOrCreateCustomer(ctx.phone, 'Bunda Test4', DEFAULT_TENANT_ID);

    const ctx2 = { phone: ctx.phone, customer: updated };
    const r1 = await sendText(ctx2, 'halo');
    expect(r1.replyText).toContain('Wedoro'); // tawarkan lokasi lama

    const r2 = await sendText(ctx2, 'iya bener');
    expect(r2.nextState).toBe(ConversationState.AWAITING_INTEREST);

    const r3 = await sendText(ctx2, 'mau pijat');
    expect(r3.nextState).toBe(ConversationState.RESERVATION_SENT);
  });

  it('CASE 5 — FAQ di tengah alur lokasi: ditanya jam buka, lalu lanjut ke reservasi', async () => {
    mockKnowledgeMatch();
    mockGenerator();
    const geocodeMock = vi.spyOn(geocodingService, 'geocodeText');
    geocodeMock.mockImplementation(async (text: string) => {
      if (/wedoro/i.test(text)) {
        return {
          isPrecise: true, kelurahan: 'Wedoro', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo',
          lat: -7.348395, lng: 112.7494759, formattedAddress: 'Wedoro, Waru, Kabupaten Sidoarjo',
        };
      }
      return { isPrecise: false };
    });

    const ctx = await newCustomer('628814', 'Bunda Test5');

    const r1 = await sendText(ctx, 'halo');
    expect(r1.nextState).toBe(ConversationState.AWAITING_LOCATION);

    // Tanya FAQ sebelum kasih lokasi → bukan lokasi, state tetap aman (tidak crash, tidak resolve palsu)
    const r2 = await sendText(ctx, 'jam buka berapa?');
    expect(r2.nextState).toBe(ConversationState.AWAITING_LOCATION);
    expect(r2.replyText).toMatch(/kelurahan|desa/i); // minta detail lokasi, bukan asal resolve

    // Lanjut kasih lokasi
    const r3 = await sendText(ctx, 'saya di wedoro waru');
    expect(r3.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(r3.replyText).toContain('ongkir');

    const r4 = await sendText(ctx, 'mau booking');
    expect(r4.nextState).toBe(ConversationState.RESERVATION_SENT);
  });

  it('CASE 6 — Lokasi kecamatan-only ditolak → retry dengan kelurahan → reservasi', async () => {
    // Simulasi: "waru" (kecamatan) ditolak, "wedoro waru" (kelurahan+kecamatan) diterima
    const geocodeMock = vi.spyOn(geocodingService, 'geocodeText');
    geocodeMock.mockImplementation(async (text: string) => {
      if (/wedoro/i.test(text)) {
        return {
          isPrecise: true, kelurahan: 'Wedoro', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo',
          lat: -7.348395, lng: 112.7494759, formattedAddress: 'Wedoro, Waru, Kabupaten Sidoarjo',
        };
      }
      return { isPrecise: false, kota: 'waru' };
    });

    const ctx = await newCustomer('628815', 'Bunda Test6');

    const r1 = await sendText(ctx, 'halo');
    expect(r1.nextState).toBe(ConversationState.AWAITING_LOCATION);

    // Kecamatan-only → ditolak
    const r2 = await sendText(ctx, 'di waru');
    expect(r2.nextState).toBe(ConversationState.AWAITING_LOCATION);
    expect(r2.replyText).toMatch(/kelurahan|desa/i);

    // Retry dengan kelurahan → diterima
    const r3 = await sendText(ctx, 'saya di wedoro waru');
    expect(r3.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(r3.replyText).toContain('ongkir');

    const r4 = await sendText(ctx, 'mau booking');
    expect(r4.nextState).toBe(ConversationState.RESERVATION_SENT);
  });

  it('CASE 7 — Mixed-signal saat konfirmasi lokasi → klarifikasi → konfirmasi → reservasi', async () => {
    const geocodeMock = vi.spyOn(geocodingService, 'geocodeText');
    geocodeMock.mockImplementation(async (text: string) => {
      if (/wedoro|waru/i.test(text)) {
        return {
          isPrecise: false, isFuzzyMatch: true,
          kelurahan: 'Wedoro', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo',
          lat: -7.348395, lng: 112.7494759, formattedAddress: 'Wedoro, Waru',
        };
      }
      return { isPrecise: false };
    });

    const ctx = await newCustomer('628816', 'Bunda Test7');

    // Lokasi fuzzy → minta konfirmasi (LOCATION_CONFIRMED)
    const r1 = await sendText(ctx, 'di wedoro waru');
    expect(r1.nextState).toBe(ConversationState.LOCATION_CONFIRMED);

    // Mixed-signal → minta klarifikasi
    const r2 = await sendText(ctx, 'iya bener tapi bukan itu');
    expect(r2.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(r2.replyText).toMatch(/klarif|kurang tepat|maksud/i);

    // Refresh customer supaya pending_kelurahan ter-update di memori
    const refreshed = await customerService.getOrCreateCustomer(ctx.phone, 'Bunda Test7', DEFAULT_TENANT_ID);
    const ctxRefreshed = { phone: ctx.phone, customer: refreshed };

    // Afirmasi murni → promote lokasi → AWAITING_INTEREST
    const r3 = await sendText(ctxRefreshed, 'iya betul');
    expect(r3.nextState).toBe(ConversationState.AWAITING_INTEREST);

    const r4 = await sendText(ctxRefreshed, 'mau booking');
    expect(r4.nextState).toBe(ConversationState.RESERVATION_SENT);
  });
});

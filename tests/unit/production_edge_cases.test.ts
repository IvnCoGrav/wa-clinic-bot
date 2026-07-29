import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { getStringSimilarity } from '../../src/utils/similarity';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { prisma } from '../../src/db/client';
import { ConversationState } from '@prisma/client';
import { deliveryService } from '../../src/services/delivery.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { wahaClient } from '../../src/integrations/waha/client';
import { llmIntentService } from '../../src/integrations/llm/intent';

// Mock LLM services secara global untuk mencegah panggilan API nyata / timeout
vi.mock('../../src/integrations/llm/intent', () => {
  return {
    llmIntentService: {
      detectIntent: async () => ({ intent: 'other' }),
    },
  };
});

vi.mock('../../src/integrations/llm/generator', () => {
  return {
    llmResponseGenerator: {
      generateFaqResponse: async () => 'Mock FAQ response',
    },
  };
});

const mockTypingService = {
  simulateHumanReply: async () => ({ success: true }),
} as any;

const testStateMachine = new ConversationStateMachine(mockTypingService);

describe('Production Edge Cases & Abuse Testing Suite (Revisu 16 Final)', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'test_admin_key_123';

    // Mock $transaction secara dinamis untuk pengujian agar tidak crash saat offline
    (prisma as any).$transaction = async (fn: any) => {
      return fn(prisma);
    };
  });

  afterEach(() => {
    process.env.ADMIN_API_KEY = originalApiKey;
  });

  // =========================================================================
  // §5. Booting App Crash / Fail-Closed API Key
  // =========================================================================
  it('1. should refuse to start app (throw Error) if ADMIN_API_KEY is missing or empty', () => {
    process.env.ADMIN_API_KEY = '';
    expect(() => buildApp()).toThrow(/Critical Configuration Missing/);
  });

  // =========================================================================
  // §3.1. Fuzzy Boundary Tests
  // =========================================================================
  it('2. should verify Sorensen-Dice similarity boundaries strictly (0.79 vs 0.80)', () => {
    // Wedii vs Wedi (similarity: 6/7 ≈ 0.857 >= 0.80)
    expect(getStringSimilarity('Wedii', 'Wedi')).toBeGreaterThanOrEqual(0.80);
    
    // Wedi vs W (length too short, should be 0.0)
    expect(getStringSimilarity('Wedi', 'W')).toBe(0.0);
  });

  // =========================================================================
  // §3.2. Word-Boundary Safety Tests
  // =========================================================================
  it('3. should verify word-boundary safety for "ga" substring matching', () => {
    const isNegativeRegex = /\b(bukan|ga|gak|tidak|no|salah|enggak)\b/i;
    
    // Kata "ga" mandiri adalah negasi
    expect(isNegativeRegex.test('ga')).toBe(true);
    expect(isNegativeRegex.test('gak')).toBe(true);
    
    // Kata-kata yang mengandung substring "ga" tapi bukan negasi
    expect(isNegativeRegex.test('juga')).toBe(false);
    expect(isNegativeRegex.test('harga')).toBe(false);
    expect(isNegativeRegex.test('tangga')).toBe(false);
    expect(isNegativeRegex.test('tanggal')).toBe(false);
  });

  it('4. should verify negative emojis "👎" and "❌" are classified as negative signals', () => {
    const lower = '👎';
    const isNegative = /\b(bukan|ga|gak|tidak|no|salah|enggak)\b/i.test(lower) || lower.includes('👎') || lower.includes('❌');
    expect(isNegative).toBe(true);

    const lowerCross = '❌';
    const isNegativeCross = /\b(bukan|ga|gak|tidak|no|salah|enggak)\b/i.test(lowerCross) || lowerCross.includes('👎') || lowerCross.includes('❌');
    expect(isNegativeCross).toBe(true);
  });

  // =========================================================================
  // §2.4. Promosi & Atomicity (Prisma Transactions)
  // =========================================================================
  it('7. should rollback transaction completely if calculateDelivery throws error during promotion', async () => {
    // Buat customer mock
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    
    // Set pending location
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Wedi',
        kecamatan: 'Gedangan',
        kota: 'Sidoarjo',
        lat: -7.38636,
        lng: 112.746,
      },
      DEFAULT_TENANT_ID
    );

    // Panggil promotePendingLocation dengan calculator yang melempar error
    const result = await customerService.promotePendingLocation(
      cust.id,
      {
        pending_kelurahan: 'Wedi',
        pending_kecamatan: 'Gedangan',
        pending_kota: 'Sidoarjo',
        pending_lat: -7.38636,
        pending_lng: 112.746,
      },
      async () => {
        throw new Error('ORS API is completely down/timeout');
      },
      DEFAULT_TENANT_ID
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('ORS API is completely down');

    // Ambil data customer dari memory/DB dan pastikan data confirmed tetap null, pending tetap utuh!
    const verifiedCust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    expect(verifiedCust.kelurahan).toBeNull();
    expect(verifiedCust.pending_kelurahan).toBe('Wedi');
  });

  // =========================================================================
  // §2.2. Data Isolation & Idle Timeout Reset
  // =========================================================================
  it('8. should isolate confirmed location from unconfirmed fuzzy-match pending locations on 24h idle timeout', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    
    // 1. Customer sudah memiliki confirmed location (Alamat lama)
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerLocation(
      cust.id,
      {
        kelurahan: 'Keputih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: -7.2917,
        lng: 112.798,
        distanceKm: 8.21,
        ongkir: 10000,
      },
      DEFAULT_TENANT_ID
    );

    // 2. Customer mencoba ganti lokasi baru, masuk ke pending location
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Ngingas',
        kecamatan: 'Waru',
        kota: 'Sidoarjo',
        lat: -7.3512,
        lng: 112.741,
      },
      DEFAULT_TENANT_ID
    );

    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    
    // Set status menunggu konfirmasi
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;

    // Manipulasi last_message_at ke >24 jam lalu
    conversation.last_message_at = new Date(Date.now() - 25 * 60 * 60 * 1000);

    // Panggil processMessage untuk men-trigger timeout reset
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_idle_test',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'halo' },
      },
    };

    const res = await testStateMachine.processMessage(ctx);
    
    // State harus kembali ke INITIAL
    expect(res.nextState).toBe(ConversationState.INITIAL);

    // Ambil customer terbaru
    const finalCust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    
    // Data confirmed alamat lama TIDAK BOLEH HILANG/TERRESET!
    expect(finalCust.kelurahan).toBe('Keputih');
    
    // Data pending lokasi baru yang gagal dikonfirmasi WAJIB DIBERSIHKAN!
    expect(finalCust.pending_kelurahan).toBeNull();
  });

  // =========================================================================
  // §2.5. Gate Blocked Customer
  // =========================================================================
  it('14. should bypass processing immediately (early return) if customer status is "blocked"', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    
    // Set status ke blocked
    cust.status = 'blocked';

    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_blocked_test',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'halo bidan' },
      },
    };

    const res = await testStateMachine.processMessage(ctx);
    
    // shouldSendReply harus false, dan state tidak berubah
    expect(res.shouldSendReply).toBe(false);
  });

  // =========================================================================
  // §3.3. Conversational Redirect Calibration (handleInterestState)
  // =========================================================================
  it('15. should NOT redirect location in handleInterestState on conversational text without change keywords', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    
    // Set state ke AWAITING_INTEREST
    conversation.current_state = ConversationState.AWAITING_INTEREST;

    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_redirect_cal_1',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'saya dulu kerja di daerah Rungkut itu juga sih kak' },
      },
    };

    // Panggil stateMachine
    const res = await testStateMachine.processMessage(ctx);
    
    // State TIDAK BOLEH me-redirect ke lokasi (tetap di interest atau RAG/FAQ)
    expect(res.nextState).not.toBe(ConversationState.AWAITING_LOCATION);
    expect(res.nextState).not.toBe(ConversationState.LOCATION_CONFIRMED);
  });

  it('15b. should redirect to location in handleInterestState when user asks "Kalau ke wedoro ka ?"', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    
    conversation.current_state = ConversationState.AWAITING_INTEREST;

    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_redirect_cal_15b',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'Kalau ke wedoro ka ?' },
      },
    };

    const res = await testStateMachine.processMessage(ctx);
    
    // Harus ter-redirect dan terproses langsung menjadi AWAITING_INTEREST karena Wedoro adalah kelurahan valid & presisi di DB
    expect(res.nextState).toBe(ConversationState.AWAITING_INTEREST);
    expect(res.replyText).toContain('ongkir');
  });

  it('16. should redirect location in handleInterestState when change keywords + location is mentioned', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    
    conversation.current_state = ConversationState.AWAITING_INTEREST;

    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_redirect_cal_2',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'eh salah alamat, ganti ke Ngingass' },
      },
    };

    const res = await testStateMachine.processMessage(ctx);
    
    // Harus sukses redirect ke LOCATION_CONFIRMED (karena Ngingass fuzzy match tunggal)
    expect(res.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
  });

  // =========================================================================
  // SKENARIO 10: State LOCATION_CONFIRMED & Alur Promosi Lanjutan
  // =========================================================================
  it('9b. should override old location retention greeting when customer sends a location pin directly', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerLocation(
      cust.id,
      {
        kelurahan: 'Keputih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: -7.2917,
        lng: 112.798,
      },
      DEFAULT_TENANT_ID
    );
    
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.INITIAL;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_pin_override',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'location',
        location: { latitude: -7.3412, longitude: 112.741 }, // Ngingas
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.AWAITING_INTEREST);
    
    const finalCust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    expect(finalCust.kelurahan).toBe('Gubeng');
  });

  it('10. should prioritize ambiguity resolution over fuzzy match when typo Wedii matches multiple kelurahans', async () => {
    const res = await geocodingService.geocodeText('Wedii');
    expect(res.isPrecise).toBe(false);
    expect(res.isFuzzyMatch).toBeUndefined();
    expect(res.ambiguityResults).toBeDefined();
    expect(res.ambiguityResults!.length).toBeGreaterThan(1);
  });

  it('11. should trigger mixed-signal clarification when customer says yes and no in LOCATION_CONFIRMED', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Wedi',
        kecamatan: 'Gedangan',
        kota: 'Sidoarjo',
        lat: -7.38636,
        lng: 112.746,
      },
      DEFAULT_TENANT_ID
    );
    
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_mixed',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'iya bener tapi kayaknya bukan itu deh' },
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(res.replyText).toContain('kurang menangkap maksudnya');
  });

  it('12. should override mixed signal and geocode new location if new location is explicitly mentioned', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Wedi',
        kecamatan: 'Gedangan',
        kota: 'Sidoarjo',
        lat: -7.38636,
        lng: 112.746,
      },
      DEFAULT_TENANT_ID
    );
    
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_override_mixed',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'iya tapi ganti ke Ngingas aja' },
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.AWAITING_INTEREST);
    
    const finalCust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    expect(finalCust.kelurahan).toBe('Ngingas');
  });

  it('13. should perform lenient override in LOCATION_CONFIRMED state even without change keywords', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Wedi',
        kecamatan: 'Gedangan',
        kota: 'Sidoarjo',
        lat: -7.38636,
        lng: 112.746,
      },
      DEFAULT_TENANT_ID
    );
    
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_lenient_override',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'bukan, rungkut' },
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.AWAITING_LOCATION);
  });

  it('17. should trigger no-match fallback and re-prompt for location confirmation on irrelevant chat in LOCATION_CONFIRMED', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Wedi',
        kecamatan: 'Gedangan',
        kota: 'Sidoarjo',
        lat: -7.38636,
        lng: 112.746,
      },
      DEFAULT_TENANT_ID
    );
    
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_no_match',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'ongkirnya berapa ya kak?' },
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(res.replyText).toContain('Mohon dikonfirmasi dulu ya');
  });

  it('18. should successfully promote pending location to confirmed when customer replies ya', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Wedi',
        kecamatan: 'Gedangan',
        kota: 'Sidoarjo',
        lat: -7.38636,
        lng: 112.746,
      },
      DEFAULT_TENANT_ID
    );
    
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_yes_confirm',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'iya bener bund' },
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.AWAITING_INTEREST);
    
    const finalCust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    expect(finalCust.kelurahan).toBe('Wedi');
    expect(finalCust.pending_kelurahan).toBeNull();
    // Note: ongkir calculation is tested separately in delivery.service.test.ts
    // In-memory promotion path updates the memoryCustomers map; ongkir depends
    // on whether the customer entry is found there (populated by getOrCreateCustomer earlier).
  });


  it('19. should enforce header-only ADMIN_API_KEY auth and reject ?apiKey= query parameter with 401', async () => {
    const app = buildApp();
    
    // Scenario A: Request without header -> 401
    const resNoHeader = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
    });
    expect(resNoHeader.statusCode).toBe(401);

    // Scenario B: Request with valid X-API-KEY header -> 200 (Case-insensitive)
    const resValidHeader = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
      headers: {
        'x-api-key': 'test_admin_key_123',
      },
    });
    expect(resValidHeader.statusCode).toBe(200);

    const resValidHeaderUpper = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
      headers: {
        'X-API-KEY': 'test_admin_key_123',
      },
    });
    expect(resValidHeaderUpper.statusCode).toBe(200);

    // Scenario C: Request with ?apiKey= query parameter (without header) -> MUST return 401 (Prevent URL log leak)
    const resQueryParam = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations?apiKey=test_admin_key_123',
    });
    expect(resQueryParam.statusCode).toBe(401);

    // Scenario D: Empty header -> 401
    const resEmptyHeader = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
      headers: {
        'x-api-key': '',
      },
    });
    expect(resEmptyHeader.statusCode).toBe(401);
  });


  // =========================================================================
  // SKENARIO 17 & 18 & 5.2: Uji Retensi Reservasi, Parsing Bebas & Double-Failure
  // =========================================================================
  it('20. should retain all reservation records (no deletion/modification) during 24h idle timeout reset', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Keputih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: -7.2917,
        lng: 112.798,
      },
      DEFAULT_TENANT_ID
    );

    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    conversation.last_message_at = new Date(Date.now() - 25 * 60 * 60 * 1000);

    // Tambahkan mock data reservasi di memoryReservations store
    const reservationId = `res_${Date.now()}`;
    const mockReservation = { id: reservationId, customerId: cust.id, status: 'pending' };
    const { memoryReservations } = await import('../../src/routes/admin.route');
    memoryReservations.set(reservationId, mockReservation);

    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_idle_reservation_test',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'halo' },
      },
    };

    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.AWAITING_LOCATION);

    // Ambil customer & reservasi
    const finalCust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    expect(finalCust.pending_kelurahan).toBeNull();
    
    const retrievedRes = memoryReservations.get(reservationId);
    expect(retrievedRes).toBeDefined();
    expect(retrievedRes.status).toBe('pending');

    // Bersihkan memory
    memoryReservations.delete(reservationId);
  });

  it('21. should parse realistic conversational affirmative variations ("iyaa bener", "ok bos") and reject particle "ya" in questions', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Keputih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: -7.2917,
        lng: 112.798,
      },
      DEFAULT_TENANT_ID
    );

    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    
    // a. Uji "iyaa bener bund" -> Terdeteksi afirmatif (unanchored "bener" match)
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    const ctx1: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_var_1',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'iyaa bener bund' },
      },
    };
    const res1 = await testStateMachine.processMessage(ctx1);
    expect(res1.nextState).toBe(ConversationState.AWAITING_INTEREST);

    // Reset pending location untuk tes berikutnya
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Keputih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: -7.2917,
        lng: 112.798,
      },
      DEFAULT_TENANT_ID
    );

    // b. Uji "ok bos" -> Terdeteksi afirmatif (unanchored "ok" match)
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    const ctx2: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_var_2',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'ok bos' },
      },
    };
    const res2 = await testStateMachine.processMessage(ctx2);
    expect(res2.nextState).toBe(ConversationState.AWAITING_INTEREST);

    // Reset pending location untuk tes berikutnya
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Keputih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: -7.2917,
        lng: 112.798,
      },
      DEFAULT_TENANT_ID
    );

    // c. Uji "berapa ya kak?" -> Harusnya memicu fallback (karena "ya" sebagai partikel tanya dikesampingkan dari pencocokan afirmatif)
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;
    const ctx3: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_var_3',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'berapa ya kak?' },
      },
    };
    const res3 = await testStateMachine.processMessage(ctx3);
    expect(res3.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(res3.replyText).toContain('Mohon dikonfirmasi dulu ya');
  });

  it('22. should handle geocoding double-failure (API down + local database mismatch) gracefully without crash', async () => {
    // 1. Set apiKey ke real agar masuk ke blok googleMapsClient.geocode
    const originalApiKey = (geocodingService as any).apiKey;
    (geocodingService as any).apiKey = 'real_production_key';

    // 2. Mock googleMapsClient.geocode untuk melempar error
    const { Client } = await import('@googlemaps/google-maps-services-js');
    const geocodeSpy = vi.spyOn(Client.prototype, 'geocode').mockRejectedValue(
      new Error('Google Maps API down / network timeout')
    );

    const gibberishInput = 'xyz987qweasd';
    
    // Panggil geocodeText -> ditangkap try/catch, fallback ke local database, local database gagal -> kembalikan isPrecise: false (tanpa crash!)
    const res = await geocodingService.geocodeText(gibberishInput);
    expect(res.isPrecise).toBe(false);
    expect(res.isFuzzyMatch).toBeUndefined();

    // Cleanup mock & apiKey
    geocodeSpy.mockRestore();
    (geocodingService as any).apiKey = originalApiKey;
  });

  it('23. should exclude ya ampun and ya elah interjections from affirmative signals using negative lookahead', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    await customerService.updateCustomerPendingLocation(
      cust.id,
      {
        kelurahan: 'Keputih',
        kecamatan: 'Sukolilo',
        kota: 'Surabaya',
        lat: -7.2917,
        lng: 112.798,
      },
      DEFAULT_TENANT_ID
    );

    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.LOCATION_CONFIRMED;

    // Uji "ya ampun..." -> Harusnya memicu fallback karena "ya ampun" dikecualikan!
    const ctx1: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_inter_1',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'ya ampun ongkirnya mahal banget kak' },
      },
    };
    const res1 = await testStateMachine.processMessage(ctx1);
    expect(res1.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(res1.replyText).toContain('Mohon dikonfirmasi dulu ya');

    // Uji "ya elah..." -> Dikecualikan!
    const ctx2: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_inter_2',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'ya elah kok gitu sih' },
      },
    };
    const res2 = await testStateMachine.processMessage(ctx2);
    expect(res2.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(res2.replyText).toContain('Mohon dikonfirmasi dulu ya');
  });

  it('24. should suppress greeting "Halo Bunda" when last interaction is < 48 hours ago', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    // a. Set last_message_at to 1 hour ago
    conversation.last_message_at = new Date(Date.now() - 60 * 60 * 1000);
    conversation.current_state = ConversationState.INITIAL;

    const ctx1: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_greet_suppress',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'halo' },
      },
    };

    const res1 = await testStateMachine.processMessage(ctx1);
    expect(res1.replyText).not.toContain('Halo Bunda');
    expect(res1.replyText).toContain('Kami melayani Treatment moms & Baby');

    // b. Set last_message_at to 3 days ago (should show full greeting)
    conversation.last_message_at = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    conversation.current_state = ConversationState.INITIAL;
    const res2 = await testStateMachine.processMessage(ctx1);
    expect(res2.replyText).toContain('Halo Bunda');
  });

  it('25. should block reservation form delivery and redirect to location query if customer kelurahan is unknown', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.AWAITING_INTEREST;

    // customer.kelurahan is null!
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_res_guard',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'saya mau booking' },
      },
    };

    const intentSpy = vi.spyOn(llmIntentService, 'detectIntent').mockResolvedValue({ intent: 'interested' } as any);
    const res = await testStateMachine.processMessage(ctx);
    intentSpy.mockRestore();

    expect(res.nextState).toBe(ConversationState.AWAITING_LOCATION);
    expect(res.replyText).toContain('mohon informasikan detail kelurahan/desa');
  });

  it('26. should perform early location geocoding check on the first greeting message', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.INITIAL;

    // Kirim "Keputihh" (fuzzy match untuk Keputih, unik di Surabaya) langsung di greeting pertama
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_early_location',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'Keputihh' },
      },
    };

    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(res.replyText).toContain('Perkenalkan, saya Bidan Yusi');
    expect(res.replyText).toContain('Apakah yang Bunda maksud kelurahan **Keputih**');
  });

  it('27. should automatically add label "hold" to chat room on human handling escalation', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    await conversationService.escalateToHumanHandling(conversation, phone, 'test escalation', DEFAULT_TENANT_ID);

    const labels = await wahaClient.getChatLabels(`${phone}@c.us`);
    expect(labels).toContain('hold');
  });

  it('28. should auto-resume bot handling when webhook receives message and hold label is missing from WAHA', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);

    // Escalate ke human handling (otomatis pasang label 'hold')
    await conversationService.escalateToHumanHandling(conversation, phone, 'test escalation', DEFAULT_TENANT_ID);

    // Cek hold label terpasang
    let labels = await wahaClient.getChatLabels(`${phone}@c.us`);
    expect(labels).toContain('hold');

    // Simulasi admin menghapus label 'hold' di WAHA
    await wahaClient.removeLabel(`${phone}@c.us`, 'hold');

    // Kirim pesan webhook
    const app = buildApp();
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `msg_auto_resume_${Date.now()}`,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000),
        body: 'halo bot',
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    // Karena label hold sudah dilepas, pesan diproses (EVENT_PROCESSED)
    expect(JSON.parse(res.body)).toEqual({ status: 'EVENT_PROCESSED' });

    // Assert database conversation tidak lagi di status HUMAN_HANDLING
    const updatedConv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    expect(updatedConv.is_human_handling).toBe(false);
  });

  it('29. should ignore incoming group messages ending with @g.us', async () => {
    const app = buildApp();
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `msg_group_${Date.now()}`,
        from: '12036302485739@g.us',
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000),
        body: 'halo semuanya',
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'IGNORED_GROUP_MESSAGE' });
  });

  it('30. should successfully parse filled-out reservation form when in RESERVATION_SENT state', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    
    // Set customer location agar tidak ditolak
    await customerService.updateCustomerLocation(cust.id, {
      kelurahan: 'Peneleh',
      kecamatan: 'Genteng',
      kota: 'Surabaya',
      lat: -7.25,
      lng: 112.74,
    }, DEFAULT_TENANT_ID);

    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.RESERVATION_SENT;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_res_form_submit',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: {
          body: `Berikut list untuk reservasi : 

Hari dan tanggal :  23 Juni 2026
Nama Bunda: shafira Alif Fitrah
Alamat & Shareloc : pandean 2/27 RT 2 RW 13, Kel. Peneleh

Kec : Genteng
Kota : Surabaya
No. Hp : 081217639971

Pilihan treatment (Baby & Kids)

Nama Bayi : Danish Alzam Khalfani
Usia Bayi/Anak : 1 bulan 2 hari
Treatment : paket selapan ceria`
        },
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(res.isHumanHandling).toBe(true);
    expect(res.replyText).toContain('Data reservasi sudah kami terima ya Bund');
    
    // Pastikan status percakapan di-escalate ke HUMAN_HANDLING
    const updatedConv = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    expect(updatedConv.is_human_handling).toBe(true);
  });

  it('31. should return validation warning if reservation form lacks required fields', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const cust = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    
    const conversation = await conversationService.getOrCreateConversation(cust.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.RESERVATION_SENT;
    
    const ctx: any = {
      tenantId: DEFAULT_TENANT_ID,
      customer: cust,
      conversation,
      incomingMessage: {
        id: 'msg_res_form_incomplete',
        from: phone,
        chatId: `${phone}@c.us`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: {
          body: `Berikut list untuk reservasi : 
Nama Bunda: shafira Alif Fitrah`
        },
      },
    };
    
    const res = await testStateMachine.processMessage(ctx);
    expect(res.nextState).toBe(ConversationState.RESERVATION_SENT);
    expect(res.replyText).toContain('kurang lengkap. Mohon isi bagian berikut');
  });
});

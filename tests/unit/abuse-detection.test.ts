import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { abuseDetectionService } from '../../src/services/abuse-detection.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { ConversationState } from '@prisma/client';
import { WahaClient, wahaClient } from '../../src/integrations/waha/client';

describe('Abuse Detection & Customer Blocking Suite', () => {
  beforeEach(() => {
    // Reset state map in abuse detection service untuk membersihkan data sisa test sebelumnya
    (abuseDetectionService as any).messageTimestamps.clear();
    (abuseDetectionService as any).lastMessages.clear();
  });

  it('1. should trigger FLOOD auto-block when customer sends > 10 messages in 60 seconds', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Flood Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Kirim 10 pesan pertama -> belum ter-block
    for (let i = 0; i < 10; i++) {
      const res = await abuseDetectionService.checkAndProcessAbuse(
        customer,
        conversation,
        `pesan ke-${i}`,
        DEFAULT_TENANT_ID
      );
      expect(res.blocked).toBe(false);
    }

    // Kirim pesan ke-11 -> ter-block otomatis!
    const resFinal = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'pesan ke-11',
      DEFAULT_TENANT_ID
    );
    expect(resFinal.blocked).toBe(true);
    expect(resFinal.reason).toBe('flood');

    // Pastikan status di database/memory diperbarui
    const updatedCustomer = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    expect(updatedCustomer.status).toBe('blocked');
    expect(updatedCustomer.block_reason).toBe('flood');
  });

  it('2. should trigger UNINVITED LINK block in INITIAL state but allow Google Maps links', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Link Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.INITIAL;

    // Google Maps link -> Aman
    const mapsRes = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'ini lokasi saya: https://maps.google.com/?q=-7.123,112.456',
      DEFAULT_TENANT_ID
    );
    expect(mapsRes.blocked).toBe(false);

    // Link non-maps -> Ter-block otomatis!
    const badRes = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'kunjungi web ini ya: http://spamlink.com/promo',
      DEFAULT_TENANT_ID
    );
    expect(badRes.blocked).toBe(true);
    expect(badRes.reason).toBe('uninvited_link');
  });

  it('3. should allow non-maps links when conversation has reached AWAITING_INTEREST or later', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Link Allowed Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    
    // Set state ke AWAITING_INTEREST (setelah lokasi confirmed)
    conversation.current_state = ConversationState.AWAITING_INTEREST;

    // Link non-maps -> Diizinkan (tidak ter-block)
    const res = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'berikut link bukti transfer/foto: https://example.com/image.jpg',
      DEFAULT_TENANT_ID
    );
    expect(res.blocked).toBe(false);
    expect(customer.status).toBe('active');
  });

  it('4. should trigger REPETITIVE SPAM block when customer sends >=5 identical messages under human handling', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Repetitive Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversation.is_human_handling = true;

    // Kirim 4 pesan identik
    for (let i = 0; i < 4; i++) {
      const res = await abuseDetectionService.checkAndProcessAbuse(
        customer,
        conversation,
        '  PING!!!  ', // testing trim & lowercase normalization
        DEFAULT_TENANT_ID
      );
      expect(res.blocked).toBe(false);
    }

    // Kirim pesan ke-5
    const resFinal = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'ping!!!',
      DEFAULT_TENANT_ID
    );
    expect(resFinal.blocked).toBe(true);
    expect(resFinal.reason).toBe('repetitive_spam');
  });

  it('5. should flag conversation for review on profanity using word boundaries and ignore substrings like "masuk"', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Profanity Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversation.review_flagged = false;

    // a. Kirim kata "masuk" (mengandung substring "asu") -> Harus TIDAK ter-flag!
    const resInnocent1 = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'Saya mau masuk kelas spa',
      DEFAULT_TENANT_ID
    );
    expect(resInnocent1.flagged).toBe(false);
    expect(conversation.review_flagged).toBe(false);

    // b. Kirim kata "harga" (mengandung substring "asu" atau mirip? tidak, tapi mari kita cek "tangga" atau "kampas") -> Aman
    const resInnocent2 = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'Berapa tangga tarif harganya?',
      DEFAULT_TENANT_ID
    );
    expect(resInnocent2.flagged).toBe(false);
    expect(conversation.review_flagged).toBe(false);

    // c. Kirim kata kasar asu mandiri -> Ter-flag!
    const resBad = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      'kamu asu banget ya!',
      DEFAULT_TENANT_ID
    );
    expect(resBad.flagged).toBe(true);
    expect(conversation.review_flagged).toBe(true);
  });

  it('6. should avoid false positive auto-block on normal customer sending 4 rapid messages', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Normal Customer', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Kirim 4 pesan cepat (antusias)
    for (let i = 0; i < 4; i++) {
      const res = await abuseDetectionService.checkAndProcessAbuse(
        customer,
        conversation,
        `Halo admin saya mau tanya ongkir ke kelurahan Wedi dong`,
        DEFAULT_TENANT_ID
      );
      expect(res.blocked).toBe(false);
    }
    expect(customer.status).toBe('active');
  });

  it('7. should drop blocked customer messages in webhook route (silent total) with status 200 after passing idempotency', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Blocked Webhook User', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Set status ke blocked secara paksa
    await customerService.blockCustomer(customer.id, 'manual_admin', DEFAULT_TENANT_ID);

    const app = buildApp();
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `msg_blocked_webhook_${Date.now()}`,
        from: `${phone}@c.us`,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000),
        body: 'halo halo',
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'BLOCKED' });
  });

  it('8. should support manual block, unblock and list flagged conversations via admin REST API endpoints', async () => {
    const phone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Admin Block Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const app = buildApp();
    const adminKey = 'test_admin_key_123';
    process.env.ADMIN_API_KEY = adminKey;

    // 1. Manually Block
    const resBlock = await app.inject({
      method: 'POST',
      url: `/api/admin/customer/${customer.id}/block`,
      headers: {
        'x-api-key': adminKey,
      },
      payload: {
        reason: 'manual_spam',
      },
    });
    expect(resBlock.statusCode).toBe(200);
    expect(JSON.parse(resBlock.body).success).toBe(true);
    expect(JSON.parse(resBlock.body).data.status).toBe('blocked');

    // 2. Manually Unblock
    const resUnblock = await app.inject({
      method: 'POST',
      url: `/api/admin/customer/${customer.id}/unblock`,
      headers: {
        'x-api-key': adminKey,
      },
    });
    expect(resUnblock.statusCode).toBe(200);
    expect(JSON.parse(resUnblock.body).success).toBe(true);
    expect(JSON.parse(resUnblock.body).data.status).toBe('active');

    // 3. Get Flagged
    conversation.review_flagged = true; // force flag in memory fallback
    const resFlagged = await app.inject({
      method: 'GET',
      url: `/api/admin/customers/flagged`,
      headers: {
        'x-api-key': adminKey,
      },
    });
    expect(resFlagged.statusCode).toBe(200);
    expect(JSON.parse(resFlagged.body).success).toBe(true);
  });
});

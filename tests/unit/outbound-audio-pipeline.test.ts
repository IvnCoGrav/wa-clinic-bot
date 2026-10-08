import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { messageService } from '../../src/services/message.service';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { mediaService } from '../../src/services/media.service';
import { wahaTenantService } from '../../src/services/waha-tenant.service';

/**
 * Suite: Outbound Audio Pipeline & Deduplication
 * Menguji:
 * 1. Deduplikasi pesan outbound audio/voice note via checkAndAttachOutboundDuplicate
 * 2. Webhook /webhook menerima audio outbound dari WhatsApp HP staf/bidan
 * 3. Background worker menyimpan media audio dan melampirkannya via attachMediaToMessage
 */
describe('Outbound Audio Pipeline & Deduplication', () => {
  const app = buildApp();
  const testTenantId = 'default-tenant';
  const testPhone = '6281299998888';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(wahaTenantService, 'resolveTenantBySession').mockResolvedValue(testTenantId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. checkAndAttachOutboundDuplicate (Deduplikasi Audio)', () => {
    it('mencocokkan placeholder [VOICE_NOTE] dengan pesan outbound yang baru dicatat', async () => {
      const customer = await customerService.getOrCreateCustomer(testPhone, 'Bunda Voice', testTenantId);
      const conversation = await conversationService.getOrCreateConversation(customer.id, testTenantId);

      // Simulasikan pesan outbound livechat yang dicatat di memori/DB sebelum echo WAHA tiba
      await messageService.logMessage({
        tenantId: testTenantId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        content: '[VOICE_NOTE]',
        senderType: 'ADMIN',
        senderName: 'Bidan Staff',
      });

      const isDupe = await messageService.checkAndAttachOutboundDuplicate(
        conversation.id,
        '[VOICE_NOTE]',
        'false_6281299998888@c.us_OUTBOUND_WA_ID_1',
        testTenantId,
        60,
        true
      );

      expect(isDupe).toBe(true);
    });

    it('mencocokkan audio dengan flag isMediaOrImage: true meskipun konten berbeda format caption', async () => {
      const customer = await customerService.getOrCreateCustomer('6281277776666', 'Bunda Audio', testTenantId);
      const conversation = await conversationService.getOrCreateConversation(customer.id, testTenantId);

      await messageService.logMessage({
        tenantId: testTenantId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        content: '[AUDIO: konsultasi.mp3]',
        senderType: 'ADMIN',
        senderName: 'Bidan Staff',
      });

      const isDupe = await messageService.checkAndAttachOutboundDuplicate(
        conversation.id,
        '[AUDIO: konsultasi.mp3]',
        'false_6281277776666@c.us_OUTBOUND_WA_ID_2',
        testTenantId,
        60,
        true
      );

      expect(isDupe).toBe(true);
    });

    it('tidak mencocokkan pesan teks biasa dengan placeholder media (anti-false-positive)', async () => {
      const customer = await customerService.getOrCreateCustomer('6281255554444', 'Bunda Teks', testTenantId);
      const conversation = await conversationService.getOrCreateConversation(customer.id, testTenantId);

      await messageService.logMessage({
        tenantId: testTenantId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        content: 'Halo Bunda, ada yang bisa dibantu?',
        senderType: 'ADMIN',
      });

      const isDupe = await messageService.checkAndAttachOutboundDuplicate(
        conversation.id,
        '[VOICE_NOTE]',
        'false_6281255554444@c.us_OUTBOUND_WA_ID_3',
        testTenantId,
        60,
        true
      );

      expect(isDupe).toBe(false);
    });
  });

  describe('2. Webhook Outbound Audio Processing & Background Worker', () => {
    it('menerima webhook outbound voice note PTT dan memicu download & attachMedia', async () => {
      const waMsgId = `true_6281234567890@c.us_${Date.now()}_ptt`;
      const fakeAudioBuffer = Buffer.from('OGG-OPUS-DUMMY-AUDIO-BYTES-FOR-OUTBOUND-TEST');

      // Spy pada downloadMedia, saveInboundMedia, dan attachMediaToMessage
      const downloadSpy = vi.spyOn(wahaClient, 'downloadMedia').mockResolvedValue(fakeAudioBuffer);
      const saveMediaSpy = vi.spyOn(mediaService, 'saveInboundMedia').mockResolvedValue({
        hdUrl: `/media/inbound/default-tenant/${Date.now()}.ogg`,
        thumbUrl: `/media/thumb/default-tenant/${Date.now()}.ogg`,
        storagePath: '/mock/path/audio.ogg',
      });
      const attachMediaSpy = vi.spyOn(messageService, 'attachMediaToMessage').mockResolvedValue();

      const webhookPayload = {
        event: 'message.any',
        session: 'default',
        payload: {
          id: waMsgId,
          chatId: '6281234567890@c.us',
          from: '6281111111111@c.us',
          to: '6281234567890@c.us',
          fromMe: true,
          hasMedia: true,
          type: 'ptt',
          body: '',
          timestamp: Math.floor(Date.now() / 1000),
          _data: {
            type: 'ptt',
            mimetype: 'audio/ogg; codecs=opus',
          },
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: {
          'content-type': 'application/json',
        },
        payload: webhookPayload,
      });

      expect(res.statusCode).toBe(200);

      // Tunggu microtask loop selesai untuk background worker async
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(downloadSpy).toHaveBeenCalled();
      expect(saveMediaSpy).toHaveBeenCalled();
      expect(attachMediaSpy).toHaveBeenCalled();
    });

    it('melewati eskalasi jika pesan outbound voice note terdeteksi sebagai duplikat', async () => {
      const waMsgId = `true_6281234567890@c.us_dupe_${Date.now()}`;
      const customer = await customerService.getOrCreateCustomer('6281234567890', 'Bunda Dupe', testTenantId);
      const conversation = await conversationService.getOrCreateConversation(customer.id, testTenantId);

      // Catat pesan outbound terlebih dahulu
      await messageService.logMessage({
        tenantId: testTenantId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        content: '[VOICE_NOTE]',
        senderType: 'ADMIN',
      });

      const webhookPayload = {
        event: 'message.any',
        session: 'default',
        payload: {
          id: waMsgId,
          chatId: '6281234567890@c.us',
          from: '6281111111111@c.us',
          to: '6281234567890@c.us',
          fromMe: true,
          hasMedia: true,
          type: 'ptt',
          body: '',
          timestamp: Math.floor(Date.now() / 1000),
          _data: {
            type: 'ptt',
            mimetype: 'audio/ogg; codecs=opus',
          },
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: {
          'content-type': 'application/json',
        },
        payload: webhookPayload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'OUTBOUND_DUPLICATE_SKIPPED' });
    });
  });
});

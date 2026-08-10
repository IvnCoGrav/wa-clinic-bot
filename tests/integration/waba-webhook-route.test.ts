import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../src/app';
import { wabaTenantService } from '../../src/services/waba-tenant.service';
import { messageService } from '../../src/services/message.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { prisma } from '../../src/db/client';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

describe('WABA Webhook Route (raw-body signature + tenant + status + media)', () => {
  const app = buildApp();
  const appSecret = 'meta_app_secret_integration';

  beforeEach(async () => {
    vi.restoreAllMocks();
    wabaTenantService.resetCache();
    process.env.ADMIN_API_KEY = 'test_admin_key_888';
    process.env.WABA_APP_SECRET = appSecret;
    process.env.WABA_WEBHOOK_VERIFY_TOKEN = 'verify_tok';
    // Tes ini memverifikasi perilaku per-pesan (enqueue/idempotency) — matikan
    // burst coalescing supaya pesan text langsung di-enqueue (deterministik),
    // tidak tergantung nilai .env lokal (mis. BURST_COALESCE_MS=5000).
    process.env.BURST_COALESCE_MS = '0';
    await seedAiScopeAll();
  });

  function sign(body: string): string {
    return `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`;
  }

  it('GET /api/webhook/waba verifies hub.challenge', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/webhook/waba?hub.mode=subscribe&hub.verify_token=verify_tok&hub.challenge=CH_123`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('CH_123');
  });

  it('GET /api/webhook/waba rejects wrong verify token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/webhook/waba?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x',
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST rejects invalid HMAC signature', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST accepts raw-body signature with non-canonical whitespace', async () => {
    // Whitespace & key order beda dari JSON.stringify — verifikasi harus pakai
    // raw bytes asli (parser menyimpan request.rawBody), bukan re-stringify.
    const rawBody = '{\n  "object" : "whatsapp_business_account",\n  "entry" : [ {"id":"e1"} ]\n}';
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(rawBody),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('NO_MESSAGES'); // entry tanpa changes
  });

  it('POST processes status webhook and updates delivery status', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_1' },
            statuses: [{ id: 'wamid.delivered', status: 'delivered', timestamp: '1691000100' }],
          },
        }],
      }],
    });

    const updateSpy = vi.spyOn(messageService, 'updateDeliveryStatus').mockResolvedValue({ matched: true });
    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-status-1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('STATUS_PROCESSED');
    expect(updateSpy).toHaveBeenCalledWith('wamid.delivered', 'tenant-status-1', 'delivered', 1691000100, null, null, null);
  });

  it('POST failed status triggers WABA_MESSAGE_FAILED alert', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_1' },
            statuses: [{
              id: 'wamid.failed',
              status: 'failed',
              timestamp: '1691000150',
              errors: [{ code: 131026, title: 'Message Undeliverable', error_data: { details: '24h window closed' } }],
            }],
          },
        }],
      }],
    });

    vi.spyOn(messageService, 'updateDeliveryStatus').mockResolvedValue({ matched: true });
    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-status-2');
    const alertModule = await import('../../src/services/alert.service');
    const alertSpy = vi.spyOn(alertModule.alertService, 'notifyAlert').mockResolvedValue(undefined as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('STATUS_PROCESSED');
    // alertService.notifyAlert dipanggil dengan WABA_MESSAGE_FAILED
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WABA_MESSAGE_FAILED',
        severity: 'CRITICAL',
      })
    );
  });

  it('POST routes message to tenant resolved from phone_number_id', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_TENANT_A' },
            contacts: [{ profile: { name: 'Bunda Test' }, wa_id: '628999123456' }],
            messages: [{
              id: `wamid.inbound_${Date.now()}_${Math.random()}`,
              from: '628999123456',
              timestamp: '1691000500',
              type: 'text',
              text: { body: 'halo' },
            }],
          },
        }],
      }],
    });

    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-waba-a');
    vi.spyOn(messageService, 'isDuplicateMessage').mockResolvedValue(false);
    const enqueueSpy = vi.fn().mockResolvedValue(undefined);
    // Queue service singleton: monkey-patch via any untuk meng-capture tenantId
    const queueMod = await import('../../src/services/queue.service');
    (queueMod.queueService as any).enqueueMessage = enqueueSpy;

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('PROCESSED');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const payload = enqueueSpy.mock.calls[0][0];
    expect(payload.tenantId).toBe('tenant-waba-a');
    expect(payload.incomingMessage._provider).toBe('WABA');
  });

  it('POST accepts signature with application/json; charset=utf-8', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-hub-signature-256': sign(body),
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST returns IGNORED when object is not whatsapp_business_account', async () => {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('IGNORED');
  });

  it('POST skips enqueue for duplicate wa_message_id (idempotency)', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_1' },
            contacts: [{ profile: { name: 'Bunda Dup' }, wa_id: '628999777888' }],
            messages: [{
              id: 'wamid.duplicate',
              from: '628999777888',
              timestamp: '1691000600',
              type: 'text',
              text: { body: 'halo lagi' },
            }],
          },
        }],
      }],
    });

    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-dup');
    vi.spyOn(messageService, 'isDuplicateMessage').mockResolvedValue(true);
    const enqueueSpy = vi.fn().mockResolvedValue(undefined);
    const queueMod = await import('../../src/services/queue.service');
    (queueMod.queueService as any).enqueueMessage = enqueueSpy;

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('PROCESSED'); // count 0 tapi tidak error
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('POST logs message but does NOT enqueue for blocked customer', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_1' },
            contacts: [{ profile: { name: 'Bunda Blok' }, wa_id: '628999666555' }],
            messages: [{
              id: 'wamid.blocked',
              from: '628999666555',
              timestamp: '1691000700',
              type: 'text',
              text: { body: 'boleh? ' },
            }],
          },
        }],
      }],
    });

    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-blk');
    vi.spyOn(messageService, 'isDuplicateMessage').mockResolvedValue(false);
    vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue({
      id: 'cust-blocked',
      phone: '628999666555',
      status: 'blocked',
    } as any);
    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue({
      id: 'conv-blk',
    } as any);
    const logSpy = vi.spyOn(messageService, 'logMessage').mockResolvedValue({} as any);
    const enqueueSpy = vi.fn().mockResolvedValue(undefined);
    const queueMod = await import('../../src/services/queue.service');
    (queueMod.queueService as any).enqueueMessage = enqueueSpy;

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(logSpy).toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('POST routes image message and resolves media URL (token encrypted)', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_MEDIA' },
            contacts: [{ profile: { name: 'Bunda Foto' }, wa_id: '628999555444' }],
            messages: [{
              id: 'wamid.img_1',
              from: '628999555444',
              timestamp: '1691000800',
              type: 'image',
              image: { id: 'media_id_777', mime_type: 'image/png', caption: 'hasil terapi' },
            }],
          },
        }],
      }],
    });

    process.env.WABA_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-media');
    vi.spyOn(messageService, 'isDuplicateMessage').mockResolvedValue(false);
    vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue({
      id: 'cust-media',
      phone: '628999555444',
      status: 'active',
    } as any);
    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue({
      id: 'conv-media',
    } as any);

    // Tenant punya waba_access_token terenkripsi (via encryptSecret)
    const { encryptSecret } = await import('../../src/utils/encryption');
    const encryptedToken = encryptSecret('EAA_real_media_token');
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant-media',
      waba_access_token: encryptedToken,
    } as any);

    const axios = (await import('axios')).default;
    const resolveSpy = vi.spyOn(axios, 'get').mockResolvedValue({
      data: { url: 'https://lookaside.fbsbx.com/media_777', mime_type: 'image/png' },
      status: 200,
    });

    const enqueueSpy = vi.fn().mockResolvedValue(undefined);
    const queueMod = await import('../../src/services/queue.service');
    (queueMod.queueService as any).enqueueMessage = enqueueSpy;

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('PROCESSED');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const payload = enqueueSpy.mock.calls[0][0];
    expect(payload.incomingMessage._mediaUrl).toBe('https://lookaside.fbsbx.com/media_777');
    expect(payload.incomingMessage.type).toBe('image');
    resolveSpy.mockRestore();
  });

  it('POST processes image without token gracefully (no crash, no mediaUrl)', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_MEDIA2' },
            contacts: [{ profile: { name: 'Bunda Foto2' }, wa_id: '628999444333' }],
            messages: [{
              id: 'wamid.img_2',
              from: '628999444333',
              timestamp: '1691000900',
              type: 'image',
              image: { id: 'media_id_888', mime_type: 'image/jpeg' },
            }],
          },
        }],
      }],
    });

    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('tenant-media2');
    vi.spyOn(messageService, 'isDuplicateMessage').mockResolvedValue(false);
    vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue({
      id: 'cust-media2',
      phone: '628999444333',
      status: 'active',
    } as any);
    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue({
      id: 'conv-media2',
    } as any);
    // Tenant tanpa waba_access_token
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant-media2',
      waba_access_token: null,
    } as any);

    const enqueueSpy = vi.fn().mockResolvedValue(undefined);
    const queueMod = await import('../../src/services/queue.service');
    (queueMod.queueService as any).enqueueMessage = enqueueSpy;

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('PROCESSED');
    const payload = enqueueSpy.mock.calls[0][0];
    expect(payload.incomingMessage._mediaUrl).toBeUndefined();
    expect(payload.incomingMessage.type).toBe('image');
  });
});

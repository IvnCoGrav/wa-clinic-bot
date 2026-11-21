import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../src/app';
import { wabaTenantService } from '../../src/services/waba-tenant.service';
import { messageService } from '../../src/services/message.service';
import { queueService } from '../../src/services/queue.service';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

describe('WABA Webhook Quoted Message Resolution (Tugas 2.3)', () => {
  const app = buildApp();
  const appSecret = 'meta_app_secret_quoted_test';

  beforeEach(async () => {
    vi.restoreAllMocks();
    wabaTenantService.resetCache();
    process.env.ADMIN_API_KEY = 'test_admin_key_888';
    process.env.WABA_APP_SECRET = appSecret;
    process.env.WABA_WEBHOOK_VERIFY_TOKEN = 'verify_tok';
    process.env.BURST_COALESCE_MS = '0';
    await seedAiScopeAll();
  });

  afterAll(async () => {
    await app.close();
  });

  function sign(body: string): string {
    return `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`;
  }

  it('1. context.id ada + pesan ditemukan -> payloadRaw.quoted_message tersimpan dengan benar', async () => {
    const originalWaId = 'wamid.HBgMNTY4OTkwMDAwMDAwMBUAElggM0VCMDAwMDAwMDAwMDAwMDEAA==';
    const inboundWaId = `wamid.inbound_quoted_${Date.now()}`;

    // Mock getMessageById untuk menemukan pesan yang dikutip
    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('default-tenant');
    vi.spyOn(messageService, 'getMessageById').mockImplementation(async (id: string) => {
      if (id === originalWaId) {
        return {
          id: 'msg_uuid_original_123',
          wa_message_id: originalWaId,
          direction: 'OUTBOUND',
          sender_type: 'ADMIN',
          sender_name: 'Bidan Ratna',
          content: 'Halo Bunda, kami menyediakan paket Baby Spa seharga Rp 150.000',
          payload_raw: {
            text: 'Halo Bunda, kami menyediakan paket Baby Spa seharga Rp 150.000',
          },
        };
      }
      return null;
    });

    const queueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue('job-123' as any);

    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6289900000000', phone_number_id: 'PNID_WABA_QUOTED' },
            contacts: [{ profile: { name: 'Bunda Pasien' }, wa_id: '6281200000001' }],
            messages: [{
              id: inboundWaId,
              from: '6281200000001',
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text',
              text: { body: 'Saya mau ambil paket yang ini ya' },
              context: {
                from: '6289900000000',
                id: originalWaId,
              },
            }],
          },
        }],
      }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('PROCESSED');
    expect(queueSpy).toHaveBeenCalled();
    const queuedJob = queueSpy.mock.calls[0][0];
    expect(queuedJob.incomingMessage.quoted).toBeDefined();
    expect(queuedJob.incomingMessage.quoted.wa_message_id).toBe(originalWaId);
    expect(queuedJob.incomingMessage.quoted.content).toBe('Halo Bunda, kami menyediakan paket Baby Spa seharga Rp 150.000');
  });

  it('2. context.id ada + pesan TIDAK ditemukan -> pesan tetap diproses tanpa exception & quoted undefined', async () => {
    const unknownContextId = 'wamid.HBgM_UNKNOWN_CONTEXT_ID';
    const inboundWaId = `wamid.inbound_unknown_${Date.now()}`;

    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('default-tenant');
    vi.spyOn(messageService, 'getMessageById').mockResolvedValue(null);
    const queueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue('job-124' as any);

    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6289900000000', phone_number_id: 'PNID_WABA_QUOTED' },
            contacts: [{ profile: { name: 'Bunda Pasien' }, wa_id: '6281200000001' }],
            messages: [{
              id: inboundWaId,
              from: '6281200000001',
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text',
              text: { body: 'Tolong infokan alamat klinik' },
              context: {
                from: '6289900000000',
                id: unknownContextId,
              },
            }],
          },
        }],
      }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(queueSpy).toHaveBeenCalled();
    const queuedJob = queueSpy.mock.calls[0][0];
    expect(queuedJob.incomingMessage.quoted).toBeUndefined();
  });

  it('3. Tanpa context -> pesan diproses normal tanpa quoted', async () => {
    const inboundWaId = `wamid.inbound_noquote_${Date.now()}`;

    vi.spyOn(wabaTenantService, 'resolveTenantByPhoneNumberId').mockResolvedValue('default-tenant');
    const queueSpy = vi.spyOn(queueService, 'enqueueMessage').mockResolvedValue('job-125' as any);

    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6289900000000', phone_number_id: 'PNID_WABA_QUOTED' },
            contacts: [{ profile: { name: 'Bunda Pasien' }, wa_id: '6281200000001' }],
            messages: [{
              id: inboundWaId,
              from: '6281200000001',
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text',
              text: { body: 'Pagi admin' },
            }],
          },
        }],
      }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/waba',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });

    expect(res.statusCode).toBe(200);
    expect(queueSpy).toHaveBeenCalled();
    const queuedJob = queueSpy.mock.calls[0][0];
    expect(queuedJob.incomingMessage.quoted).toBeUndefined();
  });
});

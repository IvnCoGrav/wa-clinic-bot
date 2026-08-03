import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WabaGatewayDriver } from '../../src/integrations/whatsapp/waba.driver';
import { normalizeWabaPayload, normalizeWabaStatuses } from '../../src/integrations/whatsapp/normalizer';
import type { WhatsAppGateway } from '../../src/integrations/whatsapp/gateway.types';
import type { WhatsAppWebhookPayload } from '../../src/integrations/whatsapp/types';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

function createDriver(): WhatsAppGateway {
  return new WabaGatewayDriver({
    phoneNumberId: '123456789',
    accessToken: 'test_token',
    baseUrl: 'https://graph.facebook.com',
  });
}

function mockPostSuccess(data: any = {}) {
  mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { messages: [{ id: 'waba_msg_123' }], ...data } });
}

function mockPostError(code: number, message: string) {
  mockedAxios.post.mockRejectedValueOnce({
    response: { data: { error: { code, message } } },
  });
}

describe('WabaGatewayDriver', () => {
  let driver: WhatsAppGateway;

  beforeEach(() => {
    vi.restoreAllMocks();
    driver = createDriver();
  });

  describe('sendTextMessage', () => {
    it('should send text and return success', async () => {
      mockPostSuccess();
      const result = await driver.sendTextMessage('6287751148065', 'Halo Bunda');
      expect(result.success).toBe(true);
      expect(result.provider).toBe('WABA');
      expect(result.messageId).toBe('waba_msg_123');
    });

    it('should return error on failure', async () => {
      mockPostError(130429, 'Rate limit hit');
      const result = await driver.sendTextMessage('628123', 'fail');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('130429');
      expect(result.error?.isRateLimit).toBe(true);
    });
  });

  describe('sendTemplateMessage', () => {
    it('should send template with components', async () => {
      mockPostSuccess();
      const result = await driver.sendTemplateMessage(
        '628123',
        'appointment_reminder',
        'id',
        [{ type: 'body', parameters: [{ type: 'text', value: 'Bidan Yusi' }] }]
      );
      expect(result.success).toBe(true);
      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.type).toBe('template');
      expect(callBody.template.name).toBe('appointment_reminder');
      expect(callBody.template.language.code).toBe('id');
    });

    it('should handle 131047 error (template not approved)', async () => {
      mockPostError(131047, 'Template not approved');
      const result = await driver.sendTemplateMessage('628123', 'bad_template', 'id', []);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('131047');
      expect(result.error?.isRateLimit).toBe(true);
    });
  });

  describe('sendImageMessage', () => {
    it('should send image with caption', async () => {
      mockPostSuccess();
      const result = await driver.sendImageMessage('628123', 'https://example.com/pricelist.jpg', 'Pricelist');
      expect(result.success).toBe(true);
      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.image.link).toBe('https://example.com/pricelist.jpg');
      expect(callBody.image.caption).toBe('Pricelist');
    });
  });

  describe('sendTypingIndicator', () => {
    it('should call mark-read with typing_indicator', async () => {
      mockPostSuccess();
      await driver.sendTypingIndicator('628123', 'waba_incoming_123', 50);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.typing_indicator).toEqual({ type: 'text' });
      expect(callBody.status).toBe('read');
      expect(callBody.message_id).toBe('waba_incoming_123');
    });

    it('should skip if no incomingMessageId', async () => {
      await driver.sendTypingIndicator('628123');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should cap duration at 25s (verify internally)', async () => {
      mockPostSuccess();
      let capturedMs = 0;
      const origSleep = (driver as any).sleep.bind(driver);
      vi.spyOn(driver as any, 'sleep').mockImplementation((ms: number) => { capturedMs = ms; return origSleep(1); });
      await driver.sendTypingIndicator('628123', 'msg1', 30000);
      expect(capturedMs).toBe(25000);
    });
  });

  describe('markAsRead', () => {
    it('should call status=read without typing_indicator', async () => {
      mockPostSuccess();
      await driver.markAsRead('628123', 'waba_msg_456');
      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.status).toBe('read');
      expect(callBody.typing_indicator).toBeUndefined();
    });

    it('should skip if no messageId', async () => {
      await driver.markAsRead('628123');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should skip dedup for recently-typed message', async () => {
      mockPostSuccess();
      await driver.sendTypingIndicator('628123', 'recent_msg', 10);
      vi.clearAllMocks();
      await driver.markAsRead('628123', 'recent_msg');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('verifyHubChallenge', () => {
    it('should return challenge on valid verify token', async () => {
      const driver2 = new WabaGatewayDriver({
        phoneNumberId: '123',
        accessToken: 'tok',
      });
      const result = await driver2.verifyHubChallenge(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'my_token', 'hub.challenge': 'CHALLENGE_123' },
        'my_token'
      );
      expect(result).toBe('CHALLENGE_123');
    });

    it('should return null on mismatch', async () => {
      const driver2 = new WabaGatewayDriver({ phoneNumberId: '123', accessToken: 'tok' });
      const result = await driver2.verifyHubChallenge(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc' },
        'my_token'
      );
      expect(result).toBeNull();
    });
  });
});

describe('normalizeWabaPayload', () => {
  const basePayload: WhatsAppWebhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'entry_1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '6281234', phone_number_id: '123' },
          contacts: [{ profile: { name: 'Bidan Test' }, wa_id: '6281234' }],
          messages: [],
        },
      }],
    }],
  };

  it('should normalize text message', () => {
    const payload = {
      ...basePayload,
      entry: [{
        ...basePayload.entry[0],
        changes: [{
          field: 'messages',
          value: {
            ...basePayload.entry[0].changes[0].value,
            messages: [{
              id: 'waba_123',
              from: '6287751148065',
              timestamp: '1691000000',
              type: 'text',
              text: { body: 'Halo Bunda' },
            }],
          },
        }],
      }],
    };

    const result = normalizeWabaPayload(payload, 'default-tenant');
    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('waba_123');
    expect(result[0].fromNumber).toBe('6287751148065');
    expect(result[0].text).toBe('Halo Bunda');
    expect(result[0].provider).toBe('WABA');
    expect(result[0].contactName).toBe('Bidan Test');
  });

  it('should normalize location message', () => {
    const payload = {
      ...basePayload,
      entry: [{
        ...basePayload.entry[0],
        changes: [{
          field: 'messages',
          value: {
            ...basePayload.entry[0].changes[0].value,
            messages: [{
              id: 'waba_loc',
              from: '628123',
              timestamp: '1691000001',
              type: 'location',
              location: { latitude: -7.3, longitude: 112.7, name: 'Rumah', address: 'Jl. Test' },
            }],
          },
        }],
      }],
    };

    const result = normalizeWabaPayload(payload, 't1');
    expect(result[0].type).toBe('location');
    expect(result[0].location?.latitude).toBe(-7.3);
    expect(result[0].location?.name).toBe('Rumah');
  });

  it('should handle empty payload', () => {
    const result = normalizeWabaPayload({ object: 'whatsapp_business_account', entry: [] }, 't1');
    expect(result).toHaveLength(0);
  });

  it('should normalize image message with media metadata', () => {
    const payload = {
      ...basePayload,
      entry: [{
        ...basePayload.entry[0],
        changes: [{
          field: 'messages',
          value: {
            ...basePayload.entry[0].changes[0].value,
            messages: [{
              id: 'waba_img',
              from: '628123',
              timestamp: '1691000002',
              type: 'image',
              image: {
                id: 'media_id_987',
                mime_type: 'image/jpeg',
                sha256: 'abc',
                caption: 'Foto hasil terapi',
              },
            }],
          },
        }],
      }],
    };

    const result = normalizeWabaPayload(payload, 't1');
    expect(result[0].type).toBe('image');
    expect(result[0].mediaId).toBe('media_id_987');
    expect(result[0].caption).toBe('Foto hasil terapi');
    expect(result[0].mimeType).toBe('image/jpeg');
    expect(result[0].phoneNumberId).toBe('123');
  });
});

describe('normalizeWabaStatuses', () => {
  it('should extract statuses from payload', () => {
    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_1' },
            statuses: [
              { id: 'wamid.delivered_1', status: 'delivered', timestamp: '1691000100' },
              { id: 'wamid.read_1', status: 'read', timestamp: '1691000200' },
            ],
          },
        }],
      }],
    };

    const result = normalizeWabaStatuses(payload);
    expect(result).toHaveLength(2);
    expect(result[0].messageId).toBe('wamid.delivered_1');
    expect(result[0].status).toBe('delivered');
    expect(result[1].status).toBe('read');
    expect(result[0].phoneNumberId).toBe('PNID_1');
  });

  it('should extract failed status with errors', () => {
    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6281234', phone_number_id: 'PNID_1' },
            statuses: [{
              id: 'wamid.failed_1',
              status: 'failed',
              timestamp: '1691000300',
              errors: [{ code: 131026, title: 'Message Undeliverable', error_data: { details: '24h window closed' } }],
            }],
          },
        }],
      }],
    };

    const result = normalizeWabaStatuses(payload);
    expect(result[0].status).toBe('failed');
    expect(result[0].errors?.[0]?.error_data?.details).toBe('24h window closed');
  });

  it('should return empty when no statuses', () => {
    const result = normalizeWabaStatuses({ object: 'whatsapp_business_account', entry: [] });
    expect(result).toHaveLength(0);
  });
});

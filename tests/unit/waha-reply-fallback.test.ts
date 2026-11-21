import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WahaGatewayDriver } from '../../src/integrations/whatsapp/waha.driver';
import { extractWahaErrorDetail, type IWahaClient, type WahaSendResult } from '../../src/integrations/waha/client';

function makeFakeWahaClient(): IWahaClient & {
  sendTextDetailed: ReturnType<typeof vi.fn>;
  sendImageDetailed: ReturnType<typeof vi.fn>;
} {
  return {
    sendSeen: vi.fn().mockResolvedValue(true),
    startTyping: vi.fn().mockResolvedValue(true),
    stopTyping: vi.fn().mockResolvedValue(true),
    sendText: vi.fn().mockResolvedValue(true),
    sendTextDetailed: vi.fn().mockResolvedValue({ success: true, messageId: 'msg_1' } as WahaSendResult),
    sendImage: vi.fn().mockResolvedValue(true),
    sendImageDetailed: vi.fn().mockResolvedValue({ success: true, messageId: 'img_1' } as WahaSendResult),
    addLabel: vi.fn().mockResolvedValue(true),
    removeLabel: vi.fn().mockResolvedValue(true),
    getChatLabels: vi.fn().mockResolvedValue([]),
    getChatLabelsOrNull: vi.fn().mockResolvedValue([]),
    getSessionStatus: vi.fn().mockResolvedValue('WORKING'),
    startSession: vi.fn().mockResolvedValue('STARTING'),
    stopSession: vi.fn().mockResolvedValue(true),
    getAuthQr: vi.fn().mockResolvedValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue('default'),
    getChats: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
    getContact: vi.fn().mockResolvedValue(null),
    downloadMedia: vi.fn().mockResolvedValue(null),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessage: vi.fn().mockResolvedValue(true),
    sendReaction: vi.fn().mockResolvedValue(true),
  };
}

describe('WahaGatewayDriver - Reply-To Fallback', () => {
  let fakeClient: ReturnType<typeof makeFakeWahaClient>;
  let driver: WahaGatewayDriver;

  beforeEach(() => {
    fakeClient = makeFakeWahaClient();
    driver = new WahaGatewayDriver(fakeClient as any, 'tenant-test');
  });

  describe('sendTextMessage', () => {
    it('1. fallback retry tanpa reply_to jika WAHA mengembalikan error format ID', async () => {
      fakeClient.sendTextDetailed
        .mockResolvedValueOnce({
          success: false,
          error:
            'Message id be in format false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA[_participant]',
        } as WahaSendResult)
        .mockResolvedValueOnce({
          success: true,
          messageId: 'msg_fallback_ok',
        } as WahaSendResult);

      const result = await driver.sendTextMessage(
        '628123456789',
        'Halo Bunda',
        { replyToMessageId: 'invalid_format_id' }
      );

      expect(fakeClient.sendTextDetailed).toHaveBeenCalledTimes(2);
      expect(fakeClient.sendTextDetailed).toHaveBeenNthCalledWith(
        1,
        '628123456789@c.us',
        'Halo Bunda',
        'invalid_format_id'
      );
      expect(fakeClient.sendTextDetailed).toHaveBeenNthCalledWith(
        2,
        '628123456789@c.us',
        'Halo Bunda',
        undefined
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg_fallback_ok');
      expect(result.replyToDropped).toBe(true);
    });

    it('2. TIDAK fallback jika error berupa timeout atau kegagalan jaringan (cegah pesan dobel)', async () => {
      fakeClient.sendTextDetailed.mockResolvedValueOnce({
        success: false,
        error: 'timeout of 10000ms exceeded',
      } as WahaSendResult);

      const result = await driver.sendTextMessage(
        '628123456789',
        'Halo Bunda',
        { replyToMessageId: 'false_628123@c.us_valid' }
      );

      expect(fakeClient.sendTextDetailed).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.replyToDropped).toBeFalsy();
    });

    it('3. hanya 1 call jika tanpa replyToMessageId', async () => {
      const result = await driver.sendTextMessage('628123456789', 'Halo Bunda');

      expect(fakeClient.sendTextDetailed).toHaveBeenCalledTimes(1);
      expect(fakeClient.sendTextDetailed).toHaveBeenCalledWith(
        '628123456789@c.us',
        'Halo Bunda',
        undefined
      );
      expect(result.success).toBe(true);
      expect(result.replyToDropped).toBeFalsy();
    });
  });

  describe('sendImageMessage', () => {
    it('4. sendImageMessage mengikuti perilaku graceful fallback yang sama jika ID ditolak', async () => {
      fakeClient.sendImageDetailed
        .mockResolvedValueOnce({
          success: false,
          error:
            'Error: Message id be in format false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA[_participant]',
        } as WahaSendResult)
        .mockResolvedValueOnce({
          success: true,
          messageId: 'img_fallback_ok',
        } as WahaSendResult);

      const result = await driver.sendImageMessage(
        '628123456789',
        'https://example.com/test.jpg',
        'Caption test',
        { replyToMessageId: 'invalid_id' }
      );

      expect(fakeClient.sendImageDetailed).toHaveBeenCalledTimes(2);
      expect(fakeClient.sendImageDetailed).toHaveBeenNthCalledWith(
        1,
        '628123456789@c.us',
        'https://example.com/test.jpg',
        'Caption test',
        'invalid_id'
      );
      expect(fakeClient.sendImageDetailed).toHaveBeenNthCalledWith(
        2,
        '628123456789@c.us',
        'https://example.com/test.jpg',
        'Caption test',
        undefined
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('img_fallback_ok');
      expect(result.replyToDropped).toBe(true);
    });
  });

  it('5. end-to-end: body error asli WAHA (exception.message) memicu fallback driver', async () => {
    const wahaErrorBody = {
      statusCode: 500,
      exception: {
        message:
          'Message id be in format false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA[_participant]',
      },
      request: {
        path: '/api/sendText',
        body: { reply_to: 'temp_1795220000994' },
      },
    };

    // Mensimulasikan hasil client: error asli diekstrak dari exception.message,
    // bukan pesan generik axios.
    const clientError = extractWahaErrorDetail(
      wahaErrorBody,
      'Request failed with status code 500'
    );

    fakeClient.sendTextDetailed
      .mockResolvedValueOnce({ success: false, error: clientError } as WahaSendResult)
      .mockResolvedValueOnce({ success: true, messageId: 'msg_e2e_ok' } as WahaSendResult);

    const result = await driver.sendTextMessage(
      '628123456789',
      'Halo Bunda',
      { replyToMessageId: 'temp_1795220000994' }
    );

    expect(fakeClient.sendTextDetailed).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg_e2e_ok');
    expect(result.replyToDropped).toBe(true);
  });
});

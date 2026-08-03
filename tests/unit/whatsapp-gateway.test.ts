import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WahaGatewayDriver } from '../../src/integrations/whatsapp/waha.driver';
import type { IWahaClient } from '../../src/integrations/waha/client';
import type { WhatsAppGateway } from '../../src/integrations/whatsapp/gateway.types';

function createMockWahaClient(): IWahaClient {
  return {
    sendSeen: vi.fn().mockResolvedValue(true),
    startTyping: vi.fn().mockResolvedValue(true),
    stopTyping: vi.fn().mockResolvedValue(true),
    sendText: vi.fn().mockResolvedValue(true),
    sendImage: vi.fn().mockResolvedValue(true),
    addLabel: vi.fn().mockResolvedValue(true),
    removeLabel: vi.fn().mockResolvedValue(true),
    getChatLabels: vi.fn().mockResolvedValue([]),
    getSessionStatus: vi.fn().mockResolvedValue('WORKING'),
    startSession: vi.fn().mockResolvedValue('WORKING'),
    getAuthQr: vi.fn().mockResolvedValue(null),
    getChats: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
  };
}

describe('WhatsAppGateway — WahaGatewayDriver', () => {
  let mockClient: ReturnType<typeof createMockWahaClient>;
  let driver: WhatsAppGateway;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = createMockWahaClient();
    driver = new WahaGatewayDriver(mockClient);
  });

  describe('providerType', () => {
    it('should report WAHA', () => {
      expect(driver.providerType).toBe('WAHA');
    });
  });

  describe('sendTextMessage', () => {
    it('should convert E.164 phone to chatId and send', async () => {
      const result = await driver.sendTextMessage('6287751148065', 'Halo');
      expect(result.success).toBe(true);
      expect(result.provider).toBe('WAHA');
      expect(mockClient.sendText).toHaveBeenCalledWith('6287751148065@c.us', 'Halo');
    });

    it('should not double-append @c.us if already present', async () => {
      await driver.sendTextMessage('6287751148065@c.us', 'Test');
      expect(mockClient.sendText).toHaveBeenCalledWith('6287751148065@c.us', 'Test');
    });

    it('should pass through @lid format', async () => {
      await driver.sendTextMessage('79903991054369@lid', 'Test');
      expect(mockClient.sendText).toHaveBeenCalledWith('79903991054369@lid', 'Test');
    });

    it('should return error result on failure', async () => {
      (mockClient.sendText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
      const result = await driver.sendTextMessage('628123', 'fail');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WAHA_SEND_TEXT');
    });
  });

  describe('sendImageMessage', () => {
    it('should convert phone and send image', async () => {
      const result = await driver.sendImageMessage('628123', 'https://example.com/pic.jpg', 'Caption');
      expect(result.success).toBe(true);
      expect(mockClient.sendImage).toHaveBeenCalledWith('628123@c.us', 'https://example.com/pic.jpg', 'Caption');
    });

    it('should handle image without caption', async () => {
      await driver.sendImageMessage('628123', 'https://example.com/pic.jpg');
      expect(mockClient.sendImage).toHaveBeenCalledWith('628123@c.us', 'https://example.com/pic.jpg', undefined);
    });
  });

  describe('sendTemplateMessage', () => {
    it('should interpolate template params and send as text', async () => {
      const result = await driver.sendTemplateMessage(
        '628123',
        'appointment_reminder',
        'id',
        [{ type: 'body', parameters: [{ type: 'text', value: 'Bidan Yusi' }, { type: 'text', value: '10:00' }] }]
      );
      expect(result.success).toBe(true);
      expect(mockClient.sendText).toHaveBeenCalledWith(
        '628123@c.us',
        expect.stringContaining('Bidan Yusi')
      );
    });
  });

  describe('sendTypingIndicator', () => {
    it('should start typing, sleep, then stop typing', async () => {
      const startSpy = mockClient.startTyping as ReturnType<typeof vi.fn>;
      const stopSpy = mockClient.stopTyping as ReturnType<typeof vi.fn>;

      await driver.sendTypingIndicator('628123', undefined, 100);

      expect(startSpy).toHaveBeenCalledWith('628123@c.us');
      expect(stopSpy).toHaveBeenCalledWith('628123@c.us');
      expect(stopSpy.mock.invocationCallOrder[0]).toBeGreaterThan(startSpy.mock.invocationCallOrder[0]);
    });

    it('should stop typing even if startTyping fails', async () => {
      (mockClient.startTyping as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
      await driver.sendTypingIndicator('628123', undefined, 10);
      expect(mockClient.stopTyping).toHaveBeenCalledWith('628123@c.us');
    });
  });

  describe('markAsRead', () => {
    it('should call sendSeen with chatId and messageId', async () => {
      await driver.markAsRead('628123@c.us', 'msg_123');
      expect(mockClient.sendSeen).toHaveBeenCalledWith('628123@c.us', 'msg_123');
    });

    it('should call sendSeen without messageId', async () => {
      await driver.markAsRead('628123@c.us');
      expect(mockClient.sendSeen).toHaveBeenCalledWith('628123@c.us', undefined);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { whatsappProviderService } from '../../src/services/whatsapp-provider.service';
import { WahaGatewayDriver } from '../../src/integrations/whatsapp/waha.driver';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('WAHA Internal Outbound Cut-Off Unit Tests', () => {
  let mockWahaClient: any;

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Reset cutoff state ke false
    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, false);

    mockWahaClient = {
      sendText: vi.fn().mockResolvedValue(true),
      sendTextDetailed: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-123' }),
      sendImage: vi.fn().mockResolvedValue(true),
      sendImageDetailed: vi.fn().mockResolvedValue({ success: true, messageId: 'img-123' }),
      startTyping: vi.fn().mockResolvedValue(true),
      stopTyping: vi.fn().mockResolvedValue(true),
      sendSeen: vi.fn().mockResolvedValue(true),
    };
  });

  it('1. Outbound messages flow normally when cut-off is inactive (false)', async () => {
    const driver = new WahaGatewayDriver(mockWahaClient, DEFAULT_TENANT_ID);

    const result = await driver.sendTextMessage('628123456789', 'Halo Bunda!');
    expect(result.success).toBe(true);
    expect(mockWahaClient.sendTextDetailed).toHaveBeenCalled();
  });

  it('2. Outbound text messages are blocked when internal cut-off is active (true)', async () => {
    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, true);

    const driver = new WahaGatewayDriver(mockWahaClient, DEFAULT_TENANT_ID);

    const result = await driver.sendTextMessage('628123456789', 'Halo Bunda!');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WAHA_INTERNAL_CUTOFF');
    expect(mockWahaClient.sendTextDetailed).not.toHaveBeenCalled();
    expect(mockWahaClient.sendText).not.toHaveBeenCalled();
  });

  it('3. Outbound image messages are blocked when internal cut-off is active (true)', async () => {
    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, true);

    const driver = new WahaGatewayDriver(mockWahaClient, DEFAULT_TENANT_ID);

    const result = await driver.sendImageMessage('628123456789', 'https://example.com/pic.jpg', 'Pricelist');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WAHA_INTERNAL_CUTOFF');
    expect(mockWahaClient.sendImageDetailed).not.toHaveBeenCalled();
  });

  it('4. Typing indicator is safely skipped when internal cut-off is active (true)', async () => {
    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, true);

    const driver = new WahaGatewayDriver(mockWahaClient, DEFAULT_TENANT_ID);

    await driver.sendTypingIndicator('628123456789', undefined, 100);
    expect(mockWahaClient.startTyping).not.toHaveBeenCalled();
  });

  it('5. Reconnecting internal cut-off restores normal message sending immediately', async () => {
    // 1. Cut off
    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, true);
    const driver = new WahaGatewayDriver(mockWahaClient, DEFAULT_TENANT_ID);

    const res1 = await driver.sendTextMessage('628123456789', 'Pesan saat cut-off');
    expect(res1.success).toBe(false);
    expect(mockWahaClient.sendTextDetailed).not.toHaveBeenCalled();

    // 2. Reconnect
    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, false);
    const res2 = await driver.sendTextMessage('628123456789', 'Pesan setelah reconnect');
    expect(res2.success).toBe(true);
    expect(mockWahaClient.sendTextDetailed).toHaveBeenCalled();
  });

  it('6. Reaction messages are blocked when internal cut-off is active (true)', async () => {
    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, true);
    const driver = new WahaGatewayDriver(mockWahaClient, DEFAULT_TENANT_ID);

    mockWahaClient.sendReaction = vi.fn().mockResolvedValue(true);
    const result = await driver.sendReactionMessage('628123456789', 'msg-123', '👍');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WAHA_INTERNAL_CUTOFF');
    expect(mockWahaClient.sendReaction).not.toHaveBeenCalled();
  });

  it('7. TypingService.simulateHumanReply is blocked immediately when cut-off is active', async () => {
    const { TypingService } = await import('../../src/services/typing.service');
    const typingSvc = new TypingService(mockWahaClient);

    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, true);

    const result = await typingSvc.simulateHumanReply({
      chatId: '628123456789',
      replyText: 'Halo Bunda, ini pesan simulasi!',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('WAHA_INTERNAL_CUTOFF');
    expect(mockWahaClient.sendText).not.toHaveBeenCalled();
    expect(mockWahaClient.startTyping).not.toHaveBeenCalled();
  });

  it('8. WABA Gateway Driver blocks outbound messages when cut-off is active', async () => {
    const { WabaGatewayDriver } = await import('../../src/integrations/whatsapp/waba.driver');
    const wabaDriver = new WabaGatewayDriver({
      phoneNumberId: '123456789',
      accessToken: 'test-token',
    }, DEFAULT_TENANT_ID);

    await whatsappProviderService.setOutboundCutOff(DEFAULT_TENANT_ID, true);

    const res = await wabaDriver.sendTextMessage('628123456789', 'Pesan via WABA');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('WABA_INTERNAL_CUTOFF');
  });
});

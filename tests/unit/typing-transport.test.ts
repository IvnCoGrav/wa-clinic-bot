import { describe, it, expect, vi } from 'vitest';
import { createWahaTransport, createGatewayTransport } from '../../src/integrations/whatsapp/transport';
import { TypingService } from '../../src/services/typing.service';

describe('MessageTransport abstractions', () => {
  it('createGatewayTransport delegates to WhatsAppGateway', async () => {
    const mockGateway: any = {
      markAsRead: vi.fn().mockResolvedValue(undefined),
      sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg_123' }),
    };

    const transport = createGatewayTransport(mockGateway);
    await transport.sendSeen('chat_1', 'wamid_1');
    expect(mockGateway.markAsRead).toHaveBeenCalledWith('chat_1', 'wamid_1');

    await transport.startTyping('chat_1');
    expect(mockGateway.sendTypingIndicator).toHaveBeenCalledWith('chat_1');

    await transport.stopTyping('chat_1'); // noop

    const success = await transport.sendText('chat_1', 'halo');
    expect(mockGateway.sendTextMessage).toHaveBeenCalledWith('chat_1', 'halo');
    expect(success).toBe(true);
  });

  it('createWahaTransport delegates to WahaClient', async () => {
    const mockWaha: any = {
      sendSeen: vi.fn().mockResolvedValue(true),
      startTyping: vi.fn().mockResolvedValue(true),
      stopTyping: vi.fn().mockResolvedValue(true),
      sendText: vi.fn().mockResolvedValue(true),
    };

    const transport = createWahaTransport(mockWaha);
    await transport.sendSeen('chat_1', 'wamid_1');
    expect(mockWaha.sendSeen).toHaveBeenCalledWith('chat_1', 'wamid_1');

    await transport.startTyping('chat_1');
    expect(mockWaha.startTyping).toHaveBeenCalledWith('chat_1');

    await transport.stopTyping('chat_1');
    expect(mockWaha.stopTyping).toHaveBeenCalledWith('chat_1');

    const success = await transport.sendText('chat_1', 'halo');
    expect(mockWaha.sendText).toHaveBeenCalledWith('chat_1', 'halo');
    expect(success).toBe(true);
  });

  it('TypingService uses resolved transport for tenant', async () => {
    const defaultSendText = vi.fn().mockResolvedValue(true);
    const wabaSendText = vi.fn().mockResolvedValue(true);

    const defaultTransport: any = {
      sendSeen: vi.fn().mockResolvedValue(undefined),
      startTyping: vi.fn().mockResolvedValue(undefined),
      stopTyping: vi.fn().mockResolvedValue(undefined),
      sendText: defaultSendText,
    };

    const wabaTransport: any = {
      sendWeen: vi.fn().mockResolvedValue(undefined),
      startTyping: vi.fn().mockResolvedValue(undefined),
      stopTyping: vi.fn().mockResolvedValue(undefined),
      sendText: wabaSendText,
    };

    const resolver = vi.fn().mockImplementation(async (tenantId: string) => {
      if (tenantId === 'tenant-waba') return wabaTransport;
      return defaultTransport;
    });

    const typingService = new TypingService(defaultTransport, 100, resolver);

    await typingService.simulateHumanReply({
      chatId: '62812345678',
      replyText: 'Halo dari WABA',
      tenantId: 'tenant-waba',
    });

    expect(resolver).toHaveBeenCalledWith('tenant-waba');
    expect(wabaSendText).toHaveBeenCalledWith('62812345678', 'Halo dari WABA');
    expect(defaultSendText).not.toHaveBeenCalled();
  });
});
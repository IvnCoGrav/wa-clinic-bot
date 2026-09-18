import { IWahaClient, wahaClient } from '../waha/client';
import type { WhatsAppGateway } from './gateway.types';

export interface MessageTransport {
  sendSeen(chatId: string, messageId?: string): Promise<void | boolean>;
  startTyping(chatId: string): Promise<void | boolean>;
  stopTyping(chatId: string): Promise<void | boolean>;
  sendText(chatId: string, text: string): Promise<boolean>;
}

export function createWahaTransport(client: IWahaClient = wahaClient): MessageTransport {
  return {
    sendSeen: (chatId, messageId) => (messageId ? client.sendSeen(chatId, messageId).then(() => {}) : Promise.resolve()),
    startTyping: (chatId) => client.startTyping(chatId).then(() => {}),
    stopTyping: (chatId) => client.stopTyping(chatId).then(() => {}),
    sendText: (chatId, text) => client.sendText(chatId, text),
  };
}

export function createGatewayTransport(gateway: WhatsAppGateway): MessageTransport {
  return {
    sendSeen: (chatId, messageId) => gateway.markAsRead(chatId, messageId),
    // WABA tidak punya typing indicator persisten -> kirim indikator berdurasi (best-effort)
    startTyping: (chatId) => gateway.sendTypingIndicator(chatId).catch(() => {}),
    stopTyping: async () => {},
    sendText: async (chatId, text) => {
      const res = await gateway.sendTextMessage(chatId, text);
      return res.success;
    },
  };
}
